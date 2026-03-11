---
date: 2026-03-11T09:07:17-05:00
researcher: claude-opus-4-6
git_commit: 221d3152f8244a6f0c8bda38611a3f8eb5cff9fa
branch: main
repository: note-to-self
topic: "Milestone 2: R2 Cloud Sync Implementation"
tags: [implementation, r2-sync, cloud-storage, merge-algorithm, encryption]
status: complete
last_updated: 2026-03-11
last_updated_by: claude-opus-4-6
type: implementation_strategy
---

# Handoff: Milestone 2 — R2 Cloud Sync (Complete)

## Task(s)

**Status: COMPLETE** — All 16 tasks from the M2 implementation plan executed and verified.

Implemented full R2 cloud sync for the `nts` CLI, enabling encrypted messages to sync across devices via Cloudflare R2. The implementation followed the plan at `docs/superpowers/plans/2026-03-10-milestone2-r2-sync.md` and the design spec at `docs/superpowers/specs/2026-03-10-milestone2-r2-sync-design.md`.

Key deliverables:
- Pure merge algorithm with status ordering
- Sync state tracking (pending pushes/deletes, ETags)
- R2 storage backend (S3-compatible via `rust-s3` crate)
- Sync orchestration with pull/push/retry and ETag optimistic locking
- All existing commands updated with transparent sync support
- New commands: `config get/set`, `status`, `sync`, `export`, `import`
- Device bootstrapping with optional passphrase encryption (age scrypt)
- 14 new unit tests, 5 new integration tests (64 total tests passing)
- Live-tested with user's actual Cloudflare R2 bucket

## Critical References

- `docs/superpowers/specs/2026-03-10-milestone2-r2-sync-design.md` — Design spec (authoritative for M2 behavior)
- `docs/superpowers/plans/2026-03-10-milestone2-r2-sync.md` — Implementation plan (16 tasks, 5 chunks)
- `docs/roadmap.md` — Feature roadmap (M2 items all checked off)

## Recent changes

All changes are on `main`, committed across 10 commits (`e4da572..221d315`):

- `src/index.rs:72-88` — `ordinal()` and `max_status()` methods on `MessageStatus`
- `src/merge.rs` (new) — Pure merge function with 8 unit tests
- `src/sync_state.rs` (new) — SyncState struct with load/save, 3 unit tests
- `src/config.rs:60-155` — R2Config, get/set helpers, secret masking, 4 tests
- `src/storage/mod.rs:20-45` — WriteResult enum, ETag-aware trait methods
- `src/storage/r2.rs` (new) — R2Storage implementation wrapping `rust-s3::Bucket`
- `src/sync.rs` (new) — Pull/push orchestration with ETag retry logic
- `src/commands/mod.rs` — AppContext struct replacing old 4-tuple, `load_context()` with sync, `save_and_sync()` helper
- `src/commands/{push,peek,pop,list,show,ack,delete,purge,search}.rs` — All updated to use AppContext
- `src/commands/config_cmd.rs` (new) — `nts config get/set`
- `src/commands/status.rs` (new) — `nts status`
- `src/commands/sync_cmd.rs` (new) — `nts sync`
- `src/commands/export.rs` (new) — `nts export [--passphrase]`
- `src/commands/import.rs` (new) — `nts import <file> [--passphrase]`
- `src/main.rs` — New module declarations, CLI subcommands
- `tests/integration.rs` — 5 new integration tests
- `Cargo.toml` — Added rust-s3, tokio, http 0.2, rpassword

## Learnings

1. **`http` crate version mismatch**: `rust-s3 0.35` uses `http 0.2` internally. Using `http = "1"` causes `HeaderMap` type incompatibility. Must use `http = "0.2"` to match.

2. **Tokio runtime feature**: `Runtime::new()` requires `rt-multi-thread` feature. With only `rt` enabled, use `Builder::new_current_thread().enable_all().build()` instead.

3. **age scrypt API**: `age::scrypt::Recipient::new(Secret::new(passphrase.to_owned()))` for encryption, `age::scrypt::Identity::new(Secret::new(passphrase.to_owned()))` for decryption. The `Secret` type wraps `String`, not `&str`.

4. **R2 first-sync behavior**: When connecting to an existing R2 bucket with a stale `index.age` (encrypted with a different identity), the first operation shows "Remote index unreadable — working from local cache". Running `nts sync` pushes the current index and resolves it.

5. **AppContext pattern**: Replacing the old 4-tuple return from `load_context()` with an `AppContext` struct was essential — it carries Config, SyncState, data_dir, and the R2 storage handle alongside the original LocalStorage, Index, Identity, and Recipient.

## Artifacts

- `docs/superpowers/specs/2026-03-10-milestone2-r2-sync-design.md` — Design spec
- `docs/superpowers/plans/2026-03-10-milestone2-r2-sync.md` — Implementation plan
- `docs/roadmap.md` — Updated roadmap
- `CLAUDE.md` — Updated project structure and test counts

## Action Items & Next Steps

M2 is complete. Next milestones from `docs/roadmap.md`:

1. **Milestone 3: Push Notifications (ntfy)** — ntfy.sh integration, topic config, priority levels
2. **Milestone 4: Mobile Access (PWA)** — TypeScript PWA with age-encryption.js, identity import, service worker
3. **Milestone 5: Webhook Ingestion** — HTTP listener for external services

Each milestone should go through the brainstorming → design spec → implementation plan → execution cycle.

## Other Notes

- The `nts` shell function in `~/.zshrc` runs from source via `cargo run`: `nts() { RUSTFLAGS="-A warnings" cargo run --quiet --manifest-path "$HOME/repos/note-to-self/Cargo.toml" -- "$@"; }`
- R2 credentials are stored in `~/.local/share/nts/config.toml` (or `$NTS_HOME/config.toml`)
- The Storage trait (`src/storage/mod.rs`) stays synchronous — R2 impl contains async internally via `tokio::runtime::Builder::new_current_thread()`
- ETag optimistic locking retries up to 3 times on 412 Precondition Failed before falling back to local-only
- All error cases follow "work locally, warn clearly, never block the user" pattern
