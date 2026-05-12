# Note to Self

An encrypted personal message queue you talk to from the terminal: push, peek, pop, ack, synced across your devices.

## Why

- Self-messaging with queue semantics (push/peek/pop/ack), not a notes app.
- End-to-end encrypted by default using `age`. Storage never sees plaintext.
- CLI-first. `nts push "remember this"` from any terminal.
- No account. Just an age keypair and a storage bucket you own.

## Example

```sh
nts init                       # generate keypair, write config
nts push "meeting at 3pm"      # encrypt and queue a message
nts peek                       # decrypt and show the latest unread
```

Other useful commands: `nts pop`, `nts list`, `nts search "api key"`, `nts sync`, `nts status`.

## Install

Pre-1.0. Build from source:

```sh
git clone https://github.com/naderhelmy/note-to-self
cd note-to-self
cargo install --path .
nts --help
```

Requires a recent stable Rust toolchain. The binary is named `nts`.

## Status

| Milestone | State |
|-----------|-------|
| M1: CLI with age encryption (local storage) | done |
| M2: Cloudflare R2 sync with ETag locking | done |
| M3: ntfy.sh push notifications | done |
| M4: PWA for mobile access | in design |
| M5: Webhook ingestion | planned |
| M6: File attachments | planned |
| M7: Local search / optional Ollama | planned |

Test suite: 60 unit tests plus 20 integration tests, run with `cargo test`.

## Architecture

Messages are encrypted client-side with `age` (X25519 + ChaCha20-Poly1305) and stored as opaque blobs in Cloudflare R2. An encrypted index drives queue operations, with ETag optimistic locking for cross-device sync. Notifications go through ntfy.sh and carry only a "new note arrived" signal: the message body is never sent to the notification service. The CLI is a Rust binary today; a PWA using the `age-encryption` npm package is next. See `docs/architecture.md` for the full design, security model, and rejected alternatives (Matrix, Memos plus encryption).

## Docs

- `docs/architecture.md`: technical design, security model, tech stack.
- `docs/roadmap.md`: milestone-by-milestone plan and current state.
- `docs/research.md`: landscape research and competitive analysis.
- `CLAUDE.md`: project overview, principles, and dev instructions.
