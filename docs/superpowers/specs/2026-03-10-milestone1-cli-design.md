# Milestone 1: CLI Proof of Concept — Design Spec

## Goal

A working `nts` Rust CLI binary that does `push`/`peek`/`pop`/`list`/`search` with age encryption on local filesystem storage.

## CLI Interface

```bash
nts init                                    # Generate keypair, create data dir
nts push "meeting at 3pm"                   # Encrypt + store message
nts push "grab milk" --ttl 4h               # Message with auto-expiry
nts push "deploy notes" --tag work          # Message with tag
echo "$(pbpaste)" | nts push               # Pipe from stdin
nts push --tag work --tag ops "multi-tag"   # Multiple tags

nts peek                                    # Show latest unread (don't mark read)
nts pop                                     # Show latest unread + mark consumed
nts list                                    # List all messages (summary view)
nts list --tag work                         # Filter by tag
nts list --status unread                    # Filter by status
nts show <id>                               # Show full message by ID

nts ack <id>                                # Mark as read
nts delete <id>                             # Permanently delete message + blob
nts purge --expired                         # Clean up expired messages

nts search "query"                          # Decrypt all, grep, return matches
```

## Data Layout

```
~/.local/share/nts/               # $NTS_HOME, XDG-compliant
├── identity.txt                  # age X25519 private key (0600 perms)
├── recipients.txt                # age public key
├── config.toml                   # user preferences
├── index.age                     # encrypted JSON index
└── messages/
    ├── 1710000000000_a1b2c3d4.age
    └── 1710000060000_e5f6g7h8.age
```

## Config File (`config.toml`)

```toml
[storage]
backend = "local"               # "local" for M1, "r2" for M2
path = "~/.local/share/nts"     # local storage path

# Future milestones:
# [ntfy]
# topic = "nts-abc123"
# server = "https://ntfy.sh"
# [storage.r2]
# bucket = "my-nts-bucket"
# account_id = "..."
```

## Index Format

`index.age` is an age-encrypted JSON file:

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

Statuses: `unread`, `read`, `consumed`, `expired`

## Message Blob Format

Each `.age` file contains an age-encrypted JSON envelope:

```json
{
  "v": 1,
  "id": "1710000000000_a1b2c3d4",
  "content": "meeting at 3pm",
  "content_type": "text/plain",
  "tags": ["work"],
  "created_at": "2026-03-10T12:00:00Z",
  "device": "cli"
}
```

## ID Generation

`{unix_millis}_{random_8_hex}` — e.g., `1710000000000_a1b2c3d4`

Timestamp prefix enables chronological ordering. Random suffix prevents collisions.

## TTL Behavior

- `--ttl` accepts duration strings: `30m`, `4h`, `7d`
- Stored as `ttl_seconds` and computed `expires_at` in the index
- On any index read (list, peek, pop), expired messages get status set to `expired`
- `nts purge --expired` deletes expired message blobs and removes from index
- No background daemon — TTL is enforced lazily on access

## Search Behavior

`nts search "query"`:
1. Load and decrypt index
2. For each non-expired message, decrypt the blob
3. Case-insensitive substring match against content
4. Display matching messages with highlighted matches
5. For M1, this is simple string matching. Regex or AI search is future work.

## Rust Crate Dependencies

| Crate | Purpose |
|-------|---------|
| `age` (rage) | age encryption/decryption |
| `clap` | CLI argument parsing |
| `serde` / `serde_json` | JSON serialization |
| `toml` | Config file parsing |
| `chrono` | Timestamps and duration parsing |
| `rand` | Random ID generation |
| `directories` | XDG-compliant paths |
| `colored` | Terminal output formatting |

## Error Handling

- Missing identity → clear error: "Run `nts init` first"
- Corrupt index → attempt recovery from message blobs (rebuild index)
- Decrypt failure → "Identity file doesn't match. Check ~/.local/share/nts/identity.txt"
- Empty inbox → "No messages. Push one with: nts push \"hello\""

## Output Format

`nts list` summary view:
```
  ID                        STATUS   TAGS        PREVIEW
  1710000000000_a1b2c3d4    unread   work        meeting at 3pm
  1710000060000_e5f6g7h8    read     clipboard   https://example.com/...
  1710000120000_i9j0k1l2    unread               grab milk (expires in 3h)
```

`nts peek` / `nts pop` / `nts show` detail view:
```
─── Note to Self ───────────────────────────────
  ID:      1710000000000_a1b2c3d4
  Tags:    work
  Status:  unread
  Created: 2026-03-10 12:00:00 CDT

  meeting at 3pm
────────────────────────────────────────────────
```

## Architecture (Code Structure)

```
src/
├── main.rs           # CLI entry point, clap command routing
├── commands/
│   ├── mod.rs
│   ├── init.rs       # nts init
│   ├── push.rs       # nts push
│   ├── peek.rs       # nts peek
│   ├── pop.rs        # nts pop
│   ├── list.rs       # nts list
│   ├── show.rs       # nts show
│   ├── ack.rs        # nts ack
│   ├── delete.rs     # nts delete
│   ├── purge.rs      # nts purge
│   └── search.rs     # nts search
├── crypto.rs         # age encrypt/decrypt wrappers
├── index.rs          # Index load/save/update operations
├── message.rs        # Message struct and serialization
├── config.rs         # Config file management
└── storage/
    ├── mod.rs        # Storage trait
    └── local.rs      # Local filesystem implementation
```

## Success Criteria

1. `nts init` creates keypair and data directory
2. `nts push "hello"` encrypts and stores a message
3. `nts peek` shows the latest unread message decrypted
4. `nts pop` shows and marks consumed
5. `nts list` shows all messages with status
6. `nts push "temp" --ttl 1s && sleep 2 && nts list` shows message as expired
7. `echo "piped" | nts push` works
8. `nts search "hello"` finds the message
9. All data at rest is age-encrypted (index + message blobs)
10. Identity file has 0600 permissions
