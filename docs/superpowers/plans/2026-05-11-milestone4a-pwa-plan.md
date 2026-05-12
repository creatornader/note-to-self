# Milestone 4a: PWA Core — Paste-Bundle Import — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first slice of the PWA: a Vite+Preact app under `web/` that imports a paste-bundle, unlocks the identity in browser storage, talks to a Cloudflare Worker fronting R2, and supports import → inbox → compose → read → delete end-to-end. No QR, no WebAuthn, no offline queue, no Web Push. Those are M4b/M4c.

**Architecture:** Three new artifacts sit beside the existing CLI: a Rust extension (3 new commands + 1 export shape change), a Cloudflare Worker (R2 proxy with per-device bearer auth), and the PWA itself (Preact + age-encryption + IndexedDB). All three speak the same wire format the CLI already uses.

**Tech Stack:** Rust + clap (CLI side), Cloudflare Workers + wrangler + TypeScript (Worker side), Vite + Preact + Preact Signals + age-encryption + Vitest + Playwright (PWA side).

**Spec:** `docs/superpowers/specs/2026-05-11-milestone4-pwa-design.md`

**Out of scope for M4a (deferred to M4b/M4c):** QR bundle import, WebAuthn PRF biometric unlock, offline compose queue with mutation log, panic-wipe button, install-to-home-screen prompts, ntfy SSE subscription, per-token rate limiting, Web Push API, range reads, background sync.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/commands/device.rs` | `nts device add/list/revoke` command implementations | Create |
| `src/device.rs` | DeviceEntry struct, devices.json read/write to R2, token minting | Create |
| `src/commands/export.rs` | Extend bundle to include `notify` block | Modify |
| `src/commands/mod.rs` | Add `pub mod device;` | Modify |
| `src/main.rs` | Add `mod device;` and `Device` subcommand | Modify |
| `tests/integration.rs` | Integration tests for device commands | Modify |
| `Cargo.toml` | Add `sha2` and `hex` to `[dependencies]` (verify `rand` present) | Modify |
| `web/package.json` | PWA workspace manifest | Create |
| `web/pnpm-lock.yaml` or `web/package-lock.json` | Lockfile | Create |
| `web/vite.config.ts` | Vite + vite-plugin-pwa config | Create |
| `web/tsconfig.json` | TS strict config | Create |
| `web/index.html` | App shell entry | Create |
| `web/public/manifest.webmanifest` | PWA manifest | Create |
| `web/public/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | App icons | Create |
| `web/src/main.tsx` | Entry point, root render | Create |
| `web/src/app.tsx` | Root component + router | Create |
| `web/src/routes/unlock.tsx` | Unlock screen (passphrase prompt) | Create |
| `web/src/routes/import.tsx` | Import screen (paste bundle + passphrase) | Create |
| `web/src/routes/inbox.tsx` | Inbox list view | Create |
| `web/src/routes/message.tsx` | Single message view | Create |
| `web/src/routes/compose.tsx` | Compose new message | Create |
| `web/src/core/identity.ts` | Wrap/unwrap identity with PBKDF2 + AES-GCM | Create |
| `web/src/core/crypto.ts` | age-encryption thin wrappers | Create |
| `web/src/core/merge.ts` | TS port of `src/merge.rs` | Create |
| `web/src/core/sync.ts` | Pull/push orchestration with ETag retry | Create |
| `web/src/core/http.ts` | Bearer-auth Worker client | Create |
| `web/src/core/idb.ts` | IndexedDB wrappers (identity, sync_state, cache) | Create |
| `web/src/core/index-store.ts` | In-memory decrypted index + signals | Create |
| `web/src/service-worker.ts` | App-shell cache only (M4a) | Create |
| `web/src/styles/global.css` | Minimal hand-rolled CSS | Create |
| `web/test/unit/merge.test.ts` | Vitest port of merge unit tests | Create |
| `web/test/unit/identity.test.ts` | Vitest tests for wrap/unwrap | Create |
| `web/test/unit/crypto.test.ts` | Crypto round-trip vs rage fixtures | Create |
| `web/test/fixtures/ciphertext/README.md` | How to regenerate fixtures | Create |
| `web/test/fixtures/ciphertext/sample.age` | rage-produced ciphertext fixture | Create |
| `web/test/fixtures/ciphertext/sample.identity` | Identity used to produce the fixture | Create |
| `web/test/fixtures/merge/*.json` | Shared merge fixture corpus | Create |
| `web/test/e2e/import-and-compose.spec.ts` | Playwright e2e | Create |
| `web/playwright.config.ts` | Playwright config | Create |
| `web/worker/package.json` | Worker workspace manifest | Create |
| `web/worker/wrangler.toml` | Wrangler config (R2 binding) | Create |
| `web/worker/tsconfig.json` | TS config | Create |
| `web/worker/src/index.ts` | Worker routes (health, index, messages) + auth | Create |
| `web/worker/test/worker.test.ts` | Worker integration tests via wrangler dev | Create |
| `scripts/generate-ciphertext-fixtures.sh` | Regenerates fixtures from the Rust side | Create |
| `docs/roadmap.md` | Check off M4a items | Modify |
| `CLAUDE.md` | Add `web/` to project structure, update test counts | Modify |

---

## Chunk 1: CLI device management

Build the Rust side first so the PWA has a working enrollment story by the time we get to the browser.

### Task 1: Extend `nts export` to include the notify block

**Files:**
- Modify: `src/commands/export.rs`
- Modify: `tests/integration.rs`

- [ ] **Step 1: Read the current export shape**

Open `src/commands/export.rs` and identify the struct (or inline JSON serialization) that builds the bundle. Confirm it currently emits `v`, `identity`, `recipient`, and a nested `config.storage` block.

- [ ] **Step 2: Add `notify` to the bundle**

Extend the bundle struct so it also carries the user's `notify` config when present. The PWA needs at minimum `notify.ntfy.server`, `notify.ntfy.topic`, and the optional `notify.ntfy.token`. Mirror the on-disk shape exactly so a future device can write it straight back into `config.toml`.

- [ ] **Step 3: Update tests**

Add or update an integration test that calls `nts export` after `nts notify setup` and asserts the resulting bundle JSON contains a `notify` block with the expected topic.

- [ ] **Step 4: Verify**

```
cargo test export
cargo test --test integration
```

All tests pass. Manually inspect a real export to confirm the new block.

- [ ] **Step 5: Commit**

```
git add src/commands/export.rs tests/integration.rs
git commit -m "feat: include notify block in nts export bundle"
```

---

### Task 2: Create the `device` module (token minting + devices.json)

**Files:**
- Create: `src/device.rs`
- Modify: `Cargo.toml` (add `sha2`, `hex`; verify `rand` present)
- Modify: `src/main.rs` (`mod device;`)

- [ ] **Step 1: Add dependencies**

Add to `[dependencies]` in `Cargo.toml`:

```toml
sha2 = "0.10"
hex = "0.4"
```

`rand` is already present per the M3 work (notify_cmd uses it). If `rand` is not in the manifest yet, add it: `rand = "0.9"`.

- [ ] **Step 2: Create `src/device.rs` with the core types**

