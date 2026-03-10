# Milestone 2: R2 Cloud Sync — Design Spec

## Goal

Messages sync across devices via Cloudflare R2 with offline fallback. Every CLI operation transparently pulls the latest state, merges, operates, and pushes — or works locally if R2 is unreachable.

## Index Format

Uses the M1 index format — a wrapped JSON object with a `version` field:

```json
{
  "version": 1,
  "messages": [
    {
      "id": "1710000000000_a1b2c3d4",
      "created_at": "2026-03-10T12:00:00Z",
      "tags": ["work"],
      "ttl_seconds": null,
      "expires_at": null,
      "status": "unread",
      "content_preview": "meeting at 3pm"
    }
  ]
}
```

Note: The architecture doc's bare-array example is illustrative. The M1 implementation (and this spec) uses the wrapped format.

**Immutability rule**: All fields on an index entry are immutable after creation, except `status`. Tags, TTL, content_preview, and created_at are set at push time and never modified. This simplifies the merge algorithm to only needing a merge rule for `status`.

## Sync Architecture

Every `nts` operation follows a **pull-operate-push** pattern:

1. **Pull**: Fetch `index.age` from R2, decrypt, merge with local index
2. **Operate**: Execute the command against the merged index
3. **Push**: Re-encrypt updated index, upload to R2. Upload new message blobs if any.

If R2 is unreachable, the command works against the local copy. A `sync_state.json` file tracks unsynced changes, and the next successful sync pushes them.

### Merge Algorithm

For each message ID across local and remote indexes:

| Local | Remote | Pending Sync | Pending Delete | Action |
|-------|--------|-------------|----------------|--------|
| Present | Present | — | — | Keep entry with the "later" status |
| Absent | Present | — | No | Add to local |
| Absent | Present | — | Yes | Don't add — deleted on this device |
| Present | Absent | Yes | — | Keep — not yet uploaded |
| Present | Absent | No | — | Delete locally — removed on another device |

**Status ordering** (statuses only move forward): `unread` → `read` → `consumed` → `expired`

When merging two entries with the same ID, take the one with the later status. If statuses are equal, they're identical (since only status is mutable).

The merge function is a pure function: `fn merge(local: &Index, remote: &Index, pending_ids: &HashSet<String>, pending_deletes: &HashSet<String>) -> Index`. No I/O, no side effects, easily testable.

### Pending Sync Tracking

`~/.local/share/nts/sync_state.json` (local-only, never uploaded, unencrypted):

```json
{
  "pending_ids": ["1710000000000_a1b2c3d4"],
  "pending_deletes": ["1710000060000_e5f6g7h8"],
  "last_sync": "2026-03-10T12:00:00Z"
}
```

Contains only message IDs and a timestamp — no message content, no keys. Located in the nts data directory (`~/.local/share/nts/` or `$NTS_HOME`), same as M1's data layout.

- **`pending_ids`**: Message IDs created locally but not yet confirmed in the remote index. Added when R2 upload fails or is offline. Removed after a successful sync where the ID appears in the remote index.
- **`pending_deletes`**: Message IDs deleted locally but not yet confirmed deleted from R2. Added when a delete/purge is performed. Removed after a successful sync where the remote no longer contains the ID.
- **`last_sync`**: Updated after every successful pull from R2.

## R2 Storage Layout

```
nts-messages/           (R2 bucket)
├── index.age           (encrypted JSON index)
└── messages/
    ├── 1710000000000_a1b2c3d4.age
    └── 1710000060000_e5f6g7h8.age
```

Same blob key structure as local storage. The `Storage` trait already defines the interface; R2 is a new implementation.

## Operation Flows

### Read commands (`peek`, `list`, `show`, `search`)

1. Try fetch remote `index.age` from R2
2. If successful: decrypt remote, merge with local, save merged locally
3. If offline: use local index as-is
4. Execute the command (no index mutation)

### Status mutation commands (`pop`, `ack`)

1. Pull + merge index (same as read)
2. Execute the command (changes message status)
3. Re-encrypt updated index, save locally
4. Upload index to R2

### Write commands (`push`)

1. Pull + merge index (same as read)
2. Create encrypted message blob, write locally
3. Add entry to merged index, save locally
4. Upload message blob to R2
5. Upload updated index to R2
6. If R2 upload fails: add message ID to `pending_ids`, continue — message is safe locally

