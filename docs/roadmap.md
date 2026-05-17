# Note to Self: Roadmap

## Milestone 1: CLI Proof of Concept (Local Only)
**Goal**: Working `nts push` / `nts peek` / `nts pop` with age encryption, local filesystem storage.

- [x] Rust project setup with `age` crate
- [x] `nts init`: generate keypair, create config
- [x] `nts push "message"`: encrypt + store locally
- [x] `nts peek`: decrypt + display latest
- [x] `nts pop`: peek + mark consumed
- [x] `nts list`: show all messages
- [x] Index file management (encrypted JSON)
- [x] `--ttl` flag with expiry enforcement
- [x] `--tag` flag for categorization
- [x] Pipe support (`echo "msg" | nts push`)
- [x] `nts show <id>`: show specific message
- [x] `nts ack <id>`: mark as read
- [x] `nts delete <id>`: permanently delete
- [x] `nts purge --expired`: clean up expired messages
- [x] `nts search "query"`: decrypt-and-grep search
- [x] Integration tests (42 tests total)

## Milestone 2: Cloud Sync (R2)
**Goal**: Messages sync across devices via Cloudflare R2.

- [x] S3-compatible storage backend abstraction (`Storage` trait + `R2Storage`)
- [x] R2 upload/download/list operations (via `rust-s3` crate)
- [x] Index sync (fetch → merge → upload) with ETag optimistic locking
- [x] `nts config set storage.backend r2` + credential management
- [x] `nts sync` command (manual sync trigger)
- [x] `nts status` command (show sync state)
- [x] `nts export` / `nts import` for device bootstrapping
- [x] Pure merge algorithm with offline fallback
- [x] Integration tests (14 tests total)

## Milestone 3: Push Notifications (ntfy)
**Goal**: Phone gets notified when new message is pushed.

- [x] ntfy.sh integration (send notification after push)
- [x] `nts config set ntfy.topic <topic>`
- [x] Private topic with access token auth
- [x] Priority levels mapped to message urgency
- [ ] Optional: self-hosted ntfy Docker compose

## Milestone 4: Mobile Access (PWA)
**Goal**: Read and send notes from phone via browser.

### M4a (shipped)
- [x] TypeScript PWA with `age-encryption` npm package
- [x] Identity import via paste-bundle + device passphrase (PBKDF2 + AES-GCM)
- [x] Cloudflare Worker R2 proxy with per-device bearer tokens
- [x] `nts device add/list/revoke` CLI commands
- [x] Armored passphrase-encrypted export bundles (`nts export --passphrase`)
- [x] Fetch + decrypt index and messages from the Worker
- [x] Push new messages from mobile with ETag retry sync
- [x] Service Worker app-shell precache for offline first-paint
- [x] ntfy notification on PWA-side compose
- [x] Cross-language merge contract via shared JSON fixture corpus
- [x] Playwright e2e: import → unlock → inbox → compose
- [x] Test totals: 80 unit + 35 integration (Rust) · 133 unit + 2 e2e (PWA) · 30 (Worker)

### M4b (in progress)
- [x] Env-var-resolved secrets with 1Password shell-init seeding (ADR in `docs/architecture.md`)
- [x] `storage.pwa_base_url` config key so `nts device add` prints the Pages URL, not the Worker URL
- [x] R2 credentials stripped from passphrase-encrypted bundles
- [x] Consumed and expired hidden from default inbox; "Forget" action for receipt-only entries
- [x] Worker `/v1/notify` proxy so PWA-side ntfy doesn't get CSP-blocked
- [x] Unified ntfy body format across CLI and PWA ("new note · tags · expires in 4h")
- [x] Tap-to-open via `X-Click` header pointing at `{pwa_base_url}/m/{id}`
- [x] Sandboxed-install guard: `NTS_HOME` set disables shell-env identity fallback
- [x] `/v1/notify` hardening: topic regex, click-URL scheme allowlist, 8 KB body cap, server URL parse
- [x] `secret::resolve` trims trailing whitespace from env and inline values
- [x] PWA `deleteMessage` drops local cache entry on immediate-success path
- [x] `validateBundle` rejects `notify.enabled=true` with missing/empty `notify.ntfy` fields
- [x] CORS preflight advertises POST for /v1/notify
- [x] Test totals: 91 unit + 42 integration (Rust) · 152 unit + 2 e2e (PWA) · 55 (Worker)
- [ ] Inbox polish: clickable multi-tag URL-state filter, status chip filters, TTL badge, priority indicator, sticky header, sync error toast, loading state during first sync, filter empty-state copy
- [ ] QR-based bundle import (`nts export --qr`)
- [ ] WebAuthn PRF biometric unlock
- [ ] ntfy SSE subscription with Service Worker Web Push (replaces ntfy iOS app)
- [ ] Offline compose queue with mutation log
- [ ] "Install to home screen" prompt
- [ ] Panic-wipe button
- [ ] `devices.json` migration to Workers KV (currently plaintext on R2)
- [ ] Post-quantum recipients (see `docs/architecture.md` pending decisions)
- [ ] Allowlist `server` host in `/v1/notify` to prevent open-proxy SSRF surface for stolen bearers

## Milestone 5: Webhook Ingestion
**Goal**: External services can send notes to you.

- [ ] `nts webhook serve`: HTTP listener
- [ ] Public key endpoint for senders
- [ ] Encrypt-on-receive (sender or server)
- [ ] Integration examples (GitHub, CI/CD, cron)

## Milestone 6: File Attachments
**Goal**: Send files/images to yourself.

- [ ] `nts push --file <path>`: encrypt + upload file
- [ ] Attachment references in message envelope
- [ ] Download + decrypt on peek/show
- [ ] Size limits and storage management

## Milestone 7: Search & AI (Optional)
**Goal**: Find old messages via text or semantic search.

- [ ] `nts search "query"`: decrypt all, grep locally
- [ ] Ollama integration for semantic search
- [ ] Local embedding index (encrypted at rest)
- [ ] Search results with relevance ranking

## Future Ideas
- Native mobile app (React Native / Expo)
- Browser extension for quick capture
- Keyboard shortcut / Raycast / Alfred integration
- Shared inboxes (send to another person's public key)
- Voice notes (record → transcribe → encrypt → push)
- Calendar/reminder integration for TTL messages
- Matrix bridge (for users who want federation)