```rust
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::storage::Storage;

const DEVICES_BLOB_KEY: &str = "devices.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceEntry {
    pub name: String,
    pub token_hash: String, // hex sha256 of bearer token
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct DeviceList {
    #[serde(default)]
    pub devices: Vec<DeviceEntry>,
}

/// Mint a fresh 32-byte bearer token, returning (token_plain, token_hash_hex).
pub fn mint_token() -> (String, String) {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    let token = format!("nts_{}", hex::encode(bytes));
    let token_hash = hash_token(&token);
    (token, token_hash)
}

pub fn hash_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    hex::encode(digest)
}

pub fn load(storage: &dyn Storage) -> Result<DeviceList> {
    match storage.read(DEVICES_BLOB_KEY) {
        Ok(bytes) => {
            let list: DeviceList = serde_json::from_slice(&bytes)
                .with_context(|| "Failed to parse devices.json")?;
            Ok(list)
        }
        Err(_) => Ok(DeviceList::default()),
    }
}

pub fn save(storage: &dyn Storage, list: &DeviceList) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(list)?;
    // Match the existing Storage::write signature; the M2 design returns WriteResult
    // and accepts an optional If-Match etag. Pass None for unconditional.
    storage.write(DEVICES_BLOB_KEY, &bytes, None)?;
    Ok(())
}
```

Adjust the `storage.write` call to match the actual trait signature (see `src/storage/mod.rs` after the M2 changes — the call form may be `write(key, bytes, if_match)` returning `WriteResult`).

- [ ] **Step 3: Add `mod device;` to `src/main.rs`**

After `mod sync_state;` (or near the other module declarations), add:

```rust
mod device;
```

- [ ] **Step 4: Add unit tests at the bottom of `src/device.rs`**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mint_token_is_unique() {
        let (t1, _) = mint_token();
        let (t2, _) = mint_token();
        assert_ne!(t1, t2);
        assert!(t1.starts_with("nts_"));
    }

    #[test]
    fn test_hash_token_is_deterministic() {
        assert_eq!(hash_token("nts_abc"), hash_token("nts_abc"));
        assert_ne!(hash_token("nts_abc"), hash_token("nts_abd"));
    }

    #[test]
    fn test_device_list_roundtrip() {
        let mut list = DeviceList::default();
        list.devices.push(DeviceEntry {
            name: "phone".to_string(),
            token_hash: hash_token("nts_test"),
            created_at: Utc::now(),
        });
        let json = serde_json::to_string(&list).unwrap();
        let back: DeviceList = serde_json::from_str(&json).unwrap();
        assert_eq!(back.devices.len(), 1);
        assert_eq!(back.devices[0].name, "phone");
    }
}
```

- [ ] **Step 5: Verify**

```
cargo test device
cargo build
```

- [ ] **Step 6: Commit**

```
git add src/device.rs src/main.rs Cargo.toml Cargo.lock
git commit -m "feat: device module for bearer-token minting and devices.json"
```

---

### Task 3: Implement `nts device add/list/revoke` commands

**Files:**
- Create: `src/commands/device.rs`
- Modify: `src/commands/mod.rs`
- Modify: `src/config.rs` (add `worker_base_url` field)
- Modify: `src/main.rs`

- [ ] **Step 1: Add `worker_base_url` to the storage config**

In `src/config.rs`, add an optional field to `StorageConfig`:

```rust
#[serde(default)]
pub worker_base_url: Option<String>,
```

Wire it through `Config::get()` and `Config::set()` using the existing dotted-key pattern. The dotted key is `storage.worker_base_url`.

- [ ] **Step 2: Create `src/commands/device.rs`**

```rust
use crate::commands::AppContext;
use crate::device::{self, DeviceEntry};
use anyhow::{anyhow, Result};
use chrono::Utc;

pub fn run_add(ctx: &mut AppContext, name: String) -> Result<()> {
    let storage = ctx.remote_storage()
        .ok_or_else(|| anyhow!("Devices require R2 storage. Run `nts config set storage.backend r2`."))?;
    let mut list = device::load(storage)?;
    if list.devices.iter().any(|d| d.name == name) {
        anyhow::bail!("Device {name} already exists. Revoke it first or use a different name.");
    }
    let (token, token_hash) = device::mint_token();
    list.devices.push(DeviceEntry {
        name: name.clone(),
        token_hash,
        created_at: Utc::now(),
    });
    device::save(storage, &list)?;

    let worker_base = ctx
        .config
        .storage
        .worker_base_url
        .as_deref()
        .unwrap_or("https://YOUR-WORKER.workers.dev");
    println!("Device added: {name}");
    println!();
    println!("Open this URL on the device:");
    println!("  {worker_base}/#token={token}");
    println!();
    println!("Or paste the token directly when prompted:");
    println!("  {token}");
    println!();
    println!("Revoke with: nts device revoke {name}");
    Ok(())
}

pub fn run_list(ctx: &AppContext) -> Result<()> {
    let storage = ctx.remote_storage()
        .ok_or_else(|| anyhow!("Devices require R2 storage."))?;
    let list = device::load(storage)?;
    if list.devices.is_empty() {
        println!("No devices registered.");
        return Ok(());
    }
    println!("{:<20} {:<25} {}", "NAME", "CREATED", "TOKEN HASH (first 16)");
    for d in &list.devices {
        let short = &d.token_hash[..16];
        println!(
            "{:<20} {:<25} {short}",
            d.name,
            d.created_at.format("%Y-%m-%d %H:%M:%S")
        );
    }
    Ok(())
}

pub fn run_revoke(ctx: &mut AppContext, name: String) -> Result<()> {
    let storage = ctx.remote_storage()
        .ok_or_else(|| anyhow!("Devices require R2 storage."))?;
    let mut list = device::load(storage)?;
    let before = list.devices.len();
    list.devices.retain(|d| d.name != name);
    if list.devices.len() == before {
        anyhow::bail!("Device {name} not found.");
    }
    device::save(storage, &list)?;
    println!("Revoked: {name}. Worker will stop accepting the token within 60 seconds.");
    Ok(())
}
```

`ctx.remote_storage()` is an accessor on `AppContext` that returns `Option<&dyn Storage>` for the R2 backend. If it does not yet exist, add it as part of this task — its signature should match how `load_context()` already constructs the R2 handle.

- [ ] **Step 3: Add `pub mod device;` to `src/commands/mod.rs`**

- [ ] **Step 4: Wire the `Device` subcommand in `src/main.rs`**

In the `Commands` enum (after `Notify`):

```rust
    /// Manage paired devices for the PWA
    #[command(subcommand)]
    Device(DeviceCommands),
```

After the existing `NotifyCommands` declaration:

```rust
#[derive(Subcommand)]
enum DeviceCommands {
    /// Register a new device and print the enrollment URL
    Add { name: String },
    /// List registered devices
    List,
    /// Revoke a registered device by name
    Revoke { name: String },
}
```

Match arm in `fn main()`:

```rust
Commands::Device(cmd) => match cmd {
    DeviceCommands::Add { name } => commands::device::run_add(&mut ctx, name),
    DeviceCommands::List => commands::device::run_list(&ctx),
    DeviceCommands::Revoke { name } => commands::device::run_revoke(&mut ctx, name),
},
```

- [ ] **Step 5: Verify**

```
cargo build
cargo test device
```

- [ ] **Step 6: Commit**

```
git add src/commands/device.rs src/commands/mod.rs src/main.rs src/config.rs
git commit -m "feat: nts device add/list/revoke commands"
```

---

### Task 4: Integration tests for device commands

**Files:**
- Modify: `tests/integration.rs`

- [ ] **Step 1: Add tests**

```rust
#[test]
fn test_device_add_creates_entry() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .args(["device", "add", "phone"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Device added: phone"))
        .stdout(predicate::str::contains("nts_"));
}

#[test]
fn test_device_add_duplicate_fails() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp).args(["device", "add", "phone"]).assert().success();
    nts(&tmp)
        .args(["device", "add", "phone"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("already exists"));
}

