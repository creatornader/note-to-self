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

## Architecture

- **Encryption**: `age` (by Filippo Valsorda)
- **Storage**: Commodity blob store (Cloudflare R2, Supabase Storage, S3, or git)
- **Notifications**: ntfy.sh (notification of new message, not content)
- **Local AI**: Optional Ollama integration for search over decrypted messages
- **CLI**: Rust or Go binary
- **Mobile**: PWA or React Native/Expo

## Project Structure

> Updated as project evolves

```
note-to-self/
├── CLAUDE.md          # This file — project instructions
├── docs/              # Research, architecture, decisions
├── src/               # Source code (TBD)
└── .gitignore
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
