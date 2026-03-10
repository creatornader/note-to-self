# Note to Self — Roadmap

## Milestone 1: CLI Proof of Concept (Local Only)
**Goal**: Working `nts push` / `nts peek` / `nts pop` with age encryption, local filesystem storage.

- [ ] Rust project setup with `rage` crate
- [ ] `nts init` — generate keypair, create config
- [ ] `nts push "message"` — encrypt + store locally
- [ ] `nts peek` — decrypt + display latest
- [ ] `nts pop` — peek + mark consumed
- [ ] `nts list` — show all messages
- [ ] Index file management (encrypted JSON)
- [ ] `--ttl` flag with expiry enforcement
- [ ] `--tag` flag for categorization
- [ ] Pipe support (`echo "msg" | nts push`)

## Milestone 2: Cloud Sync (R2)
**Goal**: Messages sync across devices via Cloudflare R2.

- [ ] S3-compatible storage backend abstraction
- [ ] R2 upload/download/list operations
- [ ] Index sync (fetch → merge → upload)
- [ ] `nts config set storage.backend r2`
- [ ] Credential management for R2 (API tokens)
- [ ] `nts sync` command (manual sync trigger)

## Milestone 3: Push Notifications (ntfy)
**Goal**: Phone gets notified when new message is pushed.

- [ ] ntfy.sh integration (send notification after push)
- [ ] `nts config set ntfy.topic <topic>`
- [ ] Private topic with access token auth
- [ ] Priority levels mapped to message urgency
- [ ] Optional: self-hosted ntfy Docker compose

## Milestone 4: Mobile Access (PWA)
**Goal**: Read and send notes from phone via browser.

- [ ] TypeScript PWA with age-encryption.js
- [ ] Identity import (scan QR / paste key)
- [ ] Fetch + decrypt index and messages
- [ ] Push new messages from mobile
- [ ] Service Worker for offline cache
- [ ] "Install to home screen" prompt

## Milestone 5: Webhook Ingestion
**Goal**: External services can send notes to you.

- [ ] `nts webhook serve` — HTTP listener
- [ ] Public key endpoint for senders
- [ ] Encrypt-on-receive (sender or server)
- [ ] Integration examples (GitHub, CI/CD, cron)

## Milestone 6: File Attachments
**Goal**: Send files/images to yourself.

- [ ] `nts push --file <path>` — encrypt + upload file
- [ ] Attachment references in message envelope
- [ ] Download + decrypt on peek/show
- [ ] Size limits and storage management

## Milestone 7: Search & AI (Optional)
**Goal**: Find old messages via text or semantic search.

- [ ] `nts search "query"` — decrypt all, grep locally
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