#[test]
fn test_device_list_empty_then_populated() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp)
        .args(["device", "list"])
        .assert()
        .success()
        .stdout(predicate::str::contains("No devices registered."));
    nts(&tmp).args(["device", "add", "phone"]).assert().success();
    nts(&tmp)
        .args(["device", "list"])
        .assert()
        .success()
        .stdout(predicate::str::contains("phone"));
}

#[test]
fn test_device_revoke_removes_entry() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp).args(["device", "add", "phone"]).assert().success();
    nts(&tmp)
        .args(["device", "revoke", "phone"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Revoked: phone"));
    nts(&tmp)
        .args(["device", "list"])
        .assert()
        .success()
        .stdout(predicate::str::contains("No devices registered."));
}
```

`AppContext::remote_storage()` should return the local storage handle when the backend is `local`, so these tests run without R2. If that wiring is not in place, gate the tests behind an env flag and add a TODO.

- [ ] **Step 2: Verify**

```
cargo test --test integration
```

- [ ] **Step 3: Commit**

```
git add tests/integration.rs
git commit -m "test: integration tests for nts device commands"
```

---

## Chunk 2: Cloudflare Worker (R2 proxy)

### Task 5: Initialize the Worker workspace

**Files:**
- Create: `web/worker/package.json`
- Create: `web/worker/wrangler.toml`
- Create: `web/worker/tsconfig.json`
- Create: `web/worker/src/index.ts` (skeleton)

- [ ] **Step 1: `web/worker/package.json`**

```json
{
  "name": "nts-worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4",
    "typescript": "^5.4",
    "vitest": "^1.6",
    "wrangler": "^3"
  }
}
```

Run `npm install` from `web/worker/` and commit the resulting lockfile.

- [ ] **Step 2: `web/worker/wrangler.toml`**

```toml
name = "nts-worker"
main = "src/index.ts"
compatibility_date = "2026-05-01"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "REPLACE_WITH_REAL_BUCKET"

[vars]
DEVICES_CACHE_TTL_SECONDS = "60"
PWA_ORIGIN = "https://nts.pages.dev"
```

The bucket name is set per-deployment.

- [ ] **Step 3: `web/worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: `web/worker/src/index.ts` skeleton**

```ts
export interface Env {
  BUCKET: R2Bucket;
  DEVICES_CACHE_TTL_SECONDS: string;
  PWA_ORIGIN: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/v1/health") {
      return new Response("ok", { status: 200 });
    }
    return new Response("Not Found", { status: 404 });
  },
};
```

- [ ] **Step 5: Verify**

From `web/worker/`:

```
npm install
npx wrangler dev --local
# In another terminal:
curl http://localhost:8787/v1/health
# Expect: ok
```

- [ ] **Step 6: Commit**

```
git add web/worker/
git commit -m "feat: cloudflare worker scaffold for R2 proxy"
```

---

### Task 6: Implement Worker routes for index and messages

**Files:**
- Modify: `web/worker/src/index.ts`

- [ ] **Step 1: Add route handlers**

```ts
const MESSAGE_ID_RE = /^[0-9]+_[a-z0-9]{8}$/;

async function handleIndexGet(req: Request, env: Env): Promise<Response> {
  const inm = req.headers.get("If-None-Match");
  const obj = await env.BUCKET.get("index.age", inm ? { onlyIf: { etagDoesNotMatch: inm } } : {});
  if (obj === null) return new Response(null, { status: 404 });
  // R2 returns a body-less object when the precondition fails; check via httpEtag presence.
  if (!("body" in obj) || obj.body === null) {
    return new Response(null, { status: 304 });
  }
  return new Response(obj.body, {
    status: 200,
    headers: { ETag: obj.httpEtag, "Content-Type": "application/octet-stream" },
  });
}

async function handleIndexPut(req: Request, env: Env): Promise<Response> {
  const ifMatch = req.headers.get("If-Match");
  const ifNoneMatch = req.headers.get("If-None-Match");
  const body = await req.arrayBuffer();
  const opts: R2PutOptions = {};
  if (ifMatch) opts.onlyIf = { etagMatches: ifMatch };
  else if (ifNoneMatch === "*") opts.onlyIf = { etagDoesNotMatch: "*" };
  const result = await env.BUCKET.put("index.age", body, opts);
  if (result === null) return new Response("Precondition Failed", { status: 412 });
  return new Response(null, { status: 200, headers: { ETag: result.httpEtag } });
}

async function handleMessageGet(id: string, env: Env): Promise<Response> {
  if (!MESSAGE_ID_RE.test(id)) return new Response("Bad Request", { status: 400 });
  const obj = await env.BUCKET.get(`messages/${id}.age`);
  if (obj === null) return new Response(null, { status: 404 });
  return new Response(obj.body, { status: 200 });
}

async function handleMessagePut(id: string, req: Request, env: Env): Promise<Response> {
  if (!MESSAGE_ID_RE.test(id)) return new Response("Bad Request", { status: 400 });
  const body = await req.arrayBuffer();
  await env.BUCKET.put(`messages/${id}.age`, body);
  return new Response(null, { status: 200 });
}

async function handleMessageDelete(id: string, env: Env): Promise<Response> {
  if (!MESSAGE_ID_RE.test(id)) return new Response("Bad Request", { status: 400 });
  await env.BUCKET.delete(`messages/${id}.age`);
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 2: Add CORS preflight + headers**

```ts
function corsHeaders(env: Env): HeadersInit {
  return {
    "Access-Control-Allow-Origin": env.PWA_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,If-Match,If-None-Match,Content-Type",
    "Access-Control-Expose-Headers": "ETag",
  };
}

function withCors(env: Env, res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(env))) headers.set(k, v as string);
  return new Response(res.body, { status: res.status, headers });
}
```

In `fetch`, handle `OPTIONS` first and wrap every other response in `withCors(env, ...)`.

- [ ] **Step 3: Dispatch from `fetch`**

```ts
const url = new URL(request.url);
const path = url.pathname;
const method = request.method.toUpperCase();

if (method === "OPTIONS") {
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}
if (method === "GET" && path === "/v1/health") {
  return withCors(env, new Response("ok"));
}

const authResult = await requireAuth(request, env); // Task 7
if (authResult) return withCors(env, authResult);

if (path === "/v1/index" && method === "GET") return withCors(env, await handleIndexGet(request, env));
if (path === "/v1/index" && method === "PUT") return withCors(env, await handleIndexPut(request, env));

const m = path.match(/^\/v1\/messages\/([^/]+)$/);
if (m) {
  const id = m[1];
  if (method === "GET") return withCors(env, await handleMessageGet(id, env));
  if (method === "PUT") return withCors(env, await handleMessagePut(id, request, env));
  if (method === "DELETE") return withCors(env, await handleMessageDelete(id, env));
}

return withCors(env, new Response("Not Found", { status: 404 }));
```

- [ ] **Step 4: Verify**

Start `wrangler dev --local`. Hit each route with `curl`. Without auth wired up yet, every protected route should be reachable (no auth check yet). After Task 7, retest with bearer.

- [ ] **Step 5: Commit**

```
git add web/worker/src/index.ts web/worker/wrangler.toml
git commit -m "feat: worker routes for index and message proxy"
```

---

### Task 7: Bearer token auth via devices.json

**Files:**
- Modify: `web/worker/src/index.ts`

- [ ] **Step 1: Implement an in-memory devices cache**

```ts
type DevicesCache = { hashes: Set<string>; loadedAt: number };
let DEVICES_CACHE: DevicesCache | null = null;