### Delete commands (`delete`, `purge`)

1. Pull + merge index
2. Remove entry from index, delete blob locally
3. Add deleted message ID(s) to `pending_deletes`
4. Delete blob from R2
5. Upload updated index to R2
6. If R2 delete/upload fails: entry stays in `pending_deletes`, will be retried on next sync

## Config Changes

`config.toml` in the nts data directory (`~/.local/share/nts/config.toml` or `$NTS_HOME/config.toml`) gains an R2 section:

```toml
[storage]
backend = "r2"
path = "~/.local/share/nts"   # local cache always maintained

[storage.r2]
bucket = "nts-messages"
endpoint = "https://<account-id>.r2.cloudflarestorage.com"
access_key_id = "..."
secret_access_key = "..."
```

When backend is `local`, no sync occurs — identical to Milestone 1 behavior.
When backend is `r2`, local path serves as the cache directory.

R2 credentials are stored in plaintext in `config.toml`. This is acceptable because:
- The data directory already has restricted permissions
- The credentials only grant access to encrypted blobs — useless without the age identity file

## New CLI Commands

| Command | Purpose |
|---------|---------|
| `nts config set <key> <value>` | Set config values (backend, R2 credentials) |
| `nts config get <key>` | Read config values (masks secrets in output) |
| `nts sync` | Force manual sync (push pending + pull latest) |
| `nts status` | Show sync state: backend, last sync time, pending count |
| `nts export [--passphrase]` | Export identity + config as portable bundle |
| `nts import <file> [--passphrase]` | Set up nts from an export bundle |

All existing commands (`push`, `peek`, `pop`, `list`, `show`, `ack`, `delete`, `purge`, `search`) gain sync behavior transparently — no interface changes.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| R2 unreachable | Command works locally. Prints: "Offline — working from local cache" |
| R2 credentials missing/invalid | Command works locally. Prints: "R2 credentials invalid — working from local cache. Run `nts config set ...` to fix" |
| Remote index corrupt/undecryptable | Command works locally. Prints: "Remote index unreadable — working from local cache. Run `nts sync` to retry" |
| Blob upload succeeds but index upload fails | Blob is orphaned in R2 but safe; next successful sync includes it via `pending_ids` |
| Backend set to `local` | No sync — behaves exactly like Milestone 1 |

All error cases follow the same pattern: **work locally, warn clearly, never block the user**.

## Code Architecture

Sync and merge logic lives in the core library, not CLI-specific code. Any future UI (PWA, desktop app) calls the same functions.

```
src/
├── sync.rs          # Pull, merge, push orchestration — no CLI dependency
├── merge.rs         # Pure merge function — Index + Index + pending → Index
├── sync_state.rs    # Load/save sync_state.json
├── storage/
│   ├── mod.rs       # Storage trait (unchanged, stays synchronous)
│   ├── local.rs     # Filesystem (unchanged)
│   └── r2.rs        # S3/R2 implementation via rust-s3 crate
├── commands/
│   ├── mod.rs       # Updated: load_context gains sync behavior
│   ├── config_cmd.rs # NEW: nts config get/set
│   ├── sync_cmd.rs  # NEW: nts sync
│   ├── status.rs    # NEW: nts status
│   └── ...          # Existing commands unchanged
```

The commands layer is a thin wrapper: call `sync::pull()`, do its thing, call `sync::push()`. Structured errors are returned as `Result` types — CLI formats them as terminal warnings, a future UI would show them as toasts/banners.

### Async containment

The existing `Storage` trait stays synchronous. The R2 storage implementation uses `tokio::runtime::Runtime::block_on()` internally to run async S3 calls. This avoids making the entire CLI async and keeps the trait compatible with the synchronous local implementation. The tokio runtime is created once per CLI invocation.

## New Dependencies

| Crate | Purpose |
|-------|---------|
| `rust-s3` | S3-compatible API client (supports custom endpoints for R2) |
| `tokio` | Async runtime (required by rust-s3, contained within R2 storage impl) |
| `rpassword` | Passphrase prompt for export/import (no echo to terminal) |

## Conflict Resolution

