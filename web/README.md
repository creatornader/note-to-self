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

After the first deploy, point the CLI at the Pages production URL so
device-add enrollment URLs and ntfy `X-Click` deep-links land on the
PWA rather than the Worker:

```sh
nts config set storage.pwa_base_url https://nts-pwa.pages.dev
```

Without this, `nts device add` still works but prints just the bare
token plus a hint, and CLI-originated ntfy notifications do not include
a tap-to-open URL. PWA-originated notifications use
`window.location.origin` and are unaffected.

## Onboarding a new device

1. On the laptop (where the CLI is configured), point the CLI at the
   deployed Pages URL so the enrollment link opens the PWA, not the
   API Worker:
   ```sh
   nts config set storage.pwa_base_url https://nts-pwa.pages.dev
   nts device add phone
   ```
   The output prints `https://<pwa-base>/#token=nts_…`. The fragment
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

## Moving secrets to 1Password

By default, the CLI reads the R2 access key, the R2 secret access key,
the ntfy token, and the age secret identity from `~/Library/Application
Support/nts/config.toml` and `identity.txt`. The `op` migration moves each
of those into 1Password and pulls them into env vars at shell-init time.
The CLI itself never shells out to `op` (see ADR in
`docs/architecture.md`).

### Shell-init block

Paste this into `~/.zshenv` as-is. The `op://` paths and the `--account`
USER_ID below match this machine's Helmy Family account and the existing
`Private` vault items. Nothing needs to be substituted unless you move the
1Password items or switch accounts.

Prerequisite: the `NTS Identity Backup` item in the `Private` vault needs
an `identity` field added (CONCEALED type, value = contents of your
`identity.txt`, the single line beginning `AGE-SECRET-KEY-`). The R2
access key + secret are already in `Cloudflare nts-messages API key`.

```sh
# Note to Self — seed CLI secrets from 1Password on cold-start.
# Idempotency guard: subshells inherit silently from the parent env.
NTS_OP_ACCOUNT="YMWE45M5BRCSZIN37BO4RC4JPE"
NTS_CACHE_DIR="$HOME/.nts/secrets"

_nts_seed() {
  local var_name="$1" cache_path="$2" op_ref="$3"
  if [[ -n "${(P)var_name}" ]]; then
    return  # already set in parent env, leave alone
  fi
  if [[ -r "$cache_path" ]]; then
    export "$var_name"="$(cat "$cache_path")"
    return
  fi
  if command -v op >/dev/null 2>&1; then
    local val
    val="$(op --account="$NTS_OP_ACCOUNT" read "$op_ref" 2>/dev/null)"
    if [[ -n "$val" ]]; then
      mkdir -p "$(dirname "$cache_path")"
      local tmp="${cache_path}.tmp.$$"
      printf '%s' "$val" > "$tmp"
      chmod 600 "$tmp"
      mv "$tmp" "$cache_path"
      export "$var_name"="$val"
    fi
  fi
}

_nts_seed NTS_R2_ACCESS_KEY_ID     "$NTS_CACHE_DIR/r2-access-key-id" \
  'op://Private/Cloudflare nts-messages API key/Access Key ID'
_nts_seed NTS_R2_SECRET_ACCESS_KEY "$NTS_CACHE_DIR/r2-secret-access-key" \
  'op://Private/Cloudflare nts-messages API key/Secret Access Key'
_nts_seed NTS_AGE_IDENTITY         "$NTS_CACHE_DIR/age-identity" \
  'op://Private/NTS Identity Backup/identity'

unset -f _nts_seed
unset NTS_OP_ACCOUNT NTS_CACHE_DIR
```

Open a new terminal after editing. The first session per cold-start will
fire one Touch ID prompt per missing cache file; subsequent shells read
silently from the cache.

### Wire the CLI

After the env vars seed successfully, point the CLI at them:

```sh
nts config set storage.r2.access_key_id_env     NTS_R2_ACCESS_KEY_ID
nts config set storage.r2.secret_access_key_env NTS_R2_SECRET_ACCESS_KEY
# Optional: if you use ntfy with auth, set notify.ntfy.token_env similarly.
```

Test with `nts sync`. If sync succeeds, the env-var path is live. You can
now (optionally) clean up the plaintext fields:

- Edit `~/Library/Application Support/nts/config.toml` and remove the
  `access_key_id = "..."` and `secret_access_key = "..."` lines. The
  loader will fall back to the env-var path.
- For the age identity: confirm `nts list` works with the env var set
  (the loader uses `NTS_AGE_IDENTITY` ahead of the file). Then
  `rm ~/Library/Application\ Support/nts/identity.txt`.

The plaintext fields remain readable for back-compat until M5.

### Adding the `identity` field to 1Password

The `NTS Identity Backup` item already exists in `Private`. Add an
`identity` field (CONCEALED) whose value is the contents of
`identity.txt` (a single line beginning `AGE-SECRET-KEY-`).

### Rotating

To rotate any of the three values:

1. Update the 1P field.
2. `rm ~/.nts/secrets/<name>` to invalidate the cache.
3. Open a new terminal. One Touch ID prompt, then the new value is live.

The bundle for PWA enrollment is unaffected by R2/ntfy rotation; the PWA
talks to the Worker via the bearer token, not to R2 directly.

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