async function loadDevices(env: Env): Promise<Set<string>> {
  const ttlMs = parseInt(env.DEVICES_CACHE_TTL_SECONDS) * 1000;
  const now = Date.now();
  if (DEVICES_CACHE && now - DEVICES_CACHE.loadedAt < ttlMs) {
    return DEVICES_CACHE.hashes;
  }
  const obj = await env.BUCKET.get("devices.json");
  if (obj === null) {
    DEVICES_CACHE = { hashes: new Set(), loadedAt: now };
    return DEVICES_CACHE.hashes;
  }
  const text = await obj.text();
  const parsed = JSON.parse(text) as { devices: { token_hash: string }[] };
  DEVICES_CACHE = {
    hashes: new Set(parsed.devices.map(d => d.token_hash)),
    loadedAt: now,
  };
  return DEVICES_CACHE.hashes;
}
```

- [ ] **Step 2: Implement `requireAuth`**

```ts
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function requireAuth(req: Request, env: Env): Promise<Response | null> {
  const header = req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) return new Response("Unauthorized", { status: 401 });
  const hash = await sha256Hex(token);
  const devices = await loadDevices(env);
  if (!devices.has(hash)) {
    return new Response("Forbidden", { status: 403 });
  }
  return null;
}
```

- [ ] **Step 3: Verify**

Seed a local `devices.json` via `wrangler r2 object put`. Hit the Worker with and without a valid token. Confirm `401`, `403`, `200`.

- [ ] **Step 4: Commit**

```
git add web/worker/src/index.ts
git commit -m "feat: bearer token auth via devices.json"
```

---

### Task 8: Worker integration tests

**Files:**
- Create: `web/worker/test/worker.test.ts`

- [ ] **Step 1: Set up Vitest with `unstable_dev`**

Use Wrangler's programmatic dev server. Start it in a `beforeAll`, kill it in `afterAll`. Seed a fake `devices.json` and a fake `index.age` into the local R2 directly via the binding API or a `wrangler r2 object put`.

- [ ] **Step 2: Cover the happy and sad paths**

- `GET /v1/health` → 200 "ok" without auth
- `GET /v1/index` without auth → 401
- `GET /v1/index` with bad token → 403
- `GET /v1/index` with valid token → 200 + ETag header
- `GET /v1/index` with `If-None-Match: <current etag>` → 304
- `PUT /v1/index` with `If-Match: <wrong etag>` → 412
- `PUT /v1/index` with `If-Match: <right etag>` → 200 + new ETag
- `PUT /v1/messages/bad-id` → 400
- `PUT /v1/messages/{valid id}` → 200
- `GET /v1/messages/{valid id}` → 200 with body
- `DELETE /v1/messages/{valid id}` → 204; subsequent `GET` → 404
- Token revoked between requests → wait `DEVICES_CACHE_TTL_SECONDS` → next request 403

- [ ] **Step 3: Verify**

```
cd web/worker && npm test
```

- [ ] **Step 4: Commit**

```
git add web/worker/test/
git commit -m "test: worker integration tests via wrangler dev"
```

---

## Chunk 3: PWA scaffold and crypto

### Task 9: Initialize the `web/` workspace

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/public/manifest.webmanifest`, `web/public/icon-{192,512}.png`, `web/public/apple-touch-icon.png`

- [ ] **Step 1: `web/package.json`**

```json
{
  "name": "nts-pwa",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@preact/signals": "^1.2",
    "age-encryption": "^0.2",
    "preact": "^10.20",
    "preact-iso": "^2"
  },
  "devDependencies": {
    "@playwright/test": "^1.45",
    "@preact/preset-vite": "^2.8",
    "typescript": "^5.4",
    "vite": "^5",
    "vite-plugin-pwa": "^0.20",
    "vitest": "^1.6",
    "jsdom": "^24"
  }
}
```

Run `npm install`, commit the lockfile.

- [ ] **Step 2: `web/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: false,
      strategies: "injectManifest",
      srcDir: "src",
      filename: "service-worker.ts",
      workbox: { globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"] },
    }),
  ],
  build: { target: "es2022", sourcemap: true },
  server: { port: 5173 },
  test: { environment: "jsdom" },
});
```

