# nts PWA

The browser client for `note-to-self`. Talks to a Cloudflare Worker that
fronts R2. Identity and bearer token live wrapped in IndexedDB; everything
on the wire is age-encrypted.

## Layout

```
web/
├── src/                  PWA source (Preact + Preact Signals)
│   ├── core/             crypto, idb, merge, sync, import, http, identity, index-store
│   ├── routes/           unlock, import, inbox, message, compose
│   ├── service-worker.ts injectManifest precache for app-shell offline
│   └── styles/global.css
├── test/
│   ├── unit/             vitest (jsdom)
│   ├── e2e/              playwright (chromium against `vite preview`)
│   └── fixtures/         pinned identity + merge corpus
├── worker/               Cloudflare Worker R2 proxy (separate workspace)
└── package.json
```

The Rust CLI lives at the repo root (`../`). The Worker workspace
(`web/worker/`) is its own npm project so its wrangler + workers-types
toolchain stays isolated from the PWA bundle.

## Prerequisites

- Node 20 or newer.
- Wrangler (`npx wrangler` will install on first use).
- A Cloudflare account with R2 enabled.
- The Rust CLI built once (`cargo build --release` at the repo root) so you
  can mint device tokens and produce export bundles.

## Local development

```sh
# install once
npm install --prefix web
npm install --prefix web/worker

# unit tests (vitest, jsdom)
npm test --prefix web

# build + preview the production bundle
npm run build --prefix web
npm run preview --prefix web

# e2e (playwright, against the previewed bundle)
npx playwright install --with-deps chromium
npm run e2e --prefix web
```

The PWA expects a Worker at `config.storage.worker_base_url`. For local
work, point it at a Worker started with `wrangler dev` and CORS allowed for
`http://localhost:5173`. Set `worker_base_url` on the CLI side
(`nts config set storage.worker_base_url http://127.0.0.1:8787`) before
exporting the bundle.

## Worker deploy

The Worker lives at `web/worker/`. Edit `wrangler.toml` to set the real
bucket name and the PWA origin, then deploy:

```sh
cd web/worker

# one-time
npx wrangler login
npx wrangler r2 bucket create nts-messages

# every deploy
# Edit wrangler.toml:
#   [[r2_buckets]] bucket_name = "nts-messages"
#   [vars] PWA_ORIGIN = "https://nts.pages.dev"
npx wrangler deploy

# verify
curl -sS https://nts-worker.<account>.workers.dev/v1/health
# expect: ok
```

Secrets are not stored in `wrangler.toml`. The Worker only needs the R2
binding (set by `wrangler.toml`) and reads `devices.json` from the same
bucket at request time.

## Pages deploy

```sh
cd web
npm run build
npx wrangler pages deploy dist --project-name nts-pwa
```

The first deploy creates the project; subsequent deploys update it. The CSP
in `index.html` allows `connect-src 'self' https://*.workers.dev` — adjust
if the Worker lives on a custom domain.

## Onboarding a new device

1. On the laptop (where the CLI is configured):
   ```sh
   nts device add phone
   ```
   The output prints `https://<worker-base>/#token=nts_…`. The fragment
   carries the bearer token; the Worker uses its SHA-256 to gate auth.

2. Open that URL on the phone. The PWA captures the token from the hash
   and immediately calls `history.replaceState` to scrub it from the URL.

3. Paste an export bundle (`nts export --passphrase`) into the textarea,
   enter the export passphrase, then choose a new device passphrase.

4. The PWA wraps the identity and the bearer token under the device
   passphrase, stores both in IndexedDB, auto-unlocks, and lands at the
   inbox.

To revoke a device:

```sh
nts device revoke phone
```

The next request from that device hits the Worker's `devices.json` cache.
Once the cache expires (default 60s), the device receives 403 and is
locked out.

## Rotating the R2 bucket or moving providers

1. Create the new bucket and point `wrangler.toml` at it.
2. `wrangler deploy` to push the Worker change.
3. On the CLI, run `nts config set storage.r2.bucket <new-bucket>` and the
   other `storage.r2.*` keys to match.
4. Run a manual sync from the CLI to write `index.age` + every message
   blob to the new bucket. The PWA will pick up the changes on its next
   pull.

## Residual risks documented in this deploy

- **Token in URL fragment**: the enrollment URL carries the bearer token in
  the hash. Modern browsers do not send fragments to servers, and the PWA
  scrubs the hash on first paint, but the token is still briefly present
  in browser history and any extension that watches `location.hash`.
  Mitigation strategies are tracked in the M4 design spec.
- **`devices.json` plaintext on R2**: device names and SHA-256 token
  hashes are stored in cleartext on R2. The hash is one-way so a leak
  cannot impersonate a device, but device-list metadata is visible. Moving
  to Workers KV is tracked for M4b.

## What's next (M4b)

- QR-based bundle import.
- WebAuthn PRF biometric unlock.
- Service Worker offline mutation queue.
- ntfy SSE subscription with Web Push.
- Panic-wipe button.
