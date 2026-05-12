# Note to Self — Landscape Research

## The Problem

People need to send things to themselves — links, thoughts, reminders, files, API keys — but no existing tool combines:
1. Frictionless capture (messaging UX)
2. E2E encryption
3. API/webhook/CLI automation
4. Cross-device sync
5. Good search/organization

## What People Do Today

| Approach | Encryption | API | Limitations |
|----------|-----------|-----|-------------|
| Telegram Saved Messages | Server-side only (not E2E) | Full Bot API | No E2E; Telegram holds keys |
| Signal Note to Self | E2E (Signal Protocol) | None | Zero API, no search, no automation |
| WhatsApp Message Yourself | E2E | None | No automation; WhatsApp ecosystem only |
| Slack/Discord self-DM | TLS only | Full API | No E2E; tied to workspace |
| Email to self | TLS (E2E with PGP/S/MIME) | SMTP | Noisy inbox, heavyweight |
| iMessage to self | E2E | Siri Shortcuts only | Apple ecosystem only |
| Matrix/Element personal room | E2E (Olm/Megolm) | Full API | Massive infrastructure overhead |

**Dominant pattern**: Telegram Saved Messages wins on convenience. Signal Note to Self wins on privacy. Neither is purpose-built for this use case.

## Existing Tools by Category

### Chat-Style Note Apps
| App | Encryption | API | Platform | Notes |
|-----|-----------|-----|----------|-------|
| Strflow | iCloud E2E (premium) | None | iOS/macOS | Native Swift, HN-featured |
| Luckynote | None documented | None | iOS/Android/Web | Personal messenger for notes |
| Monolog | None documented | None | iOS/Android | AI-powered second brain |

### Encrypted Note Apps
| App | Encryption | API | Open Source | Notes |
|-----|-----------|-----|------------|-------|
| Standard Notes | E2E (AES-256, audited) | Limited | Yes | Mature but document-oriented |
| Notesnook | E2E (XChaCha20-Poly1305) | None | Yes | Zero-knowledge, generous free tier |
| Joplin | E2E (AES-256) | localhost REST | Yes | CLI available, multi-backend sync |
| Obsidian | E2E with paid Sync | Plugin ecosystem | Plugins only | Local-first Markdown |

### Push Notification Tools
| Tool | Encryption | API | Self-Host | Notes |
|------|-----------|-----|-----------|-------|
| ntfy.sh | TLS only | Excellent (curl/CLI) | Yes (tiny Docker) | Best-in-class simplicity |
| Gotify | TLS only | REST API | Yes | Traditional web UI |
| Apprise | Depends on backend | CLI + REST | Yes | Routes to 100+ services |
| Pushbullet | E2E available (premium) | REST API | No | Cross-device push |

### Self-Hosted Memo Apps
| Tool | Stars | Encryption | API | Notes |
|------|-------|-----------|-----|-------|
| Memos | 46K+ | At-rest only | REST + gRPC | Memogram for Telegram; timeline UI |
| Blinko | 7K+ | Self-hosted trust | API | AI-powered RAG search |
| Karakeep | 24K+ | Self-hosted trust | REST | AI auto-tagging, formerly Hoarder |

### Ephemeral Note Tools
| Tool | Encryption | Notes |
|------|-----------|-------|
| Cryptgeon | AES-GCM, RAM-only | Self-destructing, configurable TTL |
| Enclosed | E2E, zero-knowledge | Self-destructing, password protection |
| PrivyPad | E2E, key in URL fragment | Self-destructing |

## The Gaps (Innovation Opportunities)

### Gap 1: No tool combines messaging UX + E2E encryption + CLI/API
- Signal has encryption but no API
- ntfy has great API but no encryption or persistence
- Memos has API but no E2E
- **This is the core whitespace**

### Gap 2: No personal message queue exists
- GitHub search: "personal message queue" → 1 result, 0 stars
- Developers understand queue semantics (push/pop/peek/ack) intuitively
- No tool offers this mental model

### Gap 3: Mixed ephemeral + persistent with per-message TTL
- Everything is either all-permanent (notes) or all-ephemeral (notifications)
- Nobody supports per-message TTL