- [ ] **Step 3: `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["vite/client", "vite-plugin-pwa/client"]
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light dark" />
    <title>Note to Self</title>
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://*.workers.dev;" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

If the Worker is on a custom domain, swap the `connect-src` host. Make it `VITE_WORKER_ORIGIN`-driven if useful.

- [ ] **Step 5: `web/public/manifest.webmanifest`**

```json
{
  "name": "Note to Self",
  "short_name": "nts",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0b0b0c",
  "theme_color": "#0b0b0c",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 6: Icons**

Generate placeholder PNG icons. Design polish later.

- [ ] **Step 7: Verify**

```
cd web && npm install && npm run dev
# http://localhost:5173 → blank for now (no main.tsx yet)
```

- [ ] **Step 8: Commit**

```
git add web/package.json web/package-lock.json web/vite.config.ts web/tsconfig.json web/index.html web/public/
git commit -m "feat: PWA workspace scaffold with vite + preact"
```

---

### Task 10: Wire up age-encryption and write a crypto round-trip test

**Files:**
- Create: `web/src/core/crypto.ts`
- Create: `web/test/unit/crypto.test.ts`
- Create: `web/test/fixtures/ciphertext/README.md`, `sample.age`, `sample.identity`, `sample.plaintext.txt`
- Create: `scripts/generate-ciphertext-fixtures.sh`

- [ ] **Step 1: `scripts/generate-ciphertext-fixtures.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Regenerates rage-produced ciphertext fixtures for the PWA crypto tests.
# Run from the repo root: ./scripts/generate-ciphertext-fixtures.sh

FIX="$(pwd)/web/test/fixtures/ciphertext"
mkdir -p "$FIX"

# Pin a fixed identity for reproducible fixtures.
IDENTITY="AGE-SECRET-KEY-...REPLACE_AT_FIRST_RUN..."

if [[ "$IDENTITY" == *REPLACE_AT_FIRST_RUN* ]]; then
  rage-keygen > "$FIX/sample.identity"
  echo "First run: review $FIX/sample.identity, then pin IDENTITY in this script."
  exit 0
fi

echo "$IDENTITY" > "$FIX/sample.identity"
RECIPIENT="$(echo "$IDENTITY" | rage-keygen -y)"
echo "hello from rage fixtures, intended for PWA round-trip tests." > "$FIX/sample.plaintext.txt"
rage -r "$RECIPIENT" -o "$FIX/sample.age" "$FIX/sample.plaintext.txt"
echo "Wrote: $FIX/sample.{identity,plaintext.txt,age}"
```

`chmod +x` it. Run once, pin the identity, commit.

- [ ] **Step 2: `web/src/core/crypto.ts`**

```ts
import * as age from "age-encryption";

export async function encrypt(plaintext: Uint8Array, recipient: string): Promise<Uint8Array> {
  const enc = new age.Encrypter();
  enc.addRecipient(recipient);
  return await enc.encrypt(plaintext);
}

export async function decrypt(ciphertext: Uint8Array, identity: string): Promise<Uint8Array> {
  const dec = new age.Decrypter();
  dec.addIdentity(identity);
  return await dec.decrypt(ciphertext, "uint8array");
}

export async function decryptText(ciphertext: Uint8Array, identity: string): Promise<string> {
  return new TextDecoder("utf-8").decode(await decrypt(ciphertext, identity));
}

export async function encryptText(plaintext: string, recipient: string): Promise<Uint8Array> {
  return await encrypt(new TextEncoder().encode(plaintext), recipient);
}
```

- [ ] **Step 3: `web/test/unit/crypto.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { decrypt, encrypt } from "../../src/core/crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FIX = resolve(__dirname, "../fixtures/ciphertext");

describe("crypto round-trip vs rage", () => {
  it("decrypts a rage-produced ciphertext", async () => {
    const ciphertext = new Uint8Array(readFileSync(resolve(FIX, "sample.age")));
    const identityFile = readFileSync(resolve(FIX, "sample.identity"), "utf-8");
    const identity = identityFile.split("\n").find(l => l.startsWith("AGE-SECRET-KEY"))!;
    const expected = readFileSync(resolve(FIX, "sample.plaintext.txt"), "utf-8");

    const plaintext = await decrypt(ciphertext, identity);
    expect(new TextDecoder().decode(plaintext)).toBe(expected);
  });

  it("encrypts and decrypts within JS", async () => {
    const identityFile = readFileSync(resolve(FIX, "sample.identity"), "utf-8");
    const identity = identityFile.split("\n").find(l => l.startsWith("AGE-SECRET-KEY"))!;
    const recipient = identityFile
      .split("\n")
      .find(l => l.startsWith("# public key:"))!
      .replace("# public key: ", "");
    const original = new TextEncoder().encode("hello");

    const ciphertext = await encrypt(original, recipient);
    const back = await decrypt(ciphertext, identity);
    expect(back).toEqual(original);
  });
});
```

- [ ] **Step 4: Verify**

```
cd web && npm test
```

- [ ] **Step 5: Commit**

```
git add web/src/core/crypto.ts web/test/unit/crypto.test.ts web/test/fixtures/ciphertext/ scripts/generate-ciphertext-fixtures.sh
git commit -m "feat: PWA age-encryption wrappers and rage round-trip tests"
```

---

### Task 11: TypeScript port of `merge.rs`

**Files:**
- Create: `web/src/core/merge.ts`
- Create: `web/test/unit/merge.test.ts`
- Create: `web/test/fixtures/merge/*.json`

- [ ] **Step 1: Types and `merge` function**

```ts
export type MessageStatus = "unread" | "read" | "expired" | "deleted";

export interface IndexEntry {
  id: string;
  created_at: string;
  tags: string[];
  ttl_seconds?: number | null;
  expires_at?: string | null;
  status: MessageStatus;
  content_preview: string;
}

export interface Index {
  messages: IndexEntry[];
}

const STATUS_ORDINAL: Record<MessageStatus, number> = {
  unread: 0,
  read: 1,
  expired: 2,
  deleted: 3,
};

function maxStatus(a: MessageStatus, b: MessageStatus): MessageStatus {
  return STATUS_ORDINAL[a] >= STATUS_ORDINAL[b] ? a : b;
}

export function merge(
  local: Index,
  remote: Index,
  pendingIds: Set<string>,
  pendingDeletes: Set<string>,
): Index {
  const merged: IndexEntry[] = [];
  const seen = new Set<string>();
  const remoteById = new Map(remote.messages.map(e => [e.id, e]));

  for (const entry of local.messages) {
    seen.add(entry.id);
    const remoteEntry = remoteById.get(entry.id);
    if (remoteEntry) {
      merged.push({ ...entry, status: maxStatus(entry.status, remoteEntry.status) });
    } else if (pendingIds.has(entry.id)) {
      merged.push({ ...entry });
    }
  }

  for (const entry of remote.messages) {
    if (seen.has(entry.id)) continue;
    if (pendingDeletes.has(entry.id)) continue;
    merged.push({ ...entry });
  }

  return { messages: merged };
}
```

- [ ] **Step 2: Create shared fixtures**

For each unit test in `src/merge.rs` (plus the proptest regression `test_merge_is_not_commutative_for_unilateral_entries`), produce a JSON fixture under `web/test/fixtures/merge/` with shape:

```json
{
  "local": { "messages": [] },
  "remote": { "messages": [] },
  "pending_ids": [],
  "pending_deletes": [],
  "expected_ids_in_order": [],
  "expected_status_by_id": {}
}
```

Document in `web/test/fixtures/merge/README.md` how to regenerate from the Rust test cases.

- [ ] **Step 3: `web/test/unit/merge.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { merge } from "../../src/core/merge";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const FIX = resolve(__dirname, "../fixtures/merge");

describe("merge fixtures", () => {
  const files = readdirSync(FIX).filter(f => f.endsWith(".json"));
  for (const f of files) {
    it(`matches Rust merge for ${f}`, () => {
      const data = JSON.parse(readFileSync(resolve(FIX, f), "utf-8"));
      const out = merge(
        data.local,
        data.remote,
        new Set(data.pending_ids),
        new Set(data.pending_deletes),
      );
      const ids = out.messages.map(m => m.id);
      expect(new Set(ids)).toEqual(new Set(data.expected_ids_in_order));
      for (const [id, status] of Object.entries(data.expected_status_by_id)) {
        const e = out.messages.find(m => m.id === id);
        expect(e?.status).toBe(status);
      }
    });
  }
});
```

- [ ] **Step 4: Verify**

```
cd web && npm test
```

Optional: add a Rust-side test that loads the same JSON fixtures and asserts the Rust merge produces matching outputs. Deferring this is fine; the cross-check is a future hardening pass.

- [ ] **Step 5: Commit**

```
git add web/src/core/merge.ts web/test/unit/merge.test.ts web/test/fixtures/merge/
git commit -m "feat: TS port of merge algorithm with shared fixture corpus"
```

---

## Chunk 4: PWA identity layer

### Task 12: IndexedDB wrappers

**Files:**
- Create: `web/src/core/idb.ts`

- [ ] **Step 1: Define the schema and a minimal wrapper**

```ts
const DB_NAME = "nts-store";
const DB_VERSION = 1;
const STORES = ["identity", "sync_state", "cache_index", "cache_messages"] as const;
type Store = (typeof STORES)[number];

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(store: Store, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPut(store: Store, key: IDBValidKey, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDel(store: Store, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbClear(store: Store): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

- [ ] **Step 2: Smoke test**

Quick console check in the dev server: write, read, delete, clear.

- [ ] **Step 3: Commit**

```
git add web/src/core/idb.ts
git commit -m "feat: IndexedDB wrappers for identity, sync_state, cache"
```

---

### Task 13: Identity wrap/unwrap with PBKDF2 + AES-GCM

**Files:**
- Create: `web/src/core/identity.ts`
- Create: `web/test/unit/identity.test.ts`

- [ ] **Step 1: Implement**

```ts
const PBKDF2_ITERATIONS = 200_000;

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface WrappedIdentity {
  schema: 1;
  salt: string;
  iv: string;
  wrapped: string;
  recipient_public: string;
  created_at: string;
}

export async function wrapIdentity(identity: string, recipient: string, passphrase: string): Promise<WrappedIdentity> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(identity)),
  );
  return {
    schema: 1,
    salt: b64(salt),
    iv: b64(iv),
    wrapped: b64(ct),
    recipient_public: recipient,
    created_at: new Date().toISOString(),
  };
}

