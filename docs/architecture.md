# Note to Self — Architecture

## Decision: Build Custom (age + blob storage)

### Options Evaluated

#### Option A: Matrix Protocol Backend — NO-GO
**Verdict**: Overkill for single-user self-messaging.

| Factor | Assessment |
|--------|-----------|
| **Encryption** | E2E via Olm/Megolm — battle-tested, but requires complex key management (cross-signing, device verification, key backup/recovery) |
| **Lightest server** | Conduwuit (Rust fork of Conduit): ~500MB DB, negligible CPU/RAM for single user |
| **API** | Full Client-Server API via HTTP — creating rooms, sending messages, reading, search all work with simple curl |
| **SDKs** | matrix-rust-sdk (mature), matrix-js-sdk, matrix-nio (Python), matrix-commander (CLI) |
| **Why NO-GO** | You're running a federation-capable chat server for one person talking to themselves. The encryption layer alone (Olm sessions, Megolm ratchets, device trust) is more complex than our entire app needs to be. Homeserver maintenance, database migrations, spec compliance — all overhead for zero benefit in a single-user context. |

**References**: [Conduwuit](https://github.com/x86pup/conduwuit), [Matrix Client-Server API](https://spec.matrix.org/latest/client-server-api/), [Matrix SDKs](https://matrix.org/ecosystem/sdks/)

#### Option B: Memos + Encryption Layer — NO-GO
**Verdict**: Fighting the tool. Encryption breaks Memos' core value.

| Factor | Assessment |
|--------|-----------|
| **Memos architecture** | Single Go binary, React frontend, SQLite/Postgres, gRPC + REST via grpc-gateway |
| **API** | Excellent — full CRUD for memos, tags, resources (attachments), webhooks |
| **Memogram** | Telegram bot that syncs messages to Memos via API — great convenience |
| **Client-side encryption feasibility** | Could encrypt content before API calls, decrypt after fetch |
| **What breaks** | Server-side search (can't search ciphertext), web UI (renders ciphertext unless we fork frontend), Memogram (needs encryption layer added), tags (encrypt = no filtering, cleartext = metadata leak) |
| **Why NO-GO** | Adding E2E encryption to Memos defeats its core strengths (search, web UI, Telegram integration). You'd be maintaining a fork of a 46K-star project just to break its features. If encryption isn't needed, Memos is great as-is. If encryption IS needed, build something encryption-first. |

**References**: [Memos API](https://usememos.com/docs/api), [Memos DeepWiki](https://deepwiki.com/usememos/memos/4.5-api-documentation-and-protocols), [Memogram](https://github.com/usememos/telegram-integration)

#### Option C: age + Commodity Blob Storage — GO ✓
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
│          │    (dumb store — never sees plaintext)  │ │
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

**Index blob**: `index.age` — encrypted JSON array of message metadata.

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

**Conflict resolution**: Last-write-wins on index. Since this is single-user, conflicts only happen if two devices mutate simultaneously — extremely rare. For v1, this is acceptable. Future: add optimistic locking via S3 conditional writes (If-None-Match).

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
- `identity.txt` — age private key (600 permissions)
- `config.toml` — storage backend, ntfy topic, preferences
- `recipients.txt` — public key(s)

#### 6. Mobile Access

**Primary: PWA (Progressive Web App)**

| Concern | Solution |
|---------|----------|
| age in browser | `age-encryption` npm package — pure JS implementation |
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
