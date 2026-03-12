# Note to Self

An encrypted personal message queue — CLI-first, E2E encrypted, cross-device.

## What This Is

A tool for sending messages to yourself. Not a note-taking app, not a chat client — a personal inbox with queue semantics (`push`, `peek`, `pop`, `ack`) where messages are end-to-end encrypted with `age` and synced across devices via commodity blob storage.

## Core Principles

1. **Self-messaging, not note-taking** — messaging UX and mental model, not documents
2. **E2E encrypted by default** — server/storage never sees plaintext
3. **CLI-first** — `nts push "remember this"` from the terminal
4. **Cross-device** — CLI + mobile + web, all synced
5. **Queue semantics** — push/peek/pop/ack, not just append-only
6. **Per-message TTL** — ephemeral and persistent messages coexist
7. **No account required** — just an age keypair and a storage bucket

## Architecture (Decided)

- **Encryption**: `age` (X25519 + ChaCha20-Poly1305) via `rage` Rust crate
- **Storage**: Cloudflare R2 (S3-compatible, zero egress, 10GB free)
- **Notifications**: ntfy.sh (notification only — never carries message content)
- **CLI**: Rust binary (`nts` command)
- **Mobile**: PWA with `age-encryption` npm package
- **Local AI**: Optional Ollama integration for search (future milestone)
- **Evaluated and rejected**: Matrix (overkill), Memos+encryption (fighting the tool)
- **Full details**: `docs/architecture.md`

## Project Structure

> Updated as project evolves

```
note-to-self/
├── CLAUDE.md              # This file — project instructions
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
│   ├── notify.rs          # ntfy notification logic (body, priority, HTTP POST)
│   ├── sync.rs            # Pull/push orchestration with ETag locking
│   ├── sync_state.rs      # Pending sync tracking (sync_state.json)
│   ├── message.rs         # Message struct and serialization
│   ├── config.rs          # Config file management (config.toml + R2 settings)
│   ├── display.rs         # Terminal output formatting
│   ├── helpers.rs         # ID generation, duration parsing
│   └── storage/
│       ├── mod.rs         # Storage trait with ETag support
│       ├── local.rs       # Local filesystem implementation
│       └── r2.rs          # Cloudflare R2 implementation (S3-compatible)
├── tests/
│   └── integration.rs     # End-to-end CLI tests
├── web/                   # PWA source (TBD — Milestone 4)
└── .gitignore
```

## Development

```bash
cargo build              # Build
cargo test               # Run all tests (60 unit + 20 integration)
cargo run -- --help      # CLI help
NTS_HOME=/tmp/nts-test cargo run -- init  # Test with custom data dir
```

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