export async function unwrapIdentity(w: WrappedIdentity, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase, unb64(w.salt));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(w.iv) }, key, unb64(w.wrapped));
  return new TextDecoder().decode(pt);
}

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function unb64(s: string): Uint8Array {
  return new Uint8Array([...atob(s)].map(c => c.charCodeAt(0)));
}
```

- [ ] **Step 2: Tests**

```ts
import { describe, it, expect } from "vitest";
import { wrapIdentity, unwrapIdentity } from "../../src/core/identity";

describe("identity wrap/unwrap", () => {
  it("round-trips with correct passphrase", async () => {
    const ident = "AGE-SECRET-KEY-1XQTEST";
    const w = await wrapIdentity(ident, "age1pubkey", "hunter2");
    const back = await unwrapIdentity(w, "hunter2");
    expect(back).toBe(ident);
  });

  it("fails with wrong passphrase", async () => {
    const w = await wrapIdentity("AGE-SECRET-KEY-1XQTEST", "age1pubkey", "hunter2");
    await expect(unwrapIdentity(w, "wrong")).rejects.toBeDefined();
  });

  it("uses fresh salt and iv each wrap", async () => {
    const w1 = await wrapIdentity("AGE-SECRET-KEY-1XQTEST", "age1pubkey", "hunter2");
    const w2 = await wrapIdentity("AGE-SECRET-KEY-1XQTEST", "age1pubkey", "hunter2");
    expect(w1.salt).not.toBe(w2.salt);
    expect(w1.iv).not.toBe(w2.iv);
    expect(w1.wrapped).not.toBe(w2.wrapped);
  });
});
```

- [ ] **Step 3: Verify**

```
cd web && npm test identity
```

- [ ] **Step 4: Commit**

```
git add web/src/core/identity.ts web/test/unit/identity.test.ts
git commit -m "feat: passphrase-wrapped identity via PBKDF2 + AES-GCM"
```

---

### Task 14: Import flow (paste bundle)

**Files:**
- Create: `web/src/routes/import.tsx`

- [ ] **Step 1: Capture token from URL hash on mount**

```tsx
useEffect(() => {
  const hash = location.hash;
  const m = hash.match(/token=([^&]+)/);
  if (m) {
    setCapturedToken(decodeURIComponent(m[1]));
    history.replaceState(null, "", location.pathname);
  }
}, []);
```

- [ ] **Step 2: Build the form**

Fields: `<textarea>` for the paste bundle, password input for the export passphrase, password input + confirm for the device passphrase. If `capturedToken` is null, add a manual token input field.

On submit:

1. Try to parse the textarea content as the age armor format (begins with `-----BEGIN AGE ENCRYPTED FILE-----`). If so, decrypt it using `age.Decrypter().addPassphrase(exportPassphrase)`.
2. Otherwise parse it directly as JSON.
3. Validate the bundle has `v: 1`, `identity` starting with `AGE-SECRET-KEY-`, `recipient` starting with `age1`, and `config.storage.r2` plus `config.storage.worker_base_url`.
4. `wrapIdentity(bundle.identity, bundle.recipient, devicePassphrase)` and persist into IndexedDB `identity/current`.
5. Wrap and persist the bearer token: same passphrase, separate IDB key.
6. Persist the public bits unwrapped (recipient, worker_base_url, ntfy server+topic) — they're not secrets.
7. Redirect to `/inbox` (the unlock screen will short-circuit since identity is in memory after import).

- [ ] **Step 3: UX details**

- A checklist next to the form: "Bundle parsed", "Token captured", "Identity wrapped", "Stored".
- All four green → button changes to "Open inbox".
- Error states inline under the offending field; never use `alert()` per the dialog rules in the global CLAUDE.md.

- [ ] **Step 4: Verify**

Manual: `npm run dev`, paste a bundle from `nts export --passphrase`, walk the flow, check IndexedDB contents in DevTools.

- [ ] **Step 5: Commit**

```
git add web/src/routes/import.tsx
git commit -m "feat: paste-bundle import flow with token capture"
```

---

## Chunk 5: PWA sync layer

### Task 15: HTTP client to the Worker

**Files:**
- Create: `web/src/core/http.ts`

- [ ] **Step 1: Bearer-auth wrapper**

```ts
export interface HttpClient {
  getIndex(etag: string | null): Promise<{ status: number; body: Uint8Array | null; etag: string | null }>;
  putIndex(ciphertext: Uint8Array, ifMatch: string | null): Promise<{ status: number; etag: string | null }>;
  getMessage(id: string): Promise<{ status: number; body: Uint8Array | null }>;
  putMessage(id: string, ciphertext: Uint8Array): Promise<{ status: number }>;
  deleteMessage(id: string): Promise<{ status: number }>;
}

export function makeHttp(baseUrl: string, bearerToken: string): HttpClient {
  const auth = (): Record<string, string> => ({ Authorization: `Bearer ${bearerToken}` });
  return {
    async getIndex(etag) {
      const headers: Record<string, string> = auth();
      if (etag) headers["If-None-Match"] = etag;
      const r = await fetch(`${baseUrl}/v1/index`, { headers });
      if (r.status === 304) return { status: 304, body: null, etag };
      if (!r.ok) return { status: r.status, body: null, etag: null };
      const buf = await r.arrayBuffer();
      return { status: r.status, body: new Uint8Array(buf), etag: r.headers.get("etag") };
    },
    async putIndex(ciphertext, ifMatch) {
      const headers: Record<string, string> = { ...auth(), "Content-Type": "application/octet-stream" };
      if (ifMatch) headers["If-Match"] = ifMatch;
      else headers["If-None-Match"] = "*";
      const r = await fetch(`${baseUrl}/v1/index`, { method: "PUT", headers, body: ciphertext });
      return { status: r.status, etag: r.headers.get("etag") };
    },
    async getMessage(id) {
      const r = await fetch(`${baseUrl}/v1/messages/${id}`, { headers: auth() });
      if (!r.ok) return { status: r.status, body: null };
      const buf = await r.arrayBuffer();
      return { status: r.status, body: new Uint8Array(buf) };
    },
    async putMessage(id, ciphertext) {
      const r = await fetch(`${baseUrl}/v1/messages/${id}`, {
        method: "PUT",
        headers: { ...auth(), "Content-Type": "application/octet-stream" },
        body: ciphertext,
      });
      return { status: r.status };
    },
    async deleteMessage(id) {
      const r = await fetch(`${baseUrl}/v1/messages/${id}`, { method: "DELETE", headers: auth() });
      return { status: r.status };
    },
  };
}
```

- [ ] **Step 2: Commit**

```
git add web/src/core/http.ts
git commit -m "feat: bearer-auth http client for the worker"
```

---

### Task 16: Pull/push orchestration

**Files:**
- Create: `web/src/core/sync.ts`
- Create: `web/test/unit/sync.test.ts`

- [ ] **Step 1: Port `src/sync.rs` semantics**

```ts
import { HttpClient } from "./http";
import { Index, merge } from "./merge";
import { decrypt, encrypt } from "./crypto";

const MAX_ETAG_RETRIES = 3;

export interface SyncState {
  pendingIds: string[];
  pendingDeletes: string[];
  remoteEtag: string | null;
  lastSync: string | null;
}

export async function pull(
  local: Index,
  state: SyncState,
  identity: string,
  http: HttpClient,
): Promise<{ merged: Index; state: SyncState; online: boolean }> {
  const r = await http.getIndex(state.remoteEtag);
  if (r.status === 304) return { merged: local, state, online: true };
  if (r.status === 0 || r.status >= 500 || r.status === 404) {
    return { merged: local, state, online: r.status !== 0 };
  }
  if (!r.body) return { merged: local, state, online: false };
  const json = new TextDecoder().decode(await decrypt(r.body, identity));
  const remote: Index = JSON.parse(json);
  const m = merge(local, remote, new Set(state.pendingIds), new Set(state.pendingDeletes));
  return {
    merged: m,
    state: { ...state, remoteEtag: r.etag, lastSync: new Date().toISOString() },
    online: true,
  };
}

