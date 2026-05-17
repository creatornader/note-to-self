# Note to Self

An encrypted personal message queue: CLI-first, E2E encrypted, cross-device.

## What This Is

A tool for sending messages to yourself. Not a note-taking app, not a chat client: a personal inbox with queue semantics (`push`, `peek`, `pop`, `ack`) where messages are end-to-end encrypted with `age` and synced across devices via commodity blob storage.

## Core Principles

1. **Self-messaging, not note-taking**: messaging UX and mental model, not documents
2. **E2E encrypted by default**: server/storage never sees plaintext
3. **CLI-first**: `nts push "remember this"` from the terminal
4. **Cross-device**: CLI + mobile + web, all synced
5. **Queue semantics**: push/peek/pop/ack, not just append-only
6. **Per-message TTL**: ephemeral and persistent messages coexist
7. **No account required**: just an age keypair and a storage bucket

## Architecture (Decided)

- **Encryption**: `age` (X25519 + ChaCha20-Poly1305) via `rage` Rust crate
- **Storage**: Cloudflare R2 (S3-compatible, zero egress, 10GB free)
- **Notifications**: ntfy.sh (notification only: never carries message content)
- **CLI**: Rust binary (`nts` command)
- **Mobile**: PWA with `age-encryption` npm package
- **Local AI**: Optional Ollama integration for search (future milestone)
- **Evaluated and rejected**: Matrix (overkill), Memos+encryption (fighting the tool)
- **Full details**: `docs/architecture.md`

## Project Structure

> Updated as project evolves

```
note-to-self/
├── CLAUDE.md              # This file: project instructions
├── Cargo.toml             # Rust project manifest
├── docs/
│   ├── research.md        # Landscape research and competitive analysis
│   ├── architecture.md    # Technical architecture and design decisions
│   ├── roadmap.md         # Feature roadmap and milestones
│   └── superpowers/
│       ├── specs/          # Design specs
│       └── plans/          # Implementation plans
├── src/
│   ├── main.rs            # CLI entry point (clap command routing)
│   ├── commands/          # Command implementations
│   │   ├── init, push, peek, pop, list, show, ack, delete, purge, search
│   │   ├── config_cmd.rs  # nts config get/set
│   │   ├── notify_cmd.rs  # nts notify setup
│   │   ├── sync_cmd.rs    # nts sync
│   │   ├── status.rs      # nts status
│   │   ├── export.rs      # nts export [--passphrase]
│   │   └── import.rs      # nts import <file> [--passphrase]
│   ├── crypto.rs          # age encrypt/decrypt wrappers
│   ├── index.rs           # Encrypted JSON index (message metadata)
│   ├── merge.rs           # Pure merge function for index reconciliation
│   ├── notify.rs          # ntfy notification logic (body, priority, HTTP POST, X-Click)
│   ├── secret.rs          # Env-var-first secret resolver for r2 creds, ntfy token, identity
│   ├── sync.rs            # Pull/push orchestration with ETag locking
│   ├── sync_state.rs      # Pending sync tracking (sync_state.json)
│   ├── message.rs         # Message struct and serialization
│   ├── config.rs          # Config file management (config.toml + R2 settings + _env fields)
│   ├── display.rs         # Terminal output formatting
│   ├── helpers.rs         # ID generation, duration parsing
│   └── storage/
│       ├── mod.rs         # Storage trait with ETag support
│       ├── local.rs       # Local filesystem implementation
│       └── r2.rs          # Cloudflare R2 implementation (S3-compatible)
├── tests/
│   ├── integration.rs     # End-to-end CLI tests
│   └── (merge fixtures shared with PWA via web/test/fixtures/merge/)
├── src/
│   ├── device.rs          # Bearer-token minting, devices.json read/write
│   └── commands/device.rs # nts device add/list/revoke
├── web/                   # PWA (M4a shipped)
│   ├── package.json
│   ├── vite.config.ts     # injectManifest service-worker wiring
│   ├── README.md          # Deploy + onboarding guide
│   ├── src/
│   │   ├── main.tsx + app.tsx
│   │   ├── core/          # crypto, idb, identity, import, http, merge, sync, index-store
│   │   ├── routes/        # unlock, import, inbox, message, compose
│   │   ├── service-worker.ts
│   │   └── styles/global.css
│   ├── test/
│   │   ├── unit/          # vitest (jsdom + fake-indexeddb)
│   │   ├── e2e/           # playwright against `vite preview`
│   │   └── fixtures/
│   │       ├── merge/     # JSON corpus shared with src/merge.rs
│   │       └── ciphertext/ # rage-pinned fixture for crypto round-trip tests
│   └── worker/            # Cloudflare Worker R2 proxy (separate npm workspace)
│       ├── wrangler.toml
│       ├── src/index.ts   # /v1/health, /v1/index, /v1/messages/:id, /v1/notify
│       └── test/          # vitest-pool-workers integration tests
├── scripts/
│   └── generate-ciphertext-fixtures.sh  # pinned-identity rage fixture builder
├── .github/
│   ├── workflows/test.yml    # CI: rust + pwa + worker on every push and PR
│   └── dependabot.yml        # weekly grouped PR for github-actions majors
└── .gitignore
```

