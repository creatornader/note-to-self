# Note to Self

An encrypted personal message queue you talk to from the terminal or your phone: push, peek, pop, ack, synced across your devices.

## Why

- Self-messaging with queue semantics (push/peek/pop/ack), not a notes app.
- End-to-end encrypted by default using `age`. Storage never sees plaintext.
- CLI-first. `nts push "remember this"` from any terminal.
- Mobile reachable. Read and compose from a PWA on your phone.
- No account. Just an age keypair and a storage bucket you own.

## Example

```sh
nts init                       # generate keypair, write config
nts push "meeting at 3pm"      # encrypt and queue a message
nts peek                       # decrypt and show the latest unread
```

Other useful commands: `nts pop`, `nts list`, `nts search "api key"`, `nts sync`, `nts status`, `nts device add`.

## Install

Pre-1.0. Build from source:

```sh
git clone https://github.com/creatornader/note-to-self
cd note-to-self
cargo install --path .
nts --help
```

Requires a recent stable Rust toolchain. The binary is named `nts`.

The PWA and Cloudflare Worker R2 proxy live under `web/`. Deploy your own by following `web/README.md`. After deploy, run `nts device add` to mint a bearer token and print the import bundle URL.

## Status

| Milestone | State |
|-----------|-------|
| M1: CLI with age encryption (local storage) | done |
| M2: Cloudflare R2 sync with ETag locking | done |
| M3: ntfy.sh push notifications | done |
| M4a: PWA + Worker R2 proxy + CLI device management | done |
| M4b: Hardening, audit, env-var secrets, tap-to-open | done |
| M4b polish: inbox filters, QR import, WebAuthn, Web Push | in progress |
| M5: Webhook ingestion | planned |
| M6: File attachments | planned |
| M7: Local search / optional Ollama | planned |

Tests: 91 unit + 42 integration (Rust), 152 unit + 2 e2e (PWA), 55 (Worker). Run with `cargo test`, `npm test --prefix web`, and `npm test --prefix web/worker`. CI runs all three on every push and pull request.

Milestone boundaries are tagged on origin (`m4a-complete`, `m4b-complete`). `git checkout m4b-complete` returns the tree to that boundary.

## Architecture

Messages are encrypted client-side with `age` (X25519 + ChaCha20-Poly1305) and stored as opaque blobs in Cloudflare R2. An encrypted index drives queue operations, with ETag optimistic locking for cross-device sync. The mobile side is a Preact PWA using the `age-encryption` npm package and a Cloudflare Worker that proxies R2 with per-device bearer tokens. Notifications go through ntfy.sh and carry only a "new note arrived" signal: the message body is never sent to the notification service. See `docs/architecture.md` for the full design, security model, and rejected alternatives (Matrix, Memos plus encryption).

## Security

- Secrets (R2 keys, ntfy token, age identity) can be loaded from env vars seeded by 1Password at shell init. Plaintext `config.toml` / `identity.txt` fields remain readable for back-compat until M5. See the ADR in `docs/architecture.md`.
- Passphrase-encrypted export bundles (`nts export --passphrase`) ship the identity to a new device without ever writing it to disk in cleartext.
- Per-device bearer tokens for the Worker. Revoke with `nts device revoke`.
- CI runs gitleaks, trufflehog, and osv-scanner on every push.

## Docs

- `docs/architecture.md`: technical design, security model, tech stack.
- `docs/roadmap.md`: milestone-by-milestone plan and current state.
- `docs/research.md`: landscape research and competitive analysis.
- `web/README.md`: PWA and Worker deploy guide.
- `CLAUDE.md`: project overview, principles, and dev instructions.

## License

MIT. See [LICENSE](LICENSE).