The merge algorithm handles logical conflicts (two devices changing the same message's status). Since message IDs include a timestamp + random suffix, two devices cannot create the same message ID, so merging is always a clean union of entries.

The only real conflict is two devices changing the **status** of the same message simultaneously. The status ordering (`unread` → `read` → `consumed` → `expired`) ensures the merge always picks the "more progressed" state, which is the correct semantic.

### Optimistic locking with ETags

To prevent simultaneous syncs from overwriting each other, the index upload uses S3 conditional writes:

1. On **pull**, record the ETag of the fetched `index.age` (S3 returns this on GET)
2. On **push**, upload with `If-Match: <etag>` header — this succeeds only if no one else has modified the index since we pulled it
3. If the upload returns `412 Precondition Failed`:
   a. Re-pull the remote index (getting the new ETag)
   b. Re-merge with our local changes
   c. Re-attempt the upload with the new ETag
   d. Retry up to 3 times, then fall back to local-only with a warning

This guarantees no data loss from concurrent syncs. The ETag is stored in `sync_state.json`:

```json
{
  "pending_ids": [],
  "pending_deletes": [],
  "last_sync": "2026-03-10T12:00:00Z",
  "remote_etag": "\"a1b2c3d4e5f6\""
}
```

For the first push (no remote index exists yet), use `If-None-Match: *` to ensure we don't overwrite an index that appeared between our check and our write.

## New Device Bootstrapping

### Export from existing device

```bash
nts export > nts-bundle.json
# or with a passphrase for extra protection in transit:
nts export --passphrase > nts-bundle.json
```

`nts export` produces a JSON file containing:
- The age identity (private key)
- The age recipient (public key)
- The R2 configuration (bucket, endpoint, credentials)

If `--passphrase` is used, the entire bundle is encrypted with a passphrase-based age recipient (scrypt). Without it, the bundle is plaintext JSON — the user is responsible for secure transfer (e.g., airdrop, USB, secure messaging).

### Import on new device

```bash
nts import nts-bundle.json
# or if passphrase-protected:
nts import nts-bundle.json --passphrase
```

`nts import`:
1. Reads the bundle (decrypting with passphrase if needed)
2. Writes `identity.txt` (with 0600 permissions), `recipients.txt`, and `config.toml`
3. Creates the data directory and `messages/` subdirectory
4. Runs an initial sync to pull all messages from R2

After import, the device is fully operational — `nts list` shows all messages immediately.

### New CLI Commands (bootstrapping)

| Command | Purpose |
|---------|---------|
| `nts export` | Export identity + config as portable JSON bundle |
| `nts export --passphrase` | Same, but passphrase-encrypted for safe transit |
| `nts import <file>` | Set up nts from an export bundle |
| `nts import <file> --passphrase` | Same, decrypting with passphrase |

### Bundle format

```json
{
  "v": 1,
  "identity": "AGE-SECRET-KEY-...",
  "recipient": "age1...",
  "config": {
    "storage": {
      "backend": "r2",
      "path": "~/.local/share/nts",
      "r2": {
        "bucket": "nts-messages",
        "endpoint": "https://...",
        "access_key_id": "...",
        "secret_access_key": "..."
      }
    }
  }
}
```

## Success Criteria

1. `nts config set storage.backend r2` + credentials → enables sync
2. `nts push "hello"` on device A → `nts list` on device B shows the message
3. `nts pop` on device A → message shows as consumed on device B
4. `nts push "offline"` with no internet → message saved locally, synced on next successful operation
5. `nts delete <id>` while offline → message stays deleted after coming back online (not re-added by merge)
6. `nts sync` forces a manual pull/push cycle
7. `nts status` shows backend, last sync time, pending count
8. Setting backend to `local` disables sync entirely (Milestone 1 behavior preserved)
9. All existing tests still pass (no regressions)
10. Merge algorithm correctly handles: same message with different statuses, local-only pending messages, offline deletes, remote-only new messages
11. Concurrent index push triggers ETag conflict → automatic retry with re-merge (no data loss)
12. `nts export` produces a valid bundle → `nts import` on a fresh machine → `nts list` shows all messages
13. `nts export --passphrase` → bundle is encrypted → `nts import --passphrase` decrypts and sets up correctly
