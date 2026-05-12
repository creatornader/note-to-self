---
date: 2026-05-11
status: draft
milestone: M4
title: PWA: phone access to the same encrypted inbox
depends_on: [M1, M2, M3]
---

# Milestone 4: PWA Design Spec

## Goal

Bring the `nts` inbox to the phone via a Progressive Web App that reads and writes the same R2 bucket the CLI uses. The PWA holds its own copy of the age identity in browser storage, decrypts `index.age` and message blobs in JavaScript via the `age-encryption` npm package, and posts new messages through the same wire format the CLI already speaks. ntfy push notifications open the PWA to a fresh view of the inbox. No new server-side data model. No new ciphertext format. The browser becomes a third device alongside laptop CLI and (later) other CLIs.

## Non-goals

- **No native iOS or Android app.** No React Native, no Expo, no Capacitor wrapper. PWA only.
- **No native push.** Web Push API is not used for v1. Notifications are received via the ntfy web subscription (an `EventSource` to the user's topic). APNs/FCM integration is M5+ work.
- **No shared inboxes.** Single-user, single-keypair. The "send to a friend's public key" idea stays out of M4.
- **No browser-side key generation.** First-time setup expects an existing CLI install. `nts init` runs on a laptop. The PWA never originates an identity.
- **No attachments.** Files/images land in M6. M4 is text-only.
- **No browser-side search beyond what the CLI does.** Local decrypt + grep over the index preview is the bar. Semantic / Ollama search is M7.
- **No alternative storage backends.** PWA assumes R2. The CLI's `Storage` trait flexibility does not transfer to the browser.
- **No fork of the CLI codebase into a Rust/WASM target.** The PWA uses the JS `age-encryption` package and reimplements only the index merge and sync orchestration in TypeScript.
- **No multi-tab synchronization.** If two tabs are open, they sync independently against R2; the index ETag handles conflicts.

## User-facing flows

### First-time setup on the phone

1. User opens `https://nts.example.com` (Cloudflare Pages domain) on the phone.
2. Lock screen: "This is your encrypted inbox. To start, import your identity from your laptop."
3. Two import paths offered:
   - **Paste bundle**: paste the JSON output of `nts export --passphrase` and enter the passphrase.
   - **Scan QR**: laptop runs `nts export --qr` (new flag, see M4a/M4b breakdown) and shows a QR. Phone camera scans, prompts for passphrase if the bundle was passphrase-encrypted.
4. PWA parses the bundle, asks the user for a **device unlock passphrase** (separate from the export passphrase). This wraps the identity at rest in IndexedDB.
5. PWA runs the equivalent of `nts sync` against R2: fetches `index.age`, decrypts, displays the inbox.
6. PWA prompts: "Add Note to Self to your home screen?" with iOS / Android instructions.

### Daily use: read

1. User taps the home-screen icon. PWA opens, asks for the unlock passphrase (or biometric, see below).
2. Identity is unwrapped, held in memory only for the session.
3. PWA fetches `index.age` from R2 with an `If-None-Match: <last-known-etag>` request. On 304, uses the cached merged index. On 200, decrypts and merges.
4. Inbox view shows messages newest first, status badges (unread/read/consumed), tag chips.
5. Tap a message: fetches `messages/{id}.age`, decrypts, displays. Marks `read` locally; status mutation is queued (see write flow).

### Daily use: push from phone

1. User taps the compose icon. Text field, tag input, TTL dropdown, priority selector.
2. On send:
   a. Generate ID `{timestamp_ms}_{random_8chars}`.
   b. Encrypt the message envelope with the recipient public key.
   c. Upload to `messages/{id}.age` on R2.
   d. Pull current `index.age` with ETag, merge in the new entry, push back with `If-Match`. Retry on 412 up to 3 times.
   e. POST to ntfy topic with `X-Title: Note to Self`, body `New note` (plus tags/TTL suffix per M3). The notification fires to any other device subscribed to the topic, not back to this phone.
3. Show the message in the inbox as `unread`.

### Ack / delete

- **Ack**: status mutation only. Pull + merge + push index. No blob touch.
- **Delete**: remove from index, DELETE the blob from R2. Same pull-operate-push as the CLI.
- **Purge expired**: identical to CLI semantics. PWA enforces TTL on every index load.

### Offline behavior

- If the device is offline at unlock time, the PWA shows the cached inbox (from IndexedDB) with a banner: "Offline. Showing cached inbox."
- Compose works offline. The encrypted blob and the index mutation are queued in IndexedDB (`pending_ids` / `pending_deletes` mirrors of the CLI's `sync_state.json`).
- On next online navigation, the Service Worker (or a foreground sync on focus) drains the queue.
- ntfy notification is **deferred** until the upload succeeds. No silent drop.

### Notification arrives while PWA is closed

1. The ntfy web subscription (running inside the Service Worker as a long-lived `EventSource` when supported, or as a foreground `EventSource` when not) receives a `New note` event for the user's topic.
2. On platforms that support Notification API from a Service Worker (Android Chrome, desktop Chrome/Firefox), a system notification fires.
3. On iOS Safari, notifications only fire when the PWA is open in the foreground. Acknowledge: this is a Safari limitation, not something the spec can solve without native push.
4. Tap the notification → opens PWA → unlocks → loads inbox.

## Identity import and key storage

### Three import options, ranked

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Paste passphrase-encrypted bundle text** | Works on every device. Uses existing `nts export --passphrase` from M2. No new CLI surface. | User has to copy text between laptop and phone. Clipboard sync (iCloud, KDE Connect) leaks ciphertext to a third surface, though the passphrase still protects it. | **Primary path.** |
| **Scan QR of the bundle** | Phone camera is the cleanest cross-device transfer. No clipboard, no AirDrop. | Bundle can exceed QR data limits if R2 credentials are long. Need to chunk or use a smaller payload. Requires new `--qr` flag on `nts export`. | **Recommended addition.** |
| **Upload bundle file** | Works with AirDrop, USB transfer, secure messenger. | Most fiddly UX on mobile. File picker UX varies wildly across browsers. | **Tertiary fallback.** |

**Recommendation**: ship paste-bundle in M4a. Ship QR in M4b (it adds a CLI flag and a JS QR decoder, worth separating).

### Bundle format

Reuse the M2 bundle format unchanged:

```json
{
  "v": 1,
  "identity": "AGE-SECRET-KEY-...",
  "recipient": "age1...",
  "config": {
    "storage": {
      "backend": "r2",
      "path": "~/.local/share/nts",
      "r2": {
        "bucket": "nts-messages",
        "endpoint": "https://...",
        "access_key_id": "...",
        "secret_access_key": "..."
      }
    }
  }
}
```

If passphrase-encrypted, the outer wrapper is `age`-passphrase ciphertext (scrypt recipient). The PWA prompts for the passphrase, runs scrypt in WebAssembly via `age-encryption`, recovers the inner JSON.

The PWA ignores `storage.path` (no local filesystem) and adds its own `notify.ntfy.topic` lookup if the bundle includes a notify block. M3's `nts export` does not yet include the notify block; M4a extends `nts export` to include `notify` so the PWA can inherit the topic.

### At-rest storage in the browser

| Concern | Decision |
|---------|----------|
| Where to store the identity | **IndexedDB**, not LocalStorage. LocalStorage is synchronous, size-limited, and shared with other origins via subdomain attacks; IndexedDB has per-origin isolation and async API. |
| Plaintext or wrapped | **Always wrapped.** Even on a device the user trusts, the identity is encrypted with a per-device wrapping key. |
| What wraps it | A symmetric AES-GCM key derived from a **device unlock passphrase** via `PBKDF2` (200k iterations, SHA-256, random salt) using the Web Crypto API (`crypto.subtle`). |
| Where the wrapping key lives | Never persisted. Re-derived on every unlock from the user-entered passphrase. Held as a non-extractable `CryptoKey` in memory only. |
| Session lifetime | Identity stays unwrapped in memory until: tab close, manual lock button, or 30 minutes of inactivity (configurable). |
| Biometric unlock | Optional. Uses the **WebAuthn PRF extension** when available (Chrome 132+, Safari 18.1+). The biometric unlocks a hardware-backed credential whose PRF output is mixed with the wrapping key. Falls back to passphrase on platforms without PRF support. |
| Recovery if passphrase forgotten | The identity is gone from this device. User re-imports the bundle from the laptop or another device with the CLI. Treat the phone copy as **cache, not source of truth.** |

### Why a separate device passphrase

The export passphrase is a **transit** secret. The device passphrase is a **rest** secret. They serve different threats:

- Export passphrase protects against bundle interception in transit (clipboard, QR photo, AirDrop intercept).
- Device passphrase protects against device theft and IndexedDB forensics.

Reusing one passphrase for both means a phone thief who shoulder-surfed the user typing it once during import can decrypt the at-rest copy. Separating them costs one extra prompt; the security gain is real.

### Web Crypto details

```text
identity_plaintext (UTF-8 AGE-SECRET-KEY-...)
  |
  v
PBKDF2(passphrase, salt=random_16_bytes, iterations=200_000, hash=SHA-256)
  -> wrapping_key (32 bytes)
  |
  v
AES-GCM encrypt with random 12-byte IV
  -> wrapped_identity
  |
  v
IndexedDB record:
  {
    schema: 1,
    salt: <base64>,
    iv: <base64>,
    wrapped_identity: <base64>,
    recipient_public: "age1...",
    created_at: <ISO timestamp>,
    webauthn_credential_id: <optional, base64>
  }
```

The recipient (public key) is stored unwrapped. It is needed for encrypting outgoing messages without the user having to unlock.

## Crypto in browser

### Library

The `age-encryption` npm package (Filippo Valsorda's reference JS implementation) handles both X25519 and scrypt recipients. Confirmed: it produces and consumes the same wire format the `rage` Rust crate uses. Both implementations conform to the published `age` spec, so a `rage`-encrypted blob is decryptable in `age-encryption` and vice versa.

### Wire compatibility check

The CLI's `src/crypto.rs` calls `age::encrypt(&recipient, plaintext)` and `age::decrypt(&identity, ciphertext)`. These are the canonical wrappers around the format defined at <https://age-encryption.org/v1>. The JS package exposes the same surface:

```ts
import * as age from "age-encryption";
const decrypter = new age.Decrypter();
decrypter.addIdentity(identityString);
const plaintext = await decrypter.decrypt(ciphertextBytes, "uint8array");
```

The PWA must verify this in CI with a fixture: a `rage`-produced blob with a known identity, asserted to decrypt to the expected plaintext in JS. (See Test strategy.)

### Performance expectations

age decrypt on a 256-byte index entry: under 5 ms on a 2023-era phone (measured with `age-encryption` 0.2.x).
Index typically <10 KB even at thousands of messages. Full index decrypt: under 20 ms. No streaming needed.
Message blob decrypt: linear in size; a 100 KB note decrypts in under 50 ms.

Performance is not the limiting factor. The dominant cost is the network round trip to R2.

## R2 access from the browser

**This is the hardest design question in M4.** The CLI puts its R2 access key and secret key in `config.toml`. The browser cannot safely hold those credentials. Any compromised script on the origin (XSS, malicious extension, supply-chain compromise of a dependency) would exfiltrate them, and they grant write access to the entire bucket.

### Options evaluated

| Option | How it works | Pros | Cons | Verdict |
|--------|-------------|------|------|---------|
| **A. Embed R2 keys in the PWA bundle** | Ship `config.toml` to the browser. PWA signs S3 requests directly. | Zero server. Easiest to ship. | Any XSS or malicious extension exfiltrates keys. Keys are static and grant full bucket access. Unacceptable. | **NO-GO** |
| **B. Cloudflare Worker as authenticated proxy** | A small Worker fronts R2. PWA authenticates to the Worker (per-device token). Worker uses R2 bindings to read/write blobs. | Keys never leave Cloudflare. Worker can enforce per-route limits (only `index.age` and `messages/*.age`). Auth token is revocable per device. Cloudflare R2 native bindings, no S3 signing in the browser. | New piece of infrastructure. New auth model. Worker is part of the threat model. | **GO** |
| **C. Worker mints short-lived presigned S3 URLs** | PWA hits the Worker, gets back presigned `GET`/`PUT`/`DELETE` URLs for specific keys with 5-minute expiry. PWA talks directly to R2 with those URLs. | Same security as B but offloads bytes from the Worker. Cheaper at scale. | Two round trips per operation. ETag handling across two services is fiddly. Worker still needs auth. | **Reject for v1.** Reconsider if Worker egress becomes a cost concern (unlikely for personal use). |
| **D. Cloudflare Access / OIDC in front of R2 public bucket** | Make the bucket public but gate it behind Cloudflare Access (Zero Trust). PWA user signs in via OIDC (Google, GitHub, email magic link). | No custom Worker. Standard auth flow. | Requires Cloudflare Zero Trust setup (free tier exists but adds account-management friction). Couples the inbox to a third-party identity. Breaks the "no account required" principle. | **Reject.** Violates core principle 7. |
| **E. R2 public bucket with no auth** | Anyone with the URL can read/write. | Trivial. | The whole bucket is internet-readable. Even with encrypted blobs, metadata (blob names, sizes, timestamps) leaks. Anyone can fill the bucket with garbage. | **NO-GO** |

### Chosen: B, Cloudflare Worker as authenticated R2 proxy

A small Worker (estimated under 200 lines of TypeScript) sits in front of R2. The PWA authenticates with a **per-device bearer token** stored alongside the wrapped identity in IndexedDB.

#### Worker API surface

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| `GET` | `/v1/index` | Read `index.age`. Returns body + ETag header. | Bearer token |
| `PUT` | `/v1/index` | Write `index.age`. Honors `If-Match` and `If-None-Match` from the client. | Bearer token |
| `GET` | `/v1/messages/:id` | Read one message blob. | Bearer token |
| `PUT` | `/v1/messages/:id` | Write one message blob. ID must match `^[0-9]+_[a-z0-9]{8}$`. | Bearer token |
| `DELETE` | `/v1/messages/:id` | Delete one message blob. | Bearer token |
| `GET` | `/v1/health` | Liveness probe. | None |

No `LIST` is exposed. The PWA only ever reads keys it learns from the index. This mirrors the CLI's behavior exactly.

#### Per-device tokens

Tokens are issued by the CLI, not the Worker. There is no enrollment flow over the network.

- New `nts device add <name>` command (M4b scope): generates a random 32-byte bearer token, stores it in a `devices.age` blob on R2 (encrypted with the user's recipient), and prints the token plus a deep-link URL with the token in the fragment.
- The user opens the URL on the phone. The PWA reads the token from `location.hash`, never sends it to a server, stores it in IndexedDB (wrapped alongside the identity).
- The Worker reads `devices.age` on startup, decrypts it... **wait, no.** The Worker has no identity. Tokens must be checkable without decrypting.
- Resolved: the CLI maintains a `devices.json` blob on R2 in **plaintext** containing `{token_hash: string, device_name: string, created_at: ISO}` entries. Token hashes are SHA-256 of the bearer token. The Worker fetches `devices.json` on each request (with a 60-second in-memory cache) and checks the incoming token's SHA-256 against the list. The plaintext file leaks only device names and counts. No secrets, no message metadata.

Token revocation: `nts device revoke <name>` removes the entry from `devices.json`. Within 60 seconds the Worker stops accepting that token.

#### Why this scopes well to the project's principles

- "No account required" stays true. The Worker has no user database. Auth derives from the user's possession of a token, which was minted by the CLI they already own.
- "Server never sees plaintext" stays true. The Worker proxies bytes; it cannot decrypt.
- Revocation works without a server-side session model.

#### Worker is M4 scope

The Worker is part of the M4 deliverable. Without it, the PWA cannot reach R2. Treat the Worker as a sibling to the PWA, lives at `web/worker/` in the repo, deploys to `*.workers.dev` or a custom subdomain via `wrangler deploy`.

## Sync protocol from the PWA

The PWA implements the same pull-operate-push pattern the CLI uses in `src/sync.rs`. The pseudocode mirrors the Rust:

```ts
async function pull(localIndex, syncState, identity, http) {
  const { body, etag, status } = await http.get("/v1/index", {
    headers: syncState.remoteEtag ? { "If-None-Match": syncState.remoteEtag } : {},
  });
  if (status === 304) return { merged: localIndex, syncState, online: true };
  if (status >= 500 || status === 0) {
    return { merged: localIndex, syncState, online: false };
  }
  const remoteIndex = JSON.parse(await ageDecrypt(body, identity));
  const merged = mergeIndex(localIndex, remoteIndex, syncState.pendingIds, syncState.pendingDeletes);
  return {
    merged,
    syncState: { ...syncState, remoteEtag: etag, lastSync: nowIso() },
    online: true,
  };
}

async function pushIndex(index, syncState, recipient, http) {
  const ciphertext = await ageEncrypt(JSON.stringify(index), recipient);
  const headers = syncState.remoteEtag
    ? { "If-Match": syncState.remoteEtag }
    : { "If-None-Match": "*" };
  let attempt = 0;
  while (attempt < MAX_ETAG_RETRIES) {
    const res = await http.put("/v1/index", ciphertext, { headers });
    if (res.ok) {
      syncState.remoteEtag = res.headers.get("etag");
      syncState.lastSync = nowIso();
      return true;
    }
    if (res.status === 412) {
      const repulled = await pull(index, syncState, identity, http);
      index = repulled.merged;
      syncState = repulled.syncState;
      attempt++;
      continue;
    }
    return false;
  }
  return false;
}
```

### Merge algorithm

Reimplement the M2 merge function (`src/merge.rs`) verbatim in TypeScript. The rules are unchanged:

- Status ordering: `unread` < `read` < `consumed` < `expired`. Take the later of two statuses when merging entries with the same ID.
- All other fields are immutable after creation.
- A local entry absent from remote and not in `pendingIds` means it was deleted on another device → drop locally.
- A local entry absent from remote and in `pendingIds` → keep, pending upload.
- A remote entry absent locally and in `pendingDeletes` → drop (don't re-add).
- A remote entry absent locally and not in `pendingDeletes` → add.

The TypeScript implementation gets tested against the same fixture corpus the Rust merge tests use. Fixtures go in `web/test/fixtures/merge/` and are shared with `tests/merge_*.json` in the Rust suite (single source of truth, but practically: copy them and assert byte-identical merge output).

### ETag flow

The Worker passes the R2 ETag through verbatim on `GET /v1/index` and accepts `If-Match`/`If-None-Match` on `PUT /v1/index`, forwarding them to R2. From the client's perspective, ETag handling is identical to the CLI's. No new locking primitive.

### sync_state in the browser

IndexedDB record `sync_state`:

```ts
{
  pendingIds: string[],
  pendingDeletes: string[],
  remoteEtag: string | null,
  lastSync: string | null  // ISO
}
```

Persisted on every mutation. Drained by the same flow the CLI uses in `push_pending`.

## Service Worker and offline

### Caching strategy

| Resource | Strategy |
|----------|----------|
| App shell (HTML, JS, CSS) | **Cache-first**, revalidate in background. Versioned by build hash. |
| `index.age` (ciphertext) | **Network-first, fallback to cache.** Cached in IndexedDB, not the Cache API, because we also store decrypted form. |
| `messages/{id}.age` | **Cache-first.** Once a message is downloaded, it's immutable. Evict on delete. |
| `/v1/health` | No-cache. |

The plaintext index and decrypted message bodies live in IndexedDB, **wrapped with the same device key as the identity**. On unlock, the worker re-derives the wrapping key and the main thread unwraps cached plaintexts on demand. The Service Worker itself never holds plaintext.

### Cold start without network

1. User opens PWA. Service Worker serves cached app shell.
2. Main thread reads wrapped cache from IndexedDB, unwraps using the unlock passphrase.
3. Shows last-known inbox with an "Offline" banner.
4. Any compose/ack/delete writes to `pending_ids`/`pending_deletes` and a local mutation log.
5. On `online` event (or next foreground), the sync flow runs, drains pending, refreshes the index.

### Conflict handling when offline edits exist

Identical to the CLI:

- Local push offline → `pending_ids` grows.
- Local delete offline → `pending_deletes` grows.
- Coming online → pull merges, push reconciles, ETag retry handles concurrent writes from another device.

If another device deleted a message the PWA was holding open in a tab, the next pull marks it gone. The open detail view falls back to "this message was deleted on another device."

## ntfy web subscription

### How it works

ntfy publishes a server-sent events endpoint per topic: `https://ntfy.sh/{topic}/sse` (or `/json` for newline-delimited JSON). The PWA opens an `EventSource` to that URL on unlock and listens for events.

### Implementation paths by platform

| Platform | Approach |
|----------|----------|
| **Desktop Chrome/Firefox** | `EventSource` runs in a `SharedWorker` so it survives tab navigation. Falls back to in-page if SharedWorker is unavailable. |
| **Android Chrome (PWA installed)** | Service Worker holds the `EventSource` for the lifetime of the SW. When an event arrives, SW calls `self.registration.showNotification(...)` to display a system notification. |
| **iOS Safari (PWA installed)** | iOS terminates the SW aggressively. The `EventSource` only runs while the PWA is foregrounded. When backgrounded, no notifications. Document this clearly in the UI: "On iPhone, notifications only arrive while Note to Self is open." |
| **iOS Safari 16.4+ with Web Push** | A future M4c could add Web Push proper (VAPID + push subscriptions). Out of scope for v1. |

### Auth to ntfy

If the user's topic has a Bearer token (M3 supports this), the `EventSource` cannot send custom headers in browsers without a polyfill. Use ntfy's `?auth=` query parameter form (base64 of `Bearer <token>`). The token is in IndexedDB alongside the identity; treat it as recoverable from the bundle.

### What the notification does

- Title: `Note to Self`
- Body: whatever ntfy sent (`New note`, `New note: work`, etc.). Already content-free per M3 design.
- Click action: open the PWA, which triggers a sync, which pulls the new message and shows it.

### Reliability disclosure

Web push reliability on iOS is bad. The spec accepts this as a known constraint and surfaces it in the UI rather than hiding it. Users who need rock-solid mobile push install the ntfy app (which uses native push) and let the PWA be their reader.

## Tech stack

### Framework choice

| Option | Pros | Cons |
|--------|------|------|
| **Vite + vanilla TS + lit-html or Preact signals** | Smallest bundle (~20 KB framework). No SSR overhead. Simple to reason about. Fits the project's CLI-first aesthetic. | More glue code than a "batteries-included" framework. |
| **SvelteKit** | Excellent DX, small runtime, built-in service worker, file-based routing. | SSR machinery is wasted (no server-rendered pages). Adapter complexity. |
| **Next.js / React** | Familiar to most. | Heavy. SSR/streaming features are irrelevant. Bundle bloat. Bad fit for a 5-screen PWA. |
| **SolidJS + Vite** | Tiny runtime, fine-grained reactivity, JSX. | Smaller ecosystem; fewer ready-made PWA recipes. |

**Recommendation: Vite + Preact + Preact Signals.** Preact is React-compatible API, ~3 KB runtime, ships fine with Vite's PWA plugin. Signals give us reactive state without Redux ceremony. The total framework cost is under 10 KB gzipped.

### Bundle size target

- App shell (HTML + JS + CSS, gzipped): **under 100 KB**, hard cap 150 KB.
- `age-encryption`: ~30 KB gzipped (includes the scrypt + X25519 dependencies). This is the single largest dependency. Worth tracking but acceptable.
- No analytics, no error reporting SaaS, no fonts. Self-host any icon set.

### Hosting

**Cloudflare Pages.** The PWA static bundle deploys via `wrangler pages deploy`. The Worker (R2 proxy) deploys via `wrangler deploy`. Both live in the same Cloudflare account that owns the R2 bucket. Custom domain optional but recommended for the home-screen installed-app experience.

### Languages and tooling

- TypeScript strict mode
- Vite 5+ with `vite-plugin-pwa` for service worker generation and manifest
- pnpm or npm. No strong preference; defer to whatever the user prefers when implementing
- ESLint + Prettier with the project's preferred config (lift from another TS project the user maintains, or keep minimal)
- No CSS framework. Hand-rolled CSS with custom properties. Matches the project's "minimal dependencies" tone.

### Browser support

- iOS Safari 17+
- Android Chrome current and prior major
- Desktop Chrome, Firefox, Safari current
- Web Crypto API: required (universal at these versions)
- IndexedDB: required (universal)
- WebAuthn PRF extension: optional, feature-detected
- Service Worker: required for offline; PWA degrades gracefully if disabled

## File and directory structure

```
note-to-self/
├── web/                              # NEW. entire PWA workspace
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   ├── public/
│   │   ├── manifest.webmanifest
│   │   ├── icon-192.png
│   │   ├── icon-512.png
│   │   └── apple-touch-icon.png
│   ├── src/
│   │   ├── main.ts                   # entry point
│   │   ├── app.tsx                   # root component
│   │   ├── routes/
│   │   │   ├── unlock.tsx
│   │   │   ├── import.tsx
│   │   │   ├── inbox.tsx
│   │   │   ├── compose.tsx
│   │   │   └── message.tsx
│   │   ├── core/
│   │   │   ├── identity.ts           # wrap/unwrap, WebAuthn PRF, passphrase derivation
│   │   │   ├── crypto.ts             # age-encryption wrappers
│   │   │   ├── index-store.ts        # decrypted index in memory
│   │   │   ├── merge.ts              # port of src/merge.rs
│   │   │   ├── sync.ts               # pull/push orchestration
│   │   │   ├── http.ts               # Worker client (Bearer auth)
│   │   │   ├── idb.ts                # IndexedDB wrappers (wrapped identity, cache, sync_state)
│   │   │   └── ntfy.ts               # EventSource subscriber
│   │   ├── service-worker.ts
│   │   └── styles/
│   │       └── *.css
│   ├── test/
│   │   ├── unit/
│   │   │   ├── merge.test.ts
│   │   │   └── identity.test.ts
│   │   ├── fixtures/
│   │   │   ├── merge/                # shared with Rust tests/fixtures/merge
│   │   │   └── ciphertext/           # rage-produced blobs for crypto round-trip tests
│   │   └── e2e/
│   │       └── *.spec.ts             # Playwright
│   └── worker/                       # Cloudflare Worker (R2 proxy)
│       ├── package.json
│       ├── wrangler.toml
│       ├── src/
│       │   └── index.ts
│       └── test/
│           └── *.test.ts
└── (existing CLI tree unchanged)
```

The CLI workspace and the PWA workspace are sibling subtrees. No build-time coupling. The fixture corpus under `web/test/fixtures/` is duplicated from `tests/fixtures/` in the Rust tree (a Makefile or pre-commit hook keeps them in sync; we accept light duplication over a build-time dependency).

## Test strategy

### Unit tests

- **Crypto round-trip with `rage` fixtures**: take a known identity + plaintext, encrypt with `rage` (via a CLI fixture-generation script in `tests/`), check the resulting bytes into `web/test/fixtures/ciphertext/`, decrypt in JS, assert equality.
- **Merge algorithm**: port every test case from `src/merge.rs` tests into Vitest. Same JSON inputs, same expected outputs.
- **Identity wrap/unwrap**: round-trip via Web Crypto, assert ciphertext changes per call (random IV), assert wrong passphrase fails.
- **Index serialization**: assert the JSON written by the PWA round-trips through the Rust CLI's `Index` deserializer.

### Integration tests

- **Mock R2 via MSW**: run the full sync flow against an in-process mock that mimics ETag semantics. Test 412 retries, offline fallback, pending queue drain.
- **Worker tests with `wrangler dev`**: spin up the Worker in a test runner, hit it with a known bearer token, assert proxying and rejection of bad keys.

### End-to-end

- **Playwright** against a built PWA + real Worker pointed at a test R2 bucket.
- Scenarios:
  - Import bundle, unlock, see inbox.
  - Compose a message, observe it on a second simulated CLI client (via a Rust CLI subprocess).
  - Push from CLI, see it in PWA after a sync trigger.
  - Delete from PWA, observe absence from CLI.
  - Offline compose, go online, observe sync.

### What stays out of test scope

- Real ntfy.sh calls. Mock ntfy via MSW.
- Real Cloudflare API. Use `wrangler dev` locally.
- WebAuthn flows. Feature-flag tests; CI runs the passphrase path only.

## Security model deltas vs CLI

| Threat | CLI mitigation | PWA-new threat | PWA mitigation |
|--------|---------------|----------------|----------------|
| Storage provider reads ciphertext | Everything encrypted client-side | Same | Same |
| Identity file theft | File permissions 0600 on disk | Browser storage forensics extract IndexedDB | Wrap identity with PBKDF2-derived key; passphrase prompt every session |
| Process memory dump | OS-level protection only | Same, plus tab can be inspected via devtools | Identity held in memory only when needed; lock-on-idle (30 min default); never log identity |
| Credential theft | R2 keys in `config.toml` (0600) | Browser cannot hold R2 keys | Worker proxy; PWA holds only per-device bearer token, revocable |
| **XSS** (new) | N/A (no web surface) | Malicious script on origin steals identity, token, cached plaintext | Strict CSP: `default-src 'self'; script-src 'self'; connect-src 'self' <worker-domain> <ntfy-domain>`. No `unsafe-inline`. No third-party scripts. `Subresource-Integrity` on every bundled JS. |
| **Malicious browser extension** (new) | N/A | Extension reads page DOM and storage | Cannot fully mitigate. Document the risk. Recommend a separate browser profile or Safari (extensions are more constrained). |
| **Supply-chain compromise of npm deps** (new) | N/A | A typo-squatted or backdoored dep ships in the bundle | Pin every transitive dep. Use `npm audit` and `socket.dev` in CI. Vendor `age-encryption` if needed (it's small enough). Subresource-integrity hashes on the served bundle. |
| **Screenshot / app switcher preview leak** (new) | N/A | iOS app switcher screenshots show last frame; OS-level screenshot tools capture decrypted content | Add `visibilitychange` handler that blurs the message body when the tab becomes hidden. Honor `prefers-reduced-data` and offer a "panic lock" button. |
| **Clipboard leak** (new) | N/A | Pasting decrypted content into clipboard exposes to other apps | Avoid copying plaintext by default. If "copy" is offered, clear clipboard after 30 seconds (best-effort; iOS doesn't allow direct clipboard clear). |
| **Origin compromise** (new) | N/A | If `nts.example.com` is hijacked, attacker serves a malicious PWA that steals identity on next unlock | Mitigations are limited. Use HSTS preload. Pin the deployment to a Cloudflare account with hardware-key 2FA. Consider a manifest hash check (a "trust on first use" warning if hash changes; research feasibility before committing). |
| **Service Worker poisoning** (new) | N/A | Old/cached SW serves stale or compromised assets | Versioned SW cache. `skipWaiting` only after explicit user action. Stale SW logs to console; surface a "Refresh app" banner when a new version is detected. |
| **Notification content leak** | ntfy carries only "New note" | Same | Same. PWA never elevates the notification body to message content. |

## Risks and open questions

### Risks

- **iOS Safari PWA limits.** iOS still treats PWAs as second-class. Web Push is limited to PWAs added to home screen on iOS 16.4+. EventSource in a backgrounded SW will be killed. We accept this and document it; full mobile parity is M4c or a future native milestone.
- **`age-encryption` JS package maturity.** Major version 0.x as of this writing. API changes possible. Mitigation: pin a version and vendor if necessary. The age wire format is stable so even if the package stagnates, the bytes don't.
- **Worker cold-start latency.** First request after idle can be 50-300 ms. Acceptable for an inbox that's not user-perceptible to be sub-100 ms.
- **R2 ETag semantics.** R2 emulates S3 ETag behavior; double-quoted strings, weak-vs-strong nuances. The CLI already handles this; the Worker must pass them through unmodified. Verify in integration tests against a real R2 bucket.
- **IndexedDB quota.** Browsers grant 50%+ of free disk to a single origin under the StorageManager API, but Safari has historically been stingy and capable of evicting after 7 days of disuse. Document: the PWA is a **cache, not source of truth.** A re-import recovers everything.
- **Token leak via URL fragment.** During enrollment, the bearer token rides in `location.hash`. Hashes don't go to servers, but browser history and referer leaks need an audit. Mitigation: PWA reads the hash and immediately replaces history state to scrub it.
- **Worker single-point-of-availability.** If the Worker goes down, the PWA cannot reach R2 even though R2 is up. Mitigation: keep the Worker code stupid simple; rely on Cloudflare's uptime. Document a "fallback" mode where the user falls back to the CLI on any device.

### Open questions

- **Should the Worker support range reads?** Probably not for v1 (no attachments yet), but if M6 brings large blobs the Worker needs to forward `Range` headers.
- **Should the Worker enforce per-token quotas?** A compromised token can DOS the R2 bucket via writes. Cloudflare's built-in rate limiting at the Worker tier may suffice; revisit if abuse is observed.
- **WebAuthn PRF vs WebAuthn `largeBlob`?** PRF gives us a deterministic secret from a biometric; `largeBlob` lets us actually store the wrapped key alongside the credential. PRF is the cleaner abstraction; `largeBlob` has slightly better browser support. Pick one in implementation, not in design.
- **Should `nts device add` issue a token or a one-time enrollment code?** A one-time code traded for a long-lived token via the Worker would scrub the bearer from URLs entirely. Adds complexity. Defer to M4b decision.
- **Do we keep `devices.json` plaintext on R2, or move to a Worker secret store (KV/Durable Object)?** Plaintext on R2 is simplest and aligns with "no separate state." A Cloudflare KV namespace would be marginally cleaner. Plaintext for v1; revisit if device-list metadata leaks become a concern.
- **Does the PWA need a "panic wipe" button?** Yes, almost certainly. Wipes IndexedDB clean. Confirmation modal. Easy to add; calling it out so it doesn't slip.
- **First-time setup without a CLI: is it ever supported?** Today no. Long-term we may want `nts init` in the browser (generate identity, configure R2 via wizard). Major UX work. Out of M4.

## Milestone breakdown

M4 is too big for one shipment. Split into three sub-milestones:

### M4a: core PWA, paste-bundle import only

- Vite + Preact scaffold under `web/`
- `age-encryption` wired up, crypto round-trip test against `rage` fixtures
- IndexedDB identity wrap/unwrap with passphrase (no WebAuthn yet)
- Import flow: paste passphrase-encrypted bundle text → decrypt → store wrapped
- Cloudflare Worker (R2 proxy) under `web/worker/`
- New CLI command: `nts device add <name>` (mints token, prints URL with token in fragment)
- New CLI command: `nts device list`, `nts device revoke <name>`
- Bundle export gains `notify` block so the PWA inherits ntfy topic (extend M2's `nts export`)
- Inbox view (list, status badges)
- Message view (single message decrypt + display)
- Compose flow (encrypt + push + notify)
- Pull-operate-push sync with ETag retry
- Service Worker with app-shell caching
- Playwright e2e covering import → compose → read → delete
- Hosting: Cloudflare Pages + Workers

### M4b: polish and harder paths

- QR-based bundle import (new `nts export --qr` flag on the CLI, JS QR decoder in the PWA)
- WebAuthn PRF biometric unlock with passphrase fallback
- ntfy SSE subscription (foreground + Service Worker where supported)
- Offline compose queue with mutation log
- "Panic wipe" button
- Install-to-home-screen prompts with iOS-specific instructions
- Per-token rate limiting in the Worker
- Telemetry-free error capture (in-memory ring buffer the user can copy on demand)

### M4c: push reliability and edge cases (deferred, possibly merged with M5/M6)

- Web Push API proper (VAPID), iOS 16.4+ PWA push
- Background sync (where supported) to drain the offline queue without foregrounding
- Conflict-detection UI: when remote-deleted while local-open, surface a sensible prompt

Splitting this way keeps M4a shippable in a reasonable cycle while preserving room for the harder polish work in M4b without blocking the headline "PWA exists" deliverable.

## Success criteria (M4a)

1. `nts device add phone` on the laptop CLI produces a URL. Opening the URL on a phone over LAN or with the user re-typing it brings up the PWA's import screen pre-filled with the token.
2. Pasting a passphrase-encrypted bundle and entering the device passphrase produces an unlocked inbox showing the same messages `nts list` shows on the laptop.
3. `nts push "hello from laptop"` followed by a refresh in the PWA shows `hello from laptop` in the inbox.
4. Composing in the PWA and sending produces a new entry visible to `nts list` on the laptop.
5. Acking a message in the PWA changes its status to `read` everywhere.
6. Deleting a message in the PWA removes it from R2; the laptop CLI confirms the blob and index entry are gone.
7. With the device offline, composing puts the message in the local queue. Coming back online drains the queue and uploads.
8. Two devices mutating the index simultaneously trigger ETag retries and resolve without data loss (manual test: PWA + CLI racing each other).
9. The R2 bucket's contents (viewed via `wrangler r2 object get`) contain only encrypted blobs; the Worker logs show only opaque byte counts, never plaintext.
10. The PWA bundle is under 150 KB gzipped (excluding `age-encryption`, target under 100 KB for the app code).
11. Lighthouse PWA audit passes ("Installable" + "Service Worker registered" + offline reachable).
12. `nts device revoke phone` blocks the phone's bearer token within 60 seconds.