export async function pushIndex(
  index: Index,
  state: SyncState,
  identity: string,
  recipient: string,
  http: HttpClient,
): Promise<{ ok: boolean; state: SyncState; index: Index }> {
  let attempt = 0;
  let current = index;
  let s = state;
  while (attempt < MAX_ETAG_RETRIES) {
    const ciphertext = await encrypt(new TextEncoder().encode(JSON.stringify(current)), recipient);
    const r = await http.putIndex(ciphertext, s.remoteEtag);
    if (r.status === 200) {
      s = { ...s, remoteEtag: r.etag, lastSync: new Date().toISOString(), pendingIds: [], pendingDeletes: [] };
      return { ok: true, state: s, index: current };
    }
    if (r.status === 412) {
      const repulled = await pull(current, s, identity, http);
      current = repulled.merged;
      s = repulled.state;
      attempt++;
      continue;
    }
    return { ok: false, state: s, index: current };
  }
  return { ok: false, state: s, index: current };
}
```

- [ ] **Step 2: Mock-HTTP test**

Cover: 304 → no change; first push (no etag) → 200; concurrent write race → 412 → pull → 200; persistent 412 → false after MAX_ETAG_RETRIES.

- [ ] **Step 3: Commit**

```
git add web/src/core/sync.ts web/test/unit/sync.test.ts
git commit -m "feat: pull/push sync with ETag retry"
```

---

### Task 17: In-memory index store + sync_state persistence

**Files:**
- Create: `web/src/core/index-store.ts`

- [ ] **Step 1: Signals-backed session state**

```ts
import { signal } from "@preact/signals";
import { HttpClient } from "./http";
import { Index } from "./merge";
import { SyncState } from "./sync";

export const session = {
  identity: signal<string | null>(null),
  recipient: signal<string | null>(null),
  index: signal<Index>({ messages: [] }),
  syncState: signal<SyncState>({
    pendingIds: [],
    pendingDeletes: [],
    remoteEtag: null,
    lastSync: null,
  }),
  worker: signal<HttpClient | null>(null),
  online: signal<boolean>(true),
};
```

Add helpers: `setUnlocked(identity, recipient, http)`, `lock()`, `syncNow()`, `pushNew(message)`, `markRead(id)`, `delete(id)`. Each helper persists `syncState` and the wrapped index cache to IndexedDB on change.

- [ ] **Step 2: Commit**

```
git add web/src/core/index-store.ts
git commit -m "feat: signals-backed in-memory index + session state"
```

---

## Chunk 6: PWA UI

### Task 18: Routing + unlock screen

**Files:**
- Create: `web/src/main.tsx`, `web/src/app.tsx`, `web/src/routes/unlock.tsx`, `web/src/styles/global.css`

- [ ] **Step 1: `web/src/main.tsx`**

```tsx
import { render } from "preact";
import { App } from "./app";
import "./styles/global.css";

render(<App />, document.getElementById("app")!);
```

- [ ] **Step 2: `web/src/app.tsx`**

```tsx
import { LocationProvider, Router, Route } from "preact-iso";
import { Unlock } from "./routes/unlock";
import { Import } from "./routes/import";
import { Inbox } from "./routes/inbox";
import { Compose } from "./routes/compose";
import { Message } from "./routes/message";

