# Note to Self: Architecture

## Decision: Build Custom (age + blob storage)

### Options Evaluated

#### Option A: Matrix Protocol Backend: NO-GO
**Verdict**: Overkill for single-user self-messaging.

| Factor | Assessment |
|--------|-----------|
| **Encryption** | E2E via Olm/Megolm: battle-tested, but requires complex key management (cross-signing, device verification, key backup/recovery) |
| **Lightest server** | Conduwuit (Rust fork of Conduit): ~500MB DB, negligible CPU/RAM for single user |
| **API** | Full Client-Server API via HTTP: creating rooms, sending messages, reading, search all work with simple curl |
| **SDKs** | matrix-rust-sdk (mature), matrix-js-sdk, matrix-nio (Python), matrix-commander (CLI) |
| **Why NO-GO** | You're running a federation-capable chat server for one person talking to themselves. The encryption layer alone (Olm sessions, Megolm ratchets, device trust) is more complex than our entire app needs to be. Homeserver maintenance, database migrations, spec compliance: all overhead for zero benefit in a single-user context. |

**References**: [Conduwuit](https://github.com/x86pup/conduwuit), [Matrix Client-Server API](https://spec.matrix.org/latest/client-server-api/), [Matrix SDKs](https://matrix.org/ecosystem/sdks/)

#### Option B: Memos + Encryption Layer: NO-GO
**Verdict**: Fighting the tool. Encryption breaks Memos' core value.

| Factor | Assessment |
|--------|-----------|
| **Memos architecture** | Single Go binary, React frontend, SQLite/Postgres, gRPC + REST via grpc-gateway |
| **API** | Excellent: full CRUD for memos, tags, resources (attachments), webhooks |
| **Memogram** | Telegram bot that syncs messages to Memos via API: great convenience |
| **Client-side encryption feasibility** | Could encrypt content before API calls, decrypt after fetch |
| **What breaks** | Server-side search (can't search ciphertext), web UI (renders ciphertext unless we fork frontend), Memogram (needs encryption layer added), tags (encrypt = no filtering, cleartext = metadata leak) |
| **Why NO-GO** | Adding E2E encryption to Memos defeats its core strengths (search, web UI, Telegram integration). You'd be maintaining a fork of a 46K-star project just to break its features. If encryption isn't needed, Memos is great as-is. If encryption IS needed, build something encryption-first. |

**References**: [Memos API](https://usememos.com/docs/api), [Memos DeepWiki](https://deepwiki.com/usememos/memos/4.5-api-documentation-and-protocols), [Memogram](https://github.com/usememos/telegram-integration)

#### Option C: age + Commodity Blob Storage: GO ✓
**Verdict**: Simplest viable architecture. Encryption-first, no server to maintain.

---

## Chosen Architecture: age + Blob Storage

### Overview

```
┌─────────────────────────────────────────────────────┐
│                    Note to Self                      │
├─────────────────────────────────────────────────────┤
│                                                      │
│  CLI (nts)          Mobile (PWA)        Webhooks     │
│     │                   │                   │        │
│     └───────────┬───────┘                   │        │
│                 │                           │        │
│          ┌──────▼──────┐            ┌───────▼──────┐ │
│          │  age encrypt │            │ age encrypt  │ │
│          │  / decrypt   │            │ (public key) │ │
│          └──────┬──────┘            └───────┬──────┘ │
│                 │                           │        │
│          ┌──────▼───────────────────────────▼──────┐ │
│          │         Blob Storage (S3/R2)            │ │
│          │    (dumb store: never sees plaintext)  │ │
│          └──────┬──────────────────────────────────┘ │
│                 │                                    │
│          ┌──────▼──────┐                             │
│          │  ntfy.sh    │  ← notification only        │
│          │  (optional) │    ("New note arrived")     │
│          └─────────────┘                             │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Core Components

#### 1. Encryption: `age`

**Why age**: Created by Filippo Valsorda (Go's crypto lead). Simple, modern, audited. No PGP complexity. The `passage` project (1000+ stars) proves this pattern works for password management.

| Feature | Detail |
|---------|--------|
| Algorithm | X25519 + ChaCha20-Poly1305 |
| Key generation | `age-keygen` → public key + identity file |
| Encrypt | `age -r <public_key> -o msg.age plaintext` |
| Decrypt | `age -d -i identity.txt msg.age` |
| Post-quantum | Hybrid X25519 + ML-KEM-768 keys available |
| Libraries | **Go**: `filippo.io/age` (reference impl), **Rust**: `rage` crate, **JS**: `age-encryption` npm package |
| Performance | Negligible for small messages; ChaCha20 at ~1GB/s on modern hardware |
| Hardware keys | `age-plugin-yubikey` for YubiKey-based identity |

**Key management model**: Single X25519 keypair per user. Identity file stored locally on each device. Public key used by webhooks/automation to encrypt without decryption ability.

**References**: [age GitHub](https://github.com/FiloSottile/age), [rage (Rust)](https://crates.io/crates/age), [age-encryption (npm)](https://www.npmjs.com/package/age-encryption), [passage](https://github.com/FiloSottile/passage)

#### 2. Storage: Cloudflare R2 (primary recommendation)

| Backend | Free Tier | Egress | S3 Compatible | Latency | Notes |
|---------|-----------|--------|---------------|---------|-------|
| **Cloudflare R2** | 10GB storage, 10M reads, 1M writes/mo | **Free** | Yes | Low (edge) | Best overall for personal use |
| Supabase Storage | 1GB | Included | Yes | Low | Has Realtime for push; good alternative |
| AWS S3 | 5GB (12mo) | $0.09/GB | Yes (native) | Low | Overkill, egress costs |
| Backblaze B2 | 10GB | Free with CF partnership | Yes | Medium | Good budget option |
| Git repo | Unlimited (GitHub) | Free | No | High | Simplest possible; bad for large files |

**R2 rationale**: Zero egress fees means we can sync aggressively without cost concern. S3-compatible API means we can swap backends trivially. 10GB free tier is more than enough for text messages.

#### 3. Message Format

Each message is stored as an individual encrypted blob in the storage backend.

**Blob naming**: `messages/{timestamp_ms}_{random_8chars}.age`
- Timestamp prefix enables chronological listing via S3 prefix scan
- Random suffix prevents collisions
- `.age` extension identifies encrypted content

**Plaintext envelope** (before encryption):
```json
{
  "v": 1,
  "id": "1710000000000_a1b2c3d4",
  "content": "The actual message text",
  "content_type": "text/plain",
  "tags": ["work", "urgent"],
  "ttl": 14400,
  "created_at": "2026-03-10T12:00:00Z",
  "device": "cli-macbook",
  "attachments": [
    {
      "name": "screenshot.png",
      "content_type": "image/png",
      "size": 245000,
      "ref": "attachments/1710000000000_a1b2c3d4/screenshot.png.age"
    }
  ]
}
```

**What's encrypted**: Everything. The blob name leaks only the approximate timestamp and that a message exists.

**What's NOT encrypted**: Nothing on the server. Even the index (see below) is encrypted.

#### 4. Index & Sync Protocol

**Index blob**: `index.age`: encrypted JSON array of message metadata.

```json
[
  {
    "id": "1710000000000_a1b2c3d4",
    "created_at": "2026-03-10T12:00:00Z",
    "tags": ["work"],
    "ttl": 14400,
    "status": "unread",
    "content_preview": "The actual message..."
  }
]
```

**Sync flow**:
1. On any mutation (push/pop/ack), client fetches `index.age`, decrypts, updates, re-encrypts, uploads
2. On read (peek/list), client fetches `index.age`, decrypts, filters
3. Full message fetch only when needed (peek/pop/search)

**Conflict resolution**: Last-write-wins on index. Since this is single-user, conflicts only happen if two devices mutate simultaneously: extremely rare. For v1, this is acceptable. Future: add optimistic locking via S3 conditional writes (If-None-Match).

**TTL enforcement**: On each index fetch, client checks TTL. Expired messages get status set to "expired" and blobs are deleted lazily.

#### 5. Notification Layer: ntfy.sh

**Role**: Notify devices that a new message arrived. Never carries message content.

| Feature | Detail |
|---------|--------|
| **Send** | `curl -d "New note" ntfy.sh/nts-{user_hash}` |
| **Auth** | Access tokens for private topics |
| **Self-host** | Single binary, ~12MB Docker image |
| **Rate limits** | Free tier: 250 msgs/day. Self-hosted: unlimited |
| **Platforms** | Android (native), iOS (via polling), Web |
| **Actions** | Notification buttons ("View", "Dismiss") |
| **Priority** | 1-5 scale; affects notification behavior |
| **Delay** | Scheduled delivery: `Delay: 30m` header |

**Integration pattern**:
```
nts push "message"
  → age encrypt → upload to R2
  → update index.age
  → curl ntfy.sh/nts-{hash} -d "New note" -H "Priority: 3"

Phone receives notification → opens PWA → fetches index.age → decrypts → shows message
```

**Why ntfy over alternatives**:
- Gotify: Similar but less mature mobile support, no iOS
- Pushover: Proprietary, $5 one-time per platform
- Apple/Google Push directly: Requires app store approval, complex setup
- Web Push API: Unreliable on iOS, requires service worker

**References**: [ntfy.sh docs](https://docs.ntfy.sh/), [ntfy GitHub](https://github.com/binwiederhier/ntfy)

### CLI Design: `nts`

Inspired by `passage` (age-based password store) and `todo.txt` CLI.

```bash
# Setup
nts init                          # Generate keypair, configure storage
nts config set storage.backend r2 # Configure R2 bucket
nts config set ntfy.topic nts-abc # Configure notifications

# Core queue operations
nts push "meeting at 3pm"                    # Push a text message
nts push "grab milk" --ttl 4h                # Push with auto-expiry
nts push --file screenshot.png               # Push a file
echo "$(pbpaste)" | nts push --tag clipboard # Pipe from clipboard
nts push "deploy notes" --tag work --tag ops # Multiple tags

# Reading
nts peek                          # Show latest unread message
nts pop                           # Read + mark as consumed
nts list                          # List all messages (summary)
nts list --tag work               # Filter by tag
nts list --status unread          # Filter by status
nts show <id>                     # Show full message by ID

# Management
nts ack <id>                      # Mark as read without deleting
nts delete <id>                   # Permanently delete
nts purge --expired               # Clean up expired messages
nts search "api key"              # Full-text search (local decrypt + search)

# Webhook receiver (for automation)
nts webhook serve --port 8888     # Start webhook listener
# External service POSTs to localhost:8888 → encrypts with public key → uploads
```

**Config location**: `~/.config/nts/` or `$NTS_HOME`
- `identity.txt`: age private key (600 permissions)
- `config.toml`: storage backend, ntfy topic, preferences
- `recipients.txt`: public key(s)

#### 6. Mobile Access

**Primary: PWA (Progressive Web App)**

| Concern | Solution |
|---------|----------|
| age in browser | `age-encryption` npm package: pure JS implementation |
| Key storage | Web Crypto API + IndexedDB (encrypted at rest by browser) |
| Offline | Service Worker caches index + recent messages |
| Push notifications | ntfy.sh web subscription or Web Push API |
| File access | File API for attachments |

**Why PWA over native**:
- No app store approval needed
- Single codebase for iOS + Android + desktop
- age-encryption npm package works in browser
- Can be "installed" as home screen app
- For v1, this is the fastest path to mobile access

**Future: React Native / Expo**
- For a more polished experience later
- Native push notifications
- Background sync
- Biometric unlock for identity file

### Tech Stack Summary

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| CLI | **Rust** (with `rage` crate) | Fast, single binary, age native support |
| Encryption | **age** (X25519 + ChaCha20-Poly1305) | Simple, audited, ecosystem support |
| Storage | **Cloudflare R2** | Zero egress, S3-compatible, generous free tier |
| Notifications | **ntfy.sh** | Simple, self-hostable, good mobile support |
| Mobile | **PWA** (TypeScript) | Cross-platform, no app store, age-encryption.js |
| Local AI | **Ollama** (optional) | Runs locally, never sees server |

### Security Model

| Threat | Mitigation |
|--------|-----------|
| Storage provider reads messages | All blobs are age-encrypted; provider sees only ciphertext |
| Network eavesdropping | TLS for all transport; content is encrypted regardless |
| Device theft | Identity file can be passphrase-protected; mobile: biometric lock |
| Webhook sender impersonation | Webhooks encrypt with public key; only identity holder can decrypt |
| Notification content leak | ntfy carries only "new note arrived", never message content |
| Index metadata leak | Index is encrypted too; blob names leak only approximate timestamps |
| Key compromise | Rotate keypair; re-encrypt all messages with new key |

### Non-Goals (v1)

- **Multi-user / sharing**: This is for one person. No sharing, no collaboration.
- **Rich text editing**: Messages are plain text or markdown. Not a document editor.
- **Offline-first CRDT sync**: Simple last-write-wins is fine for single-user v1.
- **Federation**: No Matrix-style federation. One user, one storage bucket.
- **App store presence**: PWA first. Native apps are a future concern.

## Pending decisions

> These will get full ADRs when we act on them. Format follows the global Deferred Decision Logging Rule, Pattern 1 (forward-looking seeds).

### Post-quantum recipients

**Status**: Deferred. Not on the roadmap. Revisit on the unblock conditions below.

**Workstream tag**: crypto / sync.

**What's available now**: age v1.3.0 (released December 2025) added hybrid post-quantum recipients. The hybrid combines the existing X25519 classical recipient with ML-KEM-768, the NIST FIPS 203 standardized lattice KEM derived from CRYSTALS-Kyber. A single age file can list both a classical recipient and a PQ recipient; decryption requires the identity matching one of them. The `rage` Rust crate tracks upstream age; PQ recipient support in `rage` needs verification before any implementation. TODO for fact-check: confirm the exact `rage` crate version that exposes ML-KEM-768 hybrid recipients, and confirm whether the `age-encryption` npm package has shipped equivalent support (it had not as of the 2026-05 landscape pass).

**Why this matters even for a personal queue**: The "store now, decrypt later" (HNDL) threat model assumes an adversary records ciphertext today and decrypts it years later once a cryptographically relevant quantum computer exists. X25519 is broken by Shor's algorithm on such a machine; ChaCha20-Poly1305 is not (symmetric primitives degrade by a Grover factor, which 256-bit keys absorb). For nts the affected surface is every blob in R2 plus the encrypted index. R2 is a third-party blob store. A nation-state or well-funded actor that captures a snapshot of the bucket today and waits keeps the right to read every personal note. Personal-queue content includes API keys, passwords pasted as reminders, location notes, medical reminders, and journal entries. The blast radius is small per user but the data is intimate and long-lived. HNDL is the threat that justifies PQ even when no live adversary exists.

**Why we are deferring**:

- **Ecosystem maturity**: age v1.3.0 PQ is months old. The hybrid construction is sound on paper but has not had the years of cryptanalysis the classical X25519 path has. ML-KEM itself is standardized, but its integration into the age format is new.
- **Library coverage**: `rage` and `age-encryption` npm need to both ship PQ support before nts can write hybrid recipients on the CLI and read them in the PWA. As of the 2026-05 landscape pass, the npm package had not shipped PQ. Adopting on the CLI alone would lock PWA users out of new messages.
- **Performance overhead**: ML-KEM-768 public keys are about 1184 bytes and ciphertexts are about 1088 bytes, against 32 bytes for X25519. Hybrid recipients add roughly 1KB of header per blob. For our envelope (typical message under 1KB) this can double the on-wire size. On R2 with 10GB free this is not a cost concern; on mobile sync over poor connections it is a UX concern.
- **PWA / browser performance**: M4 introduces the PWA via `age-encryption` npm. ML-KEM key encapsulation in pure JavaScript on a mid-range Android phone is materially slower than X25519 (single-digit milliseconds versus sub-millisecond). For a queue that decrypts a list of N message headers on every refresh, this matters. We should benchmark before committing.
- **Bytes on wire**: Per blob, hybrid headers add ~1KB. For a heavy user with thousands of messages the index size and per-blob overhead grow noticeably. Not blocking; worth measuring.
- **No live adversary**: nts is a personal tool. There is no published HNDL adversary actively snapshotting personal R2 buckets at scale today. The cost of adopting early outweighs the marginal risk reduction.

**Unblock conditions** (revisit when these are true):

1. NIST FIPS 203 (ML-KEM) has gone through one full revision cycle without breaking changes, indicating the parameter set is stable.
2. `age-encryption` npm package ships ML-KEM-768 hybrid recipient support and the PWA can decrypt hybrid blobs without unacceptable latency on a mid-range phone.
3. `rage` exposes hybrid recipient APIs in a stable release.
4. We observe credible evidence that an adversary capable of HNDL at scale exists, or that a cryptographically relevant quantum computer is within a five-year horizon.

Any two of the first three plus condition four moves this into an active ADR.

**Migration plan when we act**:

- age recipients are extensible by design. An age file can list any number of recipient stanzas; decryption succeeds if the identity matches any one of them. We will add ML-KEM-768 hybrid as a second recipient alongside the existing X25519 recipient. New blobs get written with both. Old blobs stay decryptable because the X25519 identity remains valid.
- The `recipients.txt` config grows to include the PQ public key. The identity file grows to include the PQ private key.
- A one-time `nts re-encrypt --pq` migration re-encrypts the index and existing blobs with the hybrid recipient list. This is optional; users who skip it lose only forward HNDL protection on pre-migration messages.
- Key rotation flow already exists in concept (rotate keypair, re-encrypt). PQ adoption reuses that path.
- The PWA must support hybrid blobs before the CLI starts writing them, or PWA users see undecryptable messages.

**Risks of adopting too early**:

- **Immature crypto**: ML-KEM is standardized but young. A parameter break or implementation flaw would force a re-migration. The hybrid construction protects against classical breaks of ML-KEM (X25519 still holds) but not against an age format-level bug.
- **Performance regression**: PWA decrypt times on mobile may degrade the queue UX. The whole point of the queue is fast peek/pop; a 50ms hit per blob on a list view is noticeable.
- **Lock-in to a specific KEM**: If NIST revises ML-KEM parameters or age switches to a different KEM, early adopters carry a migration. Waiting for one revision cycle lets us skip that.
- **Bytes on wire**: Doubling per-blob size for users who do not face HNDL is a real cost in storage and sync time, paid for a hypothetical adversary.
- **Operational complexity**: Two recipients in `recipients.txt`, two identities in the identity file, and a migration command all add surface area for confusion and bugs. Worth it only when the threat is real or the ecosystem treats PQ as default.

**Action when codified**: This entry becomes a numbered ADR under the main architecture decisions, the security model table gains a "Quantum adversary" row, the roadmap gains a `--pq` milestone, and CLAUDE.md's Architecture section gets a one-line note about hybrid recipients.

## Deferred decisions (analyzed, correctly deferred)

These are decisions a future contributor will be tempted to revisit. Each entry records what was considered, why it is not being done now, and what would unblock the call. Pattern follows the global Deferred Decision Logging Rule (Pattern 2: "Items deliberately NOT being done now, with rationale").

### CRDT library for index merge

- [ ] **Decision**: Do not adopt Automerge, Yjs, or any other CRDT library for `index.age` reconciliation. Keep the custom status-ordinal merge in `src/merge.rs` and its TypeScript port planned for the PWA (`web/src/core/merge.ts`).
- [ ] **Why it is not done now**: a CRDT library is the wrong shape for this problem.

#### What we built instead

A status-ordinal lattice plus a local/remote role asymmetry. The shape:

- `MessageStatus` has a total order via `MessageStatus::ordinal()` in `src/index.rs`: `Unread (0) < Read (1) < Consumed (2) < Expired (3)`. Deletion is not a status. Deletes are expressed as removal from the index plus an entry in `pending_deletes`.
- `MessageStatus::max_status(a, b)` is commutative and idempotent. When the same id appears on two devices, the merged status is the maximum by ordinal. Status only moves forward.
- `merge(local, remote, pending_ids, pending_deletes)` in `src/merge.rs` reconciles two index snapshots. `pending_ids` and `pending_deletes` are *local-device state*, not shared state. They are read from the local `sync_state.json` and never travel with the remote index.

The roles of `local` and `remote` are asymmetric on purpose:

- A `local`-only entry that is **not** in `pending_ids` is read as "another device deleted this while we were offline" and dropped.
- A `remote`-only entry that is **not** in `pending_deletes` is read as "another device added this while we were offline" and kept.

Swapping `local` and `remote` flips both of those decisions, so `merge(A, B, ...)` does not equal `merge(B, A, ...)` in general. That is the correct behavior, not a bug.

#### The non-commutativity invariant and the proptest pass that surfaced it

The proptest suite in `src/merge.rs` (commit `d5dbaac`) originally included a property called `proptest_merge_is_commutative_when_no_pending` that asserted `merge(A, B, ∅, ∅) == merge(B, A, ∅, ∅)`. The property failed and was narrowed to a single-id counterexample: one side has the id, the other does not, no pending state on either side. The full-swap property was removed and replaced with two narrower properties that hold:

- `proptest_merge_converges_on_shared_ids`: for any id present in BOTH inputs, the merged status is the same regardless of merge direction. This is the system-level symmetry that status reconciliation actually provides: `max_status` is commutative.
- `proptest_merge_is_idempotent`: re-merging the result against the same remote yields the same set of ids and statuses (with empty pending state, the steady state right after a successful sync).

The minimal counterexample is captured as a regression test, `test_merge_is_not_commutative_for_unilateral_entries`, so anyone tempted to "fix" the asymmetry sees the intended semantics first.

#### Why a CRDT library was rejected

| Reason | Detail |
|--------|--------|
| Designed for multi-writer documents | Automerge and Yjs target collaborative editing: many writers, branching histories, character-level conflict resolution. Our index has one logical writer (the user) across several devices. The convergence work a CRDT does is overkill. |
| Wrong data shape | Our index is a JSON array of metadata records. Automerge stores a binary CRDT log; Yjs stores a Y.Doc tree. Either choice would force a new on-the-wire format and a new ciphertext envelope. The current `index.age` is "encrypt a JSON blob" and that is the entire format. |
| Single user, multi-device | We do not have multi-writer conflicts in the CRDT sense. We have at most a few seconds of divergence between a phone and a laptop. Last-write-wins on immutable fields plus a status-ordinal lattice on the one mutable field covers every real conflict. |
| Queue semantics map cleanly to status transitions | `push` creates an `Unread` entry. `peek` does not transition. `pop` transitions to `Consumed`. `ack` transitions to `Read`. TTL expiry transitions to `Expired`. Every transition moves forward in the ordinal. There is no semantic conflict to resolve, only a max to take. |
| Large dependency, real WASM cost | Adding Automerge to the Rust CLI is one dep. Adding it to the `age-encryption` PWA is a WASM build, a bundle-size hit measured in tens of KB, and a new debugging surface in the browser. The PWA bundle budget is under 100 KB gzipped excluding age. A CRDT library blows past that. |
| The current merge is one file | `src/merge.rs` is under 50 lines of merge logic. The proptest pass verifies seven invariants on it. The cost of maintaining this is lower than the cost of taking a CRDT dependency and learning its failure modes. |

#### What we guarantee instead

The properties verified by the proptest pass at `src/merge.rs`:

- **Idempotence** (`proptest_merge_is_idempotent`): merging twice with the same remote yields the same output as merging once.
- **Status monotonicity** (`proptest_merge_status_is_monotonic`): for any id in both inputs, the merged status ordinal is greater than or equal to both input ordinals. Status never moves backward.
- **No spontaneous resurrection** (`proptest_no_spontaneous_resurrection`): an id in `pending_deletes` that exists only on the remote does not appear in the merged output.
- **No spontaneous loss** (`proptest_no_spontaneous_loss`): an id in `pending_ids` that exists only locally appears in the merged output.
- **No duplicates** (`proptest_merge_has_no_duplicate_ids`): every id appears at most once in the merged output.
- **Closed universe** (`proptest_merge_invents_no_ids`): every id in the merged output came from either local or remote. The merge function never invents ids.
- **Convergence on shared ids** (`proptest_merge_converges_on_shared_ids`): for ids in both inputs, the merged status is identical regardless of merge direction.

The system-level convergence guarantee (two devices reach the same index given enough sync passes) is enforced at the sync layer in `src/sync.rs` via ETag-conditional writes, not at the merge layer.

#### Unblock conditions

Revisit this decision if any of the following becomes true:

- **Multi-user collaborative inbox**: if `note-to-self` grows a shared-inbox feature where two distinct users mutate the same index, the local/remote asymmetry breaks down. A CRDT becomes the right tool because we then have real multi-writer conflicts.
- **Branching offline divergence with richer-than-LWW conflict semantics**: if a future field on `IndexEntry` is genuinely mutable and not totally orderable (free-form tags edited concurrently, a notes field that gets appended to from multiple devices), max-by-ordinal stops being enough. Tag merging that does set-union with tombstones is already CRDT shape.
- **Ack flow that needs vector clocks**: if read/consumed tracking grows per-device semantics (this device has read it, that device has not), the single global status ordinal cannot represent that. Per-device vectors are CRDT shape.

Until one of those is in scope, the status-ordinal lattice is the correct fit and the proptest pass is the load-bearing verification.

#### Cross-reference to the PWA spec

The Milestone 4 PWA design spec (`docs/superpowers/specs/2026-05-11-milestone4-pwa-design.md`) calls for a TypeScript port of `merge` at `web/src/core/merge.ts`. The pseudocode in that spec passes `pendingIds` and `pendingDeletes` from local `sync_state` into the merge call, which preserves the local/remote asymmetry described here. The port must:

- Treat `local` and `remote` as asymmetric arguments. Do not refactor toward a symmetric signature.
- Carry `pendingIds` and `pendingDeletes` from local state, never from the remote.
- Port the proptest fixtures from `tests/fixtures/merge/` (when added) byte-identically. Vitest assertions on shared fixtures are the integrity check that the two implementations agree.

## ADR: Env-var-resolved secrets with 1Password seeding via shell init

Decision date: 2026-05-12. Lands as part of milestone M4b.

### Context

The CLI was loading three secrets directly from on-disk plaintext:

1. `r2.access_key_id` and `r2.secret_access_key` from `config.toml`.
2. `notify.ntfy.token` from `config.toml`.
3. The age secret identity from `identity.txt`.

The fallback is FileVault disk encryption. That is real protection at rest, but it does not contain a leak via iCloud backups, Time Machine, a misconfigured directory permission, or any of the dozen ways a config file leaves the machine in a developer's lifetime.

### Decision

The CLI itself never shells out to 1Password. Instead, each secret is resolvable from a named environment variable, and shell init seeds those env vars from 1Password on cold-start.

Config schema additions (all optional, all back-compat):

- `storage.r2.access_key_id_env`: env var name for the R2 access key ID.
- `storage.r2.secret_access_key_env`: env var name for the R2 secret.
- `notify.ntfy.token_env`: env var name for the ntfy bearer token.
- `NTS_AGE_IDENTITY`: env var (no config field; identity-from-env is opted into by simply setting the env var).

Resolution order at every read site:

1. If `*_env` is set in config and the named env var resolves non-empty, use the env var value.
2. Else if the plaintext field is set in config, use that.
3. Else fail with a message pointing at the shell-init pattern.

The Rust code does not invoke `op` or any other secret-store CLI. That is shell init's job (see "How shell init seeds the env vars" below).

### Alternatives considered

- **CLI shells out to `op read`** on every command. Rejected because every `op read` triggers a Touch ID prompt and `op` CLI sessions do not propagate across subprocesses. Every `nts push` would prompt for biometrics: degrading the CLI from "single keystroke" to "single keystroke plus authenticator dance."
- **macOS Keychain via `security find-generic-password`.** Considered. The atrib pattern uses Keychain as the primary store with 1P as a recovery path. Deferred until NTS has multi-device-on-the-same-machine pressure; adopting Keychain now is more migration burden than it saves.
- **Just leave it in `config.toml`.** Rejected. The leak surface is real and the migration is cheap.

### How shell init seeds the env vars

The `~/.zshenv` snippet is documented in `web/README.md` ("Moving secrets to 1Password"). The pattern mirrors the existing `NVIDIA_API_KEY` block in the same file:

- Idempotency guard: `[[ -z "$NTS_R2_SECRET_ACCESS_KEY" ]]` so subshells inherit silently.
- Cache file at `~/.nts/secrets/<name>` mode 0600.
- `op` is consulted only when both the parent env and the cache are empty.
- `op --account=YMWE45M5BRCSZIN37BO4RC4JPE` pins the canonical Helmy Family account (USER_ID is permanent; emails and shorthands are editable).
- Failure modes (cache absent, `op` locked, op missing) all degrade silently. The CLI's own error messages handle the "neither env nor inline resolves" case at the read site.

### Trade-offs

- **Coupling to shell init.** A user who runs the CLI from a non-shell environment (a system service, a one-off cron, a different shell) needs to seed the env vars themselves. Documented in `web/README.md`.
- **Cache rotation.** Keys do not auto-refresh; the user must `rm ~/.nts/secrets/<name>` to re-seed from 1P. Acceptable because R2 keys and age identities rotate rarely; the ntfy token never rotates in practice. Documented inline in the shell-init block.
- **Two accounts.** The 1Password CLI rejects unpinned `op read` calls when multiple accounts are signed in (the case on this machine: Helmy Family + MATTR work). Pinning by USER_ID prevents the wrong account from being consulted.

### Migration

Plaintext fields stay readable for backwards compat. The migration is opt-in per secret:

1. Save the secret value in 1P (already done for R2 and identity; see items `Cloudflare nts-messages API key` and `NTS Identity Backup` in `Private` vault).
2. Add the shell-init block to `~/.zshenv`. Open a new shell to trigger the cold-start `op read`.
3. Run `nts config set <key>_env <ENV_NAME>` for each migrated secret.
4. For R2 and ntfy: optionally remove the plaintext field via direct `config.toml` edit. For the age identity: optionally delete `identity.txt` once `NTS_AGE_IDENTITY` resolves correctly.

The legacy plaintext fields will be removed in M5.

### Addendum: sandboxed-install guard (added 2026-05-13)

A subtle footgun surfaced in the audit: when `NTS_AGE_IDENTITY` is set in the user's shell (via the ~/.zshenv pattern above), running `NTS_HOME=/tmp/other nts init` would write a fresh `identity.txt` to that directory but every subsequent `nts` command would silently read the shell-env identity instead, encrypting to the production recipient with the wrong sandbox.

`load_identity_string` in `src/commands/mod.rs` now treats `NTS_HOME` being set as a strong signal of "isolated install" and skips the env-var fallback entirely. The shell-env path remains the default when `NTS_HOME` is unset (the standard production case).

This is the kind of footgun that the ADR's "env-resolved secrets" approach introduces by definition: as soon as the environment becomes a source of truth, the CLI must distinguish "I'm the primary install reading my env" from "I'm a sandboxed install whose env should be ignored." We picked `NTS_HOME` as the discriminator because it's already the override mechanism for the data directory.

## ADR: Worker as the only network egress from the PWA

Decision date: 2026-05-13. Lands as part of milestone M4b.

### Context

The PWA originally tried to POST directly to `ntfy.sh` from the browser when composing a new message. This silently failed under the deployed Content Security Policy (`connect-src 'self' https://*.workers.dev`), which has no entry for `https://ntfy.sh`. The failure was invisible because the compose code swallows ntfy errors (per design: R2 upload is what matters, ntfy is best-effort).

### Decision

The PWA never connects to any origin other than the Worker. All ntfy publishes from the PWA go through a new `POST /v1/notify` endpoint on the Worker, which validates the bearer token (same as `/v1/index` and `/v1/messages/:id`), accepts a JSON payload `{ server, topic, body, title?, priority?, click?, token? }`, and forwards as a normal ntfy POST server-side. Status is propagated back to the caller verbatim so the PWA still sees rate-limit / network errors from upstream.

The Worker stores no ntfy state. Caller owns the topic and server values, which travel through the bundle from CLI → PWA at import time.

### Why not widen the CSP

Direct PWA → ntfy would have been one line in `web/index.html` (`connect-src 'self' https://*.workers.dev https://ntfy.sh`). Rejected for two reasons:

1. **Compromised JS can exfiltrate.** Any XSS or supply-chain compromise inside the PWA would have a fresh egress channel via the topic name to ntfy.sh. Going through the Worker means the only origin the PWA can talk to is the one we control.
2. **Easier to swap providers.** When M4b's Web Push lands, the Worker becomes the natural orchestrator (it fans out from `/v1/notify` to subscribed Service Workers via VAPID). The PWA-side code stays the same: it still calls `POST /v1/notify`: and the Worker swaps its upstream from ntfy.sh to Web Push gateways. The architectural slot was already in place.

### Open-proxy concern

Any device-token holder can POST `server: https://arbitrary-host/...` to `/v1/notify` and the Worker will forward. A stolen bearer is effectively an authenticated SSRF surface. Mitigations to consider in M5: allowlist `server` to ntfy hosts only; rate-limit per-token; strip non-X-* outgoing headers (already done: only X-Title, X-Priority, X-Click, Authorization are forwarded). Captured as the final M4b checkbox in `docs/roadmap.md`.

### Unified body format

CLI's `build_body` and PWA's `buildNtfyBody` produce byte-identical strings: `new note · tag1, tag2 · expires in 4h`. The PWA's compose test references the Rust fixtures by comment so future drift is caught at unit-test time.

### X-Click semantics

When `storage.pwa_base_url` is configured on the CLI, push notifications carry `X-Click: {pwa_base_url}/m/{id}`. On the PWA side, compose uses `window.location.origin` as the base. Tapping the notification on a phone opens that URL in Safari, deep-linking into the specific message view (which fetches the encrypted blob via the Worker, decrypts in-browser).

The PWA-side `window.location.origin` has a footgun: composing from a Pages preview deployment (`https://abc123.nts-pwa.pages.dev`) pins X-Click to that ephemeral URL. Cloudflare GCs previews after ~30 days, breaking the old notifications. The CLI's `pwa_base_url` is the stable answer; the PWA could mirror this via device config to harden against the preview-pinning case (M4b polish).
