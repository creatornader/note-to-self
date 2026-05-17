# Changelog

All notable changes to note-to-self are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Milestone-boundary tags (`m4a-complete`, `m4b-complete`) continue to coexist with semver tags. Milestone tags mark feature-set boundaries; semver tags mark release points suitable for source-install or pinning.

## [0.1.0] - 2026-05-17

First semver-tagged release. Marks the point where the M4a + M4b feature set is shipped end-to-end (CLI + PWA + Worker, all three test suites green in CI), the public-flip is complete, and the public-OSS-prep tooling stack is wired in.

### Added (cumulative since project start)

**M1 — CLI proof of concept (local-only):**
- `nts init`, `push`, `peek`, `pop`, `list`, `show`, `ack`, `delete`, `purge --expired`, `search`. Encrypted JSON index, `--ttl` + `--tag` flags, pipe support.

**M2 — Cloudflare R2 sync:**
- S3-compatible storage backend abstraction (`Storage` trait + `R2Storage`). ETag optimistic locking. `nts sync`, `nts status`, `nts export` / `nts import` (with `--passphrase`), pure merge algorithm.

**M3 — ntfy.sh push notifications:**
- Private topic + access-token auth. Priority mapping. Notification carries only "new note arrived" — message body never touches the notification service.

**M4a — Mobile reachability:**
- Preact PWA with the `age-encryption` npm package. Identity import via paste-bundle + device passphrase (PBKDF2 + AES-GCM). Cloudflare Worker R2 proxy with per-device bearer tokens. `nts device add/list/revoke` CLI commands. Service Worker app-shell precache for offline first-paint. Playwright e2e covering import → unlock → inbox → compose.

**M4b — Hardening, audit, env-var secrets, tap-to-open:**
- Env-var-resolved secrets with 1Password shell-init seeding. R2 credentials stripped from passphrase-encrypted bundles. Consumed and expired hidden from default inbox; "Forget" action for receipt-only entries. Worker `/v1/notify` proxy so PWA-side ntfy doesn't get CSP-blocked. Unified ntfy body format across CLI and PWA. Tap-to-open via `X-Click` header. Sandboxed-install guard. `/v1/notify` hardening (topic regex, click-URL scheme allowlist, 8 KB body cap).

**Public-OSS-prep tooling (this release):**
- Integration with `creatornader/leakguard@v0.1.1` (narrative-leak detection), `creatornader/oss-twin@v0.1.1` (structural mirror gate), `creatornader/oss-security-scan@v0.1.0` (reusable CI workflow).
- 3 narrative-leak fixes in CLAUDE.md, docs/architecture.md, .github/dependabot.yml flagged by the new gate.

### Tests

- 91 unit + 42 integration (Rust), 152 unit + 2 e2e (PWA), 55 (Worker). All green.

### Security

- End-to-end encrypted with `age` (X25519 + ChaCha20-Poly1305). Notifications carry no plaintext. Per-device bearer tokens. Env-var secrets seeded by 1Password.
- gitleaks + trufflehog + osv-scanner via the reusable workflow.

## Milestone tags (kept for reference)

- [`m4a-complete`](https://github.com/creatornader/note-to-self/releases/tag/m4a-complete) — first end-to-end mobile-reachable build (280 tests)
- [`m4b-complete`](https://github.com/creatornader/note-to-self/releases/tag/m4b-complete) — hardening + audit + cross-repo deprecation sweep (342 tests)

[0.1.0]: https://github.com/creatornader/note-to-self/releases/tag/v0.1.0