export function App() {
  return (
    <LocationProvider>
      <Router>
        <Route path="/" component={Unlock} />
        <Route path="/import" component={Import} />
        <Route path="/inbox" component={Inbox} />
        <Route path="/compose" component={Compose} />
        <Route path="/m/:id" component={Message} />
      </Router>
    </LocationProvider>
  );
}
```

- [ ] **Step 3: `web/src/routes/unlock.tsx`**

If no wrapped identity in IndexedDB → redirect to `/import`. Otherwise show a passphrase input. On submit: `unwrapIdentity`, set `session.identity`, redirect to `/inbox`. On failure: inline "Wrong passphrase".

- [ ] **Step 4: Minimal CSS**

```css
:root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
body { margin: 0; background: Canvas; color: CanvasText; }
button, input, textarea { font: inherit; }
```

Keep it tiny. Style with custom properties where possible.

- [ ] **Step 5: Verify**

Manual: open the dev server, walk the flows.

- [ ] **Step 6: Commit**

```
git add web/src/main.tsx web/src/app.tsx web/src/routes/unlock.tsx web/src/styles/global.css
git commit -m "feat: routing + unlock screen"
```

---

### Task 19: Inbox and message views

**Files:**
- Create: `web/src/routes/inbox.tsx`, `web/src/routes/message.tsx`

- [ ] **Step 1: Inbox**

On mount: call `syncNow()`. Render `session.index.value.messages` newest first. Each row: status badge, tag chips, preview, relative timestamp. Tap a row → `/m/:id`.

Header: "Compose" button (right) and "Sync" button (left, spins during sync). Status line: "Synced 2 min ago" or "Offline — showing cache".

- [ ] **Step 2: Message view**

Look up the entry by id. If a decrypted body is cached in `cache_messages`, render it. Otherwise fetch via `http.getMessage(id)`, decrypt, render, cache. Provide a "Mark read" button (if `unread`) and a "Delete" button (with a confirm step that does not use `confirm()` — render an inline confirm row).

- [ ] **Step 3: Verify**

Manual: push from CLI, sync from PWA, see message, open it, ack it, delete it. CLI confirms each state change via `nts list` and `nts show`.

- [ ] **Step 4: Commit**

```
git add web/src/routes/inbox.tsx web/src/routes/message.tsx
git commit -m "feat: inbox and message views"
```

---

### Task 20: Compose flow

**Files:**
- Create: `web/src/routes/compose.tsx`

- [ ] **Step 1: Build the form**

Fields: textarea for content, input for comma-separated tags, TTL dropdown (`none`, `1h`, `4h`, `1d`, `7d`), priority radio group (`low`/`default`/`high`/`urgent`).

On submit:

1. Validate non-empty content.
2. Generate id `${Date.now()}_${random8()}`.
3. Build the message envelope matching the existing CLI shape (`src/message.rs`).
4. Encrypt with the recipient public key.
5. `http.putMessage(id, ciphertext)`.
6. Append the new entry to the local index, then `pushIndex` with ETag retry.
7. POST to ntfy (using the topic, server, and optional token stored from the bundle) with `X-Title`, `X-Priority`, content-free body matching M3.
8. Navigate back to `/inbox` on success.

- [ ] **Step 2: Commit**

```
git add web/src/routes/compose.tsx
git commit -m "feat: compose flow with encrypt + push + notify"
```

---

## Chunk 7: Service Worker

### Task 21: App-shell caching

**Files:**
- Create: `web/src/service-worker.ts`

- [ ] **Step 1: Minimal injectManifest SW**

```ts
import { precacheAndRoute } from "workbox-precaching";

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("activate", () => {
  self.clients.claim();
});
```

Offline mutation queues and ntfy SSE go in M4b.

- [ ] **Step 2: Verify**

Build, preview, DevTools → Application → Service Workers. Toggle "Offline" and reload. App shell loads from cache.

- [ ] **Step 3: Commit**

```
git add web/src/service-worker.ts
git commit -m "feat: minimal service worker for app-shell caching"
```

---

## Chunk 8: End-to-end test, deployment, documentation

### Task 22: Playwright e2e

**Files:**
- Create: `web/playwright.config.ts`
- Create: `web/test/e2e/import-and-compose.spec.ts`

- [ ] **Step 1: `web/playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  webServer: { command: "npm run dev", port: 5173, reuseExistingServer: !process.env.CI },
  use: { baseURL: "http://localhost:5173" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

- [ ] **Step 2: One end-to-end test**

Walk import → inbox → compose round-trip against a Worker pointed at a test bucket. Gate behind `NTS_E2E_BUCKET` env so CI skips when credentials are absent.

The exact mechanics depend on whether the Worker can point at a local R2 bucket during the test. The simplest viable path:

- Spin up `wrangler dev --local` against a temp dir bucket.
- Use the Rust CLI in a subprocess (with `NTS_HOME` set to a temp dir and `storage.backend=r2` pointed at the same bucket via direct S3-compatible config) to push a message.
- Drive the PWA via Playwright through import → inbox → see-message → compose → back-to-CLI verify.

If the integration plumbing is too fiddly for one task, ship a smaller version: paste-bundle import → unlock → inbox → compose works against a static fixture index. Defer the cross-process CLI verification to a follow-up.

- [ ] **Step 3: Verify**

```
cd web && npx playwright install chromium
cd web && npm run e2e
```

- [ ] **Step 4: Commit**

```
git add web/playwright.config.ts web/test/e2e/
git commit -m "test: playwright e2e for import → inbox → compose round-trip"
```

---

### Task 23: Deploy Worker + Pages

**Files:**
- Modify: `web/worker/wrangler.toml` (real bucket, real PWA_ORIGIN)
- Create: `web/README.md`

- [ ] **Step 1: Worker**

```
cd web/worker
npx wrangler r2 bucket create nts-messages   # if not created
# Edit wrangler.toml: bucket_name = "nts-messages", PWA_ORIGIN = "https://nts.pages.dev"
npx wrangler deploy
```

- [ ] **Step 2: Pages**

```
cd web
npm run build
npx wrangler pages deploy dist
```

- [ ] **Step 3: Verify**

- `curl https://nts-worker.<account>.workers.dev/v1/health` → `ok`
- Open the Pages URL on the phone, walk import with a real bundle.
- `wrangler r2 object get nts-messages messages/...` → confirm encrypted blobs.

- [ ] **Step 4: Document the deploy**

Write `web/README.md` with:

- Prerequisites (wrangler login, R2 bucket creation)
- Worker deploy steps and env vars
- Pages deploy steps
- How to rotate the bucket or move providers
- How to add the deploy step to a new device

- [ ] **Step 5: Commit**

Do not commit secrets. Only commit `wrangler.toml` with non-secret bucket/origin values.

```
git add web/worker/wrangler.toml web/README.md
git commit -m "docs: M4a deploy notes for worker and pages"
```

---

### Task 24: Update documentation

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Check off M4a items in `docs/roadmap.md`**

Split the M4 section into M4a (shipped) and M4b (deferred):

```markdown
## Milestone 4: Mobile Access (PWA)
**Goal**: Read and send notes from phone via browser.

### M4a (shipped)
- [x] TypeScript PWA with age-encryption.js
- [x] Identity import via paste-bundle + passphrase
- [x] Fetch + decrypt index and messages
- [x] Push new messages from mobile
- [x] Service Worker for app-shell caching
- [x] Cloudflare Worker R2 proxy with per-device bearer tokens
- [x] `nts device add/list/revoke` CLI commands

### M4b (deferred)
- [ ] QR-based bundle import (`nts export --qr`)
- [ ] WebAuthn PRF biometric unlock
- [ ] ntfy SSE subscription with Service Worker notifications
- [ ] Offline compose queue with mutation log
- [ ] "Install to home screen" prompt
- [ ] Panic-wipe button
```

- [ ] **Step 2: Update `CLAUDE.md` project structure**

Add `web/` and `web/worker/` to the project structure. List the major TS files. Update test counts (Rust unit + Rust integration + TS unit + Worker + Playwright). Note new dependencies (TypeScript, Preact, age-encryption JS) in the Tech Stack mention.

- [ ] **Step 3: Run all test suites**

```
cargo test                       # Rust
cd web && npm test               # TS unit
cd web/worker && npm test        # Worker
cd web && npm run e2e            # Playwright (skip without creds)
```

All pass.

- [ ] **Step 4: Commit**

```
git add docs/roadmap.md CLAUDE.md
git commit -m "docs: M4a complete — update roadmap and project structure"
```

---

## Success criteria (M4a)

Repeated from the spec so the executor doesn't have to flip files:

1. `nts device add phone` produces a URL whose fragment carries a per-device bearer token.
2. Opening the URL on a phone brings up the PWA's import screen with the token pre-captured.
3. Pasting a passphrase-encrypted bundle and entering the device passphrase unlocks the inbox showing the same messages as `nts list` on the laptop.
4. `nts push "hello from laptop"` followed by a refresh in the PWA shows `hello from laptop` in the inbox.
5. Composing in the PWA produces a new entry visible to `nts list` on the laptop.
6. Acking a message in the PWA changes its status to `read` everywhere.
7. Deleting a message in the PWA removes it from R2; the laptop CLI confirms the blob and index entry are gone.
8. Two devices mutating the index simultaneously trigger ETag retries and resolve without data loss.
9. R2 bucket contents (via `wrangler r2 object get`) contain only encrypted blobs.
10. The PWA app-code bundle is under 100 KB gzipped (excluding `age-encryption`).
11. Lighthouse PWA audit passes ("Installable" + "Service Worker registered" + offline reachable).
12. `nts device revoke phone` blocks the phone's bearer token within 60 seconds.

Items deferred per M4 spec milestone breakdown: offline compose queue, WebAuthn, QR import, panic-wipe, ntfy SSE.

---

## Open decisions to resolve during execution

These were called out as open in the spec:

- **Token transport during enrollment.** Spec proposes `location.hash`. Acceptable mitigation for M4a: `history.replaceState('', '', location.pathname)` immediately after read. Document the residual risk in `web/README.md`.
- **WebAuthn PRF vs largeBlob.** Both deferred to M4b. Note in the M4b plan when it's written.
- **`devices.json` plaintext vs Worker KV.** Stay with plaintext on R2 for M4a. Revisit only if device-list metadata becomes a real concern.

---

## Quality gates per chunk

Before moving from one chunk to the next:

- **End of Chunk 1**: `cargo test` passes; `nts device add/list/revoke` work end-to-end against the local backend.
- **End of Chunk 2**: Worker passes its own test suite; `curl` to all routes behaves per the spec.
- **End of Chunk 3**: `npm test` in `web/` passes; crypto fixtures round-trip; merge fixtures match Rust outputs.
- **End of Chunk 4**: Identity wrap/unwrap round-trips in the browser; import flow stores a wrapped identity.
- **End of Chunk 5**: Mock-HTTP sync test passes; pull-merge-push cycle works on paper.
- **End of Chunk 6**: Manual walk-through: import → unlock → inbox → message → compose works against a real Worker.
- **End of Chunk 7**: Offline reload serves the app shell.
- **End of Chunk 8**: Playwright e2e passes; deploy succeeds; success criteria from the spec are met.

If a chunk takes meaningfully longer than expected, push what's done and split the remainder into a follow-up plan. Don't let a chunk grow.
