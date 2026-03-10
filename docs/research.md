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