### Gap 4: No CLI-first encrypted self-messaging
- The workflow `echo "thing" | nts push` → phone notification → `nts peek` doesn't exist
- ntfy.sh is closest in spirit but lacks encryption and persistence

### Gap 5: Local AI on encrypted messages
- Blinko/Karakeep do AI but punt on encryption
- Client-side AI (Ollama) on decrypted messages hasn't been done

## Sources
- [ntfy.sh](https://ntfy.sh/)
- [Memos](https://usememos.com) / [GitHub](https://github.com/usememos/memos)
- [Memogram](https://github.com/usememos/telegram-integration)
- [Blinko](https://github.com/blinkospace/blinko)
- [Karakeep](https://karakeep.app/)
- [Strflow](https://strflow.app)
- [Standard Notes](https://standardnotes.com)
- [Notesnook](https://notesnook.com/)
- [Joplin](https://joplinapp.org)
- [SimpleX Chat](https://simplex.chat/)
- [Matrix/Element](https://element.io/)
- [Conduwuit](https://github.com/x86pup/conduwuit)
- [age encryption](https://github.com/FiloSottile/age)
- [passage](https://github.com/FiloSottile/passage) (age-based password store)
- [Cryptgeon](https://github.com/cupcakearmy/cryptgeon)
- [Enclosed](https://github.com/CorentinTh/enclosed)
- [HN: "I made a Note-Taking app for people who keep texting themselves"](https://news.ycombinator.com/item?id=40925906)

## 2026-05 Landscape Update

> Delta from March 2026 baseline. Last updated: 2026-05-11.

The 90-day window since the original research has been quiet for direct competitors and noisier for adjacent categories. No one shipped "CLI-first, E2E-encrypted, push/peek/pop self-messaging" as a product. Several encrypted note apps and one CRDT-based local-first editor launched. The most relevant macro change is that Apple and Google both moved to E2EE for everyday messaging (RCS, Gmail mobile), which raises the cultural floor for what users expect but doesn't intersect our space directly.

### New entrants

| Tool | Encryption | API / CLI | Open Source | Notes |
|------|-----------|-----------|-------------|-------|
| [Opensidian](https://opensidian.com) | E2E (XChaCha20-Poly1305, HKDF-SHA256) | Yjs over WebSocket; bundled `just-bash` exposes Unix commands over CRDT | Yes (MIT) | Launched 2026-04-07. Obsidian-style notes on Yjs CRDTs synced via Cloudflare Durable Objects. Closest in spirit to nts among new entrants: encryption-first, shell-friendly, blob-store sync. Still document-oriented, no queue semantics, no TTL, no notification layer. |
| [Ichinichi](https://ichinichi.app) | E2E (AES-GCM, password-wrapped keys) | None | Yes | Launched 2026-03-14, 136 HN points. One-note-per-day journaling. Append-only by day, immutable past. Web+PWA, no CLI, no API, no queue. Validates appetite for E2E + local-first journaling on Supabase. |
| [Kylrix](https://www.kylrix.space) | E2EE (unspecified scheme) | None public | No (early/paid) | Launched 2026-04-19. E2EE productivity suite positioning itself as a Notion+Discord alternative. Notes, voice huddles, forms, vault. Direction is "collaboration suite", not personal queue. |
| [VaultNote](https://vaultnote.saposs.com/) | Local AES, single master password | None | No | Launched 2026-03-06. Browser-only, IndexedDB/LocalStorage, tree-structured notes. No sync, no API. Closer to local-only encrypted scratchpad than to a queue. |
| [Conclave](https://github.com/k4yt3x/conclave) | E2E via MLS (RFC 9420) | HTTP/2 + SSE, protobuf | Yes (AGPL-3.0) | v0.1.1 published 2026-03-02. Single-binary, SQLite-backed group messaging in Rust. Forward secrecy + post-compromise security via MLS. Multi-party chat focus, not self-messaging, but the deployment shape ("one binary, five minutes") is the kind of competitor that could pivot. |
| [Cortex](https://github.com/gambletan/cortex) | AES-256-GCM | CLI + REST | Yes | v2.0.0 released March 2026. Local-first memory engine for AI agents in Rust. Four-tier memory model, semantic search, cross-device sync via user-owned cloud. Adjacent: targets agents not humans, but the "encrypted personal store + sync via your own blob bucket + CLI" shape is the same architectural pattern as nts. |
| [Burner Note (relaunch)](https://news.ycombinator.com/item?id=46535362) | E2E (upgraded from server-side) | None | Yes | January 2026 relaunch of a self-destructing notes app, finally truly E2E. Edge of the window. Confirms drift of one-shot ephemeral notes toward real E2EE. |

Smaller things that came up but did not warrant their own row: [FadNote](https://github.com/easyFloyd/fadnote) (zero-knowledge secret-sharing with a Node CLI, March 2026), [Ente Paste](https://paste.ente.io) (Ente shipping a self-destructing pastebin in March 2026), [GridSnap](https://github.com/akinalpfdn/GridSnap) (AES-256-GCM + Argon2id grid notes in Rust, March 2026), [Prism](https://github.com/lone-cloud/prism) (ntfy-compatible webhook router, May 2026, no encryption).

### Upstream changes worth noting

- **age v1.3.0 / v1.3.1** (Dec 2025, just before the original research): post-quantum ML-KEM-768 hybrid recipients, `age-inspect` for metadata, new `EncryptReader` / `DecryptReaderAt` APIs. Our PQ story is now a flag away. See [release notes](https://github.com/FiloSottile/age/releases/tag/v1.3.0).
- **ntfy v2.19 - v2.22** (March - April 2026): S3-compatible attachment storage, PostgreSQL read replicas, SSRF fix, email verification. Still no E2E encryption on the wire. [Issue #69](https://github.com/binwiederhier/ntfy/issues/69) stays open and HOT. Our "ntfy carries no content" decision still holds.
- **Memos v0.27 - v0.28** (April 2026): voice memos, SSO linkage, share links, `@mentions`, SSE live updates, EXIF stripping. Memos is moving toward social/collaboration features, not toward client-side encryption. Our Option B rejection holds.
- **Apple RCS E2EE in iOS 26.5** (2026-05-04) and **Gmail mobile E2EE for enterprise** (April 2026): macro-level E2EE normalization. Raises user expectations across the board but doesn't address self-messaging specifically.

### Gaps re-assessed

**Gap 1: No tool combines messaging UX + E2E encryption + CLI/API.** Still wide open. Opensidian gets closest by exposing Unix commands over an E2E-encrypted CRDT, but it's a notes editor, not a messaging UX. No new entrant pairs the three.

**Gap 2: No personal message queue exists.** Still wide open. Cortex is the only adjacent thing with queue-shaped behavior (ingest, search, sync), and it's aimed at AI agents, not humans, and is structured as memory tiers rather than push/peek/pop/ack. GitHub search for "personal message queue" still produces ~1 hit.

**Gap 3: Mixed ephemeral + persistent with per-message TTL.** Still a gap. Ichinichi is all-permanent (immutable past). Burner Note, Ente Paste, FadNote are all-ephemeral. Nobody is shipping "you decide per-message" on top of an encrypted store.

**Gap 4: No CLI-first encrypted self-messaging.** Still wide open. The closest moves are Opensidian's `just-bash` (CLI as second-class citizen on top of a GUI editor) and FadNote's `echo "secret" | fadnote` (one-shot, not a persistent inbox). The `nts push | ntfy | nts peek` loop doesn't exist anywhere else.

**Gap 5: Local AI on encrypted messages.** Still wide open and now arguably more interesting. Cortex demonstrates that local-first AI memory for agents has product-market fit signal in Rust. Nobody has put a local LLM on a personal E2E-encrypted message store for a human. The "Ollama on decrypted-locally messages" pattern is unclaimed.

### New gaps observed

- **No good answer for "encrypted ntfy"**. ntfy issue #69 has been open since 2021 and remains the most-requested feature. Our decision to use ntfy as notification-only (never message content) is the same workaround everyone else converges on, but the door is open for a tool to be the "encrypted ntfy with persistence." That's effectively what nts is.
- **The Yjs/CRDT angle is becoming the default for new local-first apps**. Opensidian, several Show HN editor projects, and the ecosystem around `y-crdt` are normalizing CRDT-on-blob-store. Our last-write-wins index is fine for v1 single-user but will look dated quickly if we add multi-device write concurrency.
- **Post-quantum is now table stakes for new crypto projects**. age 1.3 ships ML-KEM-768. Calling out PQ in our security model is an easy win.
- **"Memory for AI agents" is the new framing for encrypted personal stores**. Cortex, Demarkus, and similar projects are pulling demand for "encrypted local + cloud-sync personal data" toward the agent use case. Our positioning ("for humans, from the terminal") should be sharper to avoid getting lumped in.

### Implications for note-to-self

- **No direct competitor shipped.** The five gaps are still real. The closest entrant is Opensidian, and it's a notes editor with a CLI bolt-on, not a self-messaging queue. Position stays valid.
- **Sharpen the "self-messaging, not notes" framing.** Every new entrant in the window is some flavor of notes app. The queue semantics (push/peek/pop/ack) and the messaging mental model are the differentiator. Lead with that.
- **Ship the ntfy story explicitly.** "Encrypted ntfy with persistence" is a positioning that landed every time we crossed it in research. The roadmap already covers it; the README/marketing should name it.
- **Add post-quantum to the security section.** age 1.3 is shipping; matching with `--pq` should be a small change and a meaningful trust signal.
- **Reconsider the index sync model before multi-device gets serious.** Last-write-wins is fine for v1 but the CRDT-on-blob pattern is the obvious next step and is well-trodden now. Worth at least an ADR on "when do we move?"
- **Local-AI-on-encrypted milestone is still uncontested.** Nobody has it for human personal data. Worth keeping on the roadmap and not deferring indefinitely; the longer it sits, the more likely Cortex or a similar agent-memory project pivots into it.

### Sources

- [Ichinichi (HN, March 2026)](https://news.ycombinator.com/item?id=47379898)
- [Opensidian (HN, April 2026)](https://news.ycombinator.com/item?id=47676461)
- [VaultNote (HN, March 2026)](https://news.ycombinator.com/item?id=47279803)
- [Kylrix (HN, April 2026)](https://www.kylrix.space)
- [Conclave (GitHub)](https://github.com/k4yt3x/conclave)
- [Cortex (HN + GitHub)](https://github.com/gambletan/cortex)
- [Burner Note (HN, Jan 2026 relaunch)](https://news.ycombinator.com/item?id=46535362)
- [Ente Paste (HN, March 2026)](https://news.ycombinator.com/item?id=47217121)
- [FadNote (HN, March 2026)](https://news.ycombinator.com/item?id=47253272)
- [GridSnap (HN, March 2026)](https://news.ycombinator.com/item?id=47259469)
- [Demarkus (HN, March 2026)](https://news.ycombinator.com/item?id=47241065)
- [Prism (HN, May 2026)](https://github.com/lone-cloud/prism)
- [Loreo (HN, April 2026)](https://news.ycombinator.com/item?id=47694414)
- [msgdrop (age + ntfy)](https://github.com/jbrubake/msgdrop)
- [age v1.3.0 release notes](https://github.com/FiloSottile/age/releases/tag/v1.3.0)
- [ntfy E2E issue #69](https://github.com/binwiederhier/ntfy/issues/69)
- [ntfy releases v2.19 - v2.22](https://github.com/binwiederhier/ntfy/releases)
- [Memos releases v0.27 - v0.28](https://github.com/usememos/memos/releases)
- [Apple RCS E2EE in iOS 26.5](https://www.macrumors.com/2026/05/04/ios-26-5-rcs-encryption/)
- [Gmail mobile E2EE for enterprise](https://workspaceupdates.googleblog.com/2026/04/gmail-end-to-end-encryption-now-available-on-mobile-devices.html)
- [HN Algolia search: encrypted notes, March - May 2026](https://hn.algolia.com/?dateRange=custom&dateStart=1740787200&dateEnd=1747008000&query=encrypted+notes)
- [Reddit r/selfhosted "encrypted notes" last month](https://www.reddit.com/r/selfhosted/search/?q=encrypted+notes&sort=new&t=month)