## Development

```bash
cargo build                            # Rust CLI
cargo test                             # Rust: 91 unit + 42 integration
cd web && npm install && npm test      # PWA: 152 unit
cd web && npm run e2e                  # PWA: 2 playwright (needs chromium)
cd web/worker && npm install && npm test  # Worker: 55 integration
cargo run -- --help                    # CLI help
NTS_HOME=/tmp/nts-test cargo run -- init  # CLI with custom data dir
npm run dev --prefix web               # PWA dev server (localhost:5173)
```

PWA deploy steps live in `web/README.md`.

## CI

`.github/workflows/test.yml` runs the three test suites (cargo, vitest for the PWA, vitest-pool-workers for the Worker) on every push to `main` and every pull request. Cancels in-progress runs on the same ref so force-pushes do not queue duplicates.

`.github/dependabot.yml` opens a weekly grouped PR for any new GitHub Actions major version. This is the structural fix for the periodic Node-runtime deprecations that otherwise force a multi-repo emergency sweep. See `~/repos/second-brain/vault/meta/deadlines.md` § "Structural fix: Dependabot" for the cross-project rationale.

## Secrets

Secrets (R2 keys, ntfy token, age identity) can be loaded from env vars
seeded by 1Password at shell-init time. See the "Moving secrets to
1Password" section of `web/README.md` and the ADR in
`docs/architecture.md` for the rationale. Plaintext `config.toml` /
`identity.txt` fields remain readable for back-compat until M5.

## Hub Doc

CLAUDE.md (this file)

## Authoritative Docs

| Doc | Responsibility |
|-----|---------------|
| `CLAUDE.md` | Project overview, principles, structure, dev instructions |
| `docs/research.md` | Landscape research and competitive analysis |
| `docs/architecture.md` | Technical architecture and design decisions |
| `docs/roadmap.md` | Feature roadmap and milestones |

## Sync Triggers

| Event | Update |
|-------|--------|
| Architecture decision made | `docs/architecture.md`, `CLAUDE.md` if structural |
| New feature planned | `docs/roadmap.md` |
| Research finding | `docs/research.md` |
| Project structure change | `CLAUDE.md` project structure section |
| Milestone completed | Annotated git tag `mNx-complete` at the boundary commit, with a multi-line message describing what shipped and test totals. `m4a-complete` and `m4b-complete` exist as precedent. |

## Release tag convention

Each milestone gets an annotated tag at its boundary commit:

- **Format**: `mNx-complete` where `N` is the milestone number and `x` is the sub-milestone letter (e.g., `m4a-complete`, `m4b-complete`, `m5-complete` if no sub-letters).
- **Annotated, not lightweight**: `git tag -a` so the message carries a full description of what shipped, test totals, and references to the relevant handoff document.
- **Push immediately**: `git push origin <tag>` so GitHub picks it up as a release-candidate reference.
- **Rollback usage**: `git checkout m4a-complete` returns the tree to that boundary without needing to scan the log.

Existing tags on origin: `m4a-complete` (commit `07a9920`), `m4b-complete` (commit `5a12d63`).
