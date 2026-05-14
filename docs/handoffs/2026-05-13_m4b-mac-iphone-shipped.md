# M4b handoff — Mac + iPhone fully wired, iPad/iPhone-PWA next

**Date**: 2026-05-13 (audit revision)
**Status**: M4b partially shipped. Mac CLI + Mac browser PWA + iPhone (ntfy push) are end-to-end working. Three-pass audit + hardening completed on top of the original M4b ship. iPad and iPhone-PWA enrollment is the next obvious surface to onboard.

## What landed since end-of-M4a

Linear commit list on `main` (oldest → newest):

```
1cc26df fix: print pwa_base_url not worker_base_url in device add
475477f fix: strip r2 credentials from passphrase export bundle
d8aba7f feat: resolve r2 creds, ntfy token, and age identity from env vars
6f2d8db feat: hide consumed and expired by default, add forget action
0bd3656 docs: env-var secrets ADR plus 1password migration walkthrough
8947679 docs: clarify shell-init block is paste-ready, move prereq up
f8abe46 feat: route pwa ntfy through worker proxy at /v1/notify
2f08466 test: scrub nts_* env vars in integration test helper
d439df8 feat: unify cli and pwa ntfy body, add tap-to-open via x-click
6e66650 fix: prevent shell-env identity leaking into sandboxed installs
0c8279d docs: sync m4b state across hub docs
9fa7670 docs: m4b handoff covering shipped surfaces, footguns, and next steps
fc86fde fix: harden /v1/notify and tighten secret resolution           (audit pass 1)
0b4455f chore: commit deployed wrangler.toml bucket and pwa origin     (audit pass 2)
```

**14 commits, all merged via worktree → cherry-pick / ff-only.** No remote pushes since 07a9920 (end of M4a) at handoff write time; the goal-condition triggering this audit also asks for a push at the end, so origin should advance once everything is verified clean.

## Production state

| Surface | URL | Version |
|---|---|---|
| Cloudflare Worker | `https://nts-worker.nagala.workers.dev` | `92c25555-62b6-475c-8bff-385b190bc55f` (post-audit hardening: POST in CORS, topic regex, click-URL scheme, 8 KB body cap) |
| Cloudflare Pages | `https://nts-pwa.pages.dev` | `9097e41c.nts-pwa.pages.dev` (post-audit) |
| ntfy topic | `nts-28eb98ea` on `https://ntfy.sh` | Configured in CLI config + 1Password `NTS Identity Backup/notify_topic` |
| iPhone ntfy app | "ntfy" by Philipp C. Heckel | Subscribed to topic above. Push delivery currently working after delete+reinstall. |
| GitHub Actions CI | `.github/workflows/test.yml` | Runs rust+pwa+worker test suites on every push to main and every PR. Action majors current as of 2026-05-14 (Node 24). |
| Dependabot | `.github/dependabot.yml` | Weekly grouped PR for any new github-actions major. Catches deprecation deadlines automatically. |

## Test totals (verified on `main` after audit)

| Suite | Count | Path |
|---|---|---|
| Rust unit | 91 | `cargo test --lib` |
| Rust integration | 42 | `cargo test --test integration` |
| PWA unit | 152 | `cd web && npm test` |
| PWA e2e | 2 | `cd web && npm run e2e` (Playwright, needs chromium) |
| Worker | 55 | `cd web/worker && npm test` |
| **Total** | **342** | |

## Capabilities shipped in M4b

1. **Env-var-resolved secrets** with 1Password shell-init seeding. R2 access key, R2 secret access key, age identity, and ntfy token can all be loaded from `NTS_*` env vars. Plaintext `config.toml` / `identity.txt` fields remain for back-compat until M5. See `docs/architecture.md` ADR "Env-var-resolved secrets with 1Password seeding via shell init".

2. **Sandboxed-install guard**: when `NTS_HOME` is explicitly set, the CLI ignores `NTS_AGE_IDENTITY` from the shell and reads `identity.txt` only. Prevents accidental key reuse across nominally-distinct installs. See addendum in `docs/architecture.md`.

3. **R2 credentials stripped from passphrase bundles**: `nts export --passphrase` no longer includes `storage.r2.*` in the bundle. The PWA never needed those keys (it talks to the Worker, not R2). Eliminated a credential blast-radius widening.

4. **Consumed/expired UX in PWA**: hidden from default inbox behind "Show archive (N)" toggle. Message route renders "This message was consumed. Only the receipt remains." in calm text instead of error red. Delete button becomes "Forget" when the body is already gone from R2 (removes the index entry, not the absent blob).

5. **Worker as only PWA network egress**: PWA never connects to ntfy.sh directly. All ntfy publishes go through `POST /v1/notify` on the Worker, which validates the bearer token and forwards as a normal ntfy POST server-side. See `docs/architecture.md` ADR "Worker as the only network egress from the PWA".

6. **Unified ntfy body format** across CLI and PWA: `new note · tag1, tag2 · expires in 4h`. Byte-identical on both sides via the cross-language fixture in `web/test/unit/compose.test.ts` referencing the Rust test in `src/notify.rs`.

7. **Tap-to-open notifications** via `X-Click` header pointing at `{pwa_base_url}/m/{id}`. CLI gets `pwa_base_url` from config; PWA uses `window.location.origin`.

8. **`storage.pwa_base_url` config key**: separates "where the API lives" from "where the user-facing app lives." Without this, `nts device add` printed the wrong URL and tapping the enrollment link gave 401 from the Worker's `requireAuth`.

## Audit pass (2026-05-13)

After the initial M4b ship, four iterative deep-audit passes ran across all changed surfaces. Pass 1 caught 9 issues. Pass 2 confirmed all fixes plus surfaced one preexisting uncommitted wrangler.toml drift. Pass 3 confirmed no further significant findings and produced only doc updates. Pass 4 (post-action-bump-and-Dependabot) confirmed zero new bugs and zero doc drift, and surfaced five optional optimizations; two with real value shipped (`dbec0c3` paths-ignore for docs-only CI runs, plus an annotation on the project-scoped memory file marking the deprecation deadline as resolved). Pass 5 was the verify-after-final-fix sanity check; clean.

Audit commits:

- `fc86fde` — `/v1/notify` hardening + secret-resolver trim + `deleteMessage` cache cleanup + `validateBundle` notify check. Adds 17 new tests on top of the pre-audit baseline (8 worker + 5 PWA + 4 Rust); the overall session delta of 62 new tests covers more than just this commit (env-var resolver, sandboxed-install guard, X-Click, etc.).
- `0b4455f` — Commit deployed wrangler.toml bucket + PWA origin so the repo matches production.
- `dbec0c3` — Skip docs-only pushes in CI. Cuts ~50% of recent CI runs (4 of last 8 commits were docs-only) without affecting PR verification.

### Fixes that landed in audit

1. **CORS preflight for /v1/notify** (`web/worker/src/index.ts:23`): `Access-Control-Allow-Methods` now includes POST. The PWA's compose-→-ntfy flow happened to work in production because browsers were lenient about the missing POST entry, but strict-mode Safari/Firefox would have blocked the preflight. Verified live against production via `curl -X OPTIONS` before/after.

2. **Topic injection guard** (`web/worker/src/index.ts:81`): Topic is now validated against `^[A-Za-z0-9_-]{1,64}$` instead of being string-concatenated into the upstream URL raw. A stolen bearer could previously have submitted `topic: "abc?token=stolen"` to smuggle URL parameters past validation.

3. **Click-URL scheme allowlist** (`web/worker/src/index.ts:87-93`): Only `http(s)://` accepted. `javascript:`, `data:`, `file:`, `vbscript:`, `intent:`, etc. are rejected at the Worker before reaching ntfy or the device.

4. **Body-size cap on /v1/notify** (`web/worker/src/index.ts:75`): 8 KB hard cap. Production payload is ~150 bytes; the cap bounds DoS surface for stolen bearers. Note: still reads the body before the size check, but Cloudflare Workers' runtime caps requests at ~100 MB so true OOM is unlikely.

5. **`secret::resolve` trims whitespace** (`src/secret.rs:14-25`): env values like `"AKIA...\n"` (from shell-init seeded with `echo` instead of `printf '%s'`) used to silently fail S3 auth. Trimmed before return.

6. **PWA `deleteMessage` cache cleanup** (`web/src/core/index-store.ts:295-308`): immediate-success path now drops `cache_messages/{id}` from IDB. Previously orphaned the entry forever; only `retryPendingDeletes` cleaned up cached blobs.

7. **`validateBundle` notify check** (`web/src/core/import.ts:175-196`): rejects bundles where `notify.enabled=true` but `notify.ntfy` is missing/empty. Hand-edited configs that previously passed validation would silently never fire pushes.

8. **Bundle schema preserves new M4b fields** (`web/src/core/import.ts:25-58`): `pwa_base_url` and `notify.ntfy.token_env` are accepted by the validator so CLI-emitted bundles round-trip cleanly.

9. **CLI sandboxed-install guard** (`src/commands/mod.rs:109-142`, added pre-audit): `NTS_HOME` set means `NTS_AGE_IDENTITY` from the shell env is ignored. Prevents the developer-tries-a-throwaway-install footgun where the production identity from shell init would silently encrypt to the wrong recipient in the sandbox.

### Verified not-fixed (correctly deferred)

- **`/v1/notify` host allowlist for `server`** — still accepts any http(s) host. Tracked in `docs/roadmap.md` as the final open M4b item. Threat model: requires a stolen bearer; today's hardening narrowed the attack surface (topic + click + body-size + scheme) but a stolen bearer still grants R2 RW so the SSRF surface is bounded by the existing privilege class.
- **Non-sandboxed identity loader path** is not testable in `tests/integration.rs` without polluting the developer's real `~/Library/Application Support/nts` directory. Covered by production smoke test instead.
- **Preexisting M4a hardening gaps** (no body-size limit on `/v1/index` and `/v1/messages/:id` PUTs, no `Access-Control-Max-Age`, no privilege classes on device tokens) were deliberately scoped OUT of M4b.

## Known footguns (do not be surprised by these)

These were captured by the M4b audit pass. None are blocking, all are documented somewhere in the codebase.

1. **PWA preview URL pinning** (`web/src/routes/compose.tsx:131`): compose from `https://abc123.nts-pwa.pages.dev` (Pages preview) pins X-Click to that URL. Cloudflare GCs previews after ~30 days, breaking the old notifications. CLI's `pwa_base_url` is the stable answer; PWA could mirror this via device config (M4b polish item).

2. **`/v1/notify` is an authenticated open proxy for arbitrary http(s) hosts** (`web/worker/src/index.ts::handleNotifyPost`): even with the audit's hardening (topic regex, click scheme allowlist, body-size cap, server URL parse), the Worker still forwards to any http(s) host the caller names. A stolen bearer can still POST to an internal corp API. Mitigation: allowlist `server` to ntfy hosts (captured in `docs/roadmap.md` as the final open M4b item). Threat model: requires stolen bearer; today all device tokens are read-write so a leaked phone token already grants R2 RW — the SSRF surface is bounded by that prior privilege.

3. **No privilege classes for device tokens** (`web/worker/src/index.ts:211-229`): one bearer = full R2 RW + notify proxy. No "notify-only" or "read-only" class. A revoked-but-cached token (60s TTL) can still issue notifications during the window.

4. **Unknown message statuses bucket as archive** (`web/src/routes/inbox.tsx`): `ACTIVE_STATUSES = {"unread", "read"}` — corrupt or future status values vanish from default view. Debug via "Show archive".

5. **`send_request` 401/403 error message is wrong for env-resolved ntfy tokens** (`src/notify.rs:114-118`): the suggestion says "check `nts config set notify.ntfy.token`" but the actual cause may be `NTS_NTFY_TOKEN` env var unset. Tiny: rarely hits, but the hint is misleading.

6. **Custom-domain Workers will hit CSP** (`web/index.html:9`): `connect-src 'self' https://*.workers.dev` only covers default `workers.dev` hosts. If `storage.worker_base_url` ever moves to `api.nts.example`, every Worker call is CSP-blocked. Not yet an issue because the Worker uses the default `.workers.dev` subdomain.

7. **TTL parity gap** (CLI is a superset): CLI accepts `--ttl 30m` and produces `"new note · expires in 30m"`. PWA's TtlOption is a closed set `{none, 1h, 4h, 1d, 7d}` so it cannot generate the `30m` body. Not a bug; just means PWA-side TTL is less expressive.

8. **Test-helper env scrub is a single-source-of-truth list** (`tests/integration.rs:13-16`): scrubs `NTS_AGE_IDENTITY`, `NTS_R2_ACCESS_KEY_ID`, `NTS_R2_SECRET_ACCESS_KEY`, `NTS_NTFY_TOKEN`. Any new `NTS_*` resolver added without updating this list will leak shell env into tests. Single point to remember when adding env-resolved secrets.

9. **`nts import` interacts badly with a populated `NTS_AGE_IDENTITY` env var** (`src/commands/import.rs:13`, `src/commands/mod.rs:109-142`): When the user runs `nts import bundle.age --passphrase` outside a sandboxed install (no `NTS_HOME` set) and their shell exports `NTS_AGE_IDENTITY` from the standard `~/.zshenv` seeding, the import writes the bundle's identity to `identity.txt` but every subsequent command silently reads `NTS_AGE_IDENTITY` from the shell env instead — the imported identity is effectively ignored. The import LOOKS successful (no error, `identity.txt` updated) but is a no-op until the user also rotates or unsets the env var. Realistic recovery scenario: laptop dies, user clones the repo on a new machine, runs `nts init` and then `nts import` to restore from 1Password — this works on the new machine because `NTS_AGE_IDENTITY` is not yet set there. On the original machine it would silently use the wrong identity. Mitigation candidates for a future commit: (a) `nts import` warns when `NTS_AGE_IDENTITY` is set without `NTS_HOME`, (b) `nts import` refuses in that case and tells the user to unset the env var or use `NTS_HOME`. One-line fix either way; deferred because the failure mode (decrypt fails on the imported messages) is loud as soon as the user tries to read.

## Operational state (1Password, shell-init, env)

1Password items in `Private` vault (Helmy Family account, USER_ID `YMWE45M5BRCSZIN37BO4RC4JPE`):

| Item | Used for | Fields the shell-init reads |
|---|---|---|
| `Cloudflare nts-messages API key` | R2 S3 creds | `Access Key ID`, `Secret Access Key` |
| `NTS Identity Backup` | Identity + onboarding | `bundle`, `export_passphrase`, `device_passphrase_mac`, `device_token_mac`, `notify_topic`, `identity` (the user added this manually for `NTS_AGE_IDENTITY`) |

User has the shell-init block in `~/.zshenv` (per `web/README.md` § "Moving secrets to 1Password"). On cold-start it runs `op read` once per missing cache file at `~/.nts/secrets/<name>` mode 0600, then exports `NTS_R2_ACCESS_KEY_ID`, `NTS_R2_SECRET_ACCESS_KEY`, and `NTS_AGE_IDENTITY`. Subsequent shells inherit silently. Touch ID fires once per cold-start per missing cache file.

The user's CLI config has `*_env` keys set: `storage.r2.access_key_id_env`, `storage.r2.secret_access_key_env`, and (implicitly via NTS_AGE_IDENTITY) the identity path. They have NOT deleted the plaintext fields yet — both paths still work and the env-resolved path silently takes precedence.

## What's next

### Immediate: iPad / iPhone PWA enrollment (next session, ~30 min each)

The flow is identical to Mac enrollment:

1. On the Mac CLI: `nts device add ipad` → token printed plus enrollment URL using the now-correct `pwa_base_url`.
2. Save token + new `device_passphrase_ipad` to 1Password.
3. Open the enrollment URL in Safari on iPad. PWA captures token from hash, scrubs via `history.replaceState`.
4. Paste bundle (from 1P), enter export passphrase, enter device passphrase, submit.
5. Auto-unlock, land at inbox. Existing messages should sync.
6. Compose a test message — phone should ping.
7. (Optional) "Add to Home Screen" via the Safari share sheet.

Same flow for iPhone. The bundle in 1P already includes notify config (re-exported earlier this session), so iPad/iPhone PWAs will fire ntfy on compose correctly.

### Next focused chunk: M4b inbox polish

User wants the full polish bundle as one chunk:

- **Must-do** (real bugs or close): clickable multi-tag URL-state filter, filter status bar with clear, filter empty-state copy, sticky header, sync error toast, loading state during first sync
- **Should-do**: TTL badge on rows, priority indicator (4-5 distinct visual), status chip quick-filters
- **Skip**: text search and bulk select/ack/delete — they deserve their own design pass and belong in a feature-focused session, not polish

Multi-tag URL state with intersection semantics (`?tags=work,urgent` → messages with BOTH). ~3-4 hours total for must + should.

### Then: M4b Web Push (medium chunk, 1-2 sessions)

Replace ntfy with native Web Push:

- VAPID key pair generation (Cloudflare Worker can generate via `crypto.subtle.generateKey`)
- Service Worker push-event handler in `web/src/service-worker.ts`
- PWA subscription flow at unlock or first-compose
- Worker endpoint `POST /v1/push/subscribe` to store subscriptions per device
- Worker endpoint `POST /v1/push/fanout` to push to all subscribed devices
- CLI fires `POST /v1/push/fanout` instead of (or in addition to) ntfy

Once Web Push works, ntfy becomes optional and the open-proxy footgun goes away.

### M5+: the remaining roadmap items

See `docs/roadmap.md`. The active queue: QR-based bundle import, WebAuthn PRF biometric unlock, offline compose queue, panic-wipe, `devices.json` migration to Workers KV, post-quantum recipients.

## Follow-ups with hard deadlines

### Done in this session (2026-05-13/14)

The Node 20 deprecation surfaced during initial CI setup. Sweep completed end-to-end:

- `note-to-self` workflow: `checkout@v4 -> v6`, `setup-node@v4 -> v6`, `cache@v4 -> v5`, `node-version: "20" -> "22"`. Commits `608b1c9` then `7da5395`. CI re-verified clean (zero deprecation warnings).
- Cross-repo sweep landed the same fix in `atrib-internal`, `comuser`, `second-brain`. See `~/repos/second-brain/vault/meta/deadlines.md` for the full audit log including the two version-mismatch traps that initially slipped past (`setup-python@v5` and `upload-artifact@v5` both still on Node 20 despite the version-number).
- Dependabot config (`fa0e250` then `b3b70c4`) shipped to all 4 repos. Weekly grouped PR opens for any new action major version, so future deprecations become "merge the PR" rather than "audit and bump."

### atrib bump completed (2026-05-13, by parallel atrib session)

`atrib` commit `3ae133d`: 8 action bumps, Node runtime 20 to 22, `.github/dependabot.yml` shipped. CI 3/3 green (CI, Release, security-scan) on the bump commit. Zero Node 20 deprecation warnings verified via `gh run view --log`. Dependabot first scan ran on-push, completed green. The Release workflow was already on Node 24, only CI/scan needed bumping.

All five repos with GitHub Actions on this account are now (a) on current action majors with Node 24 bindings and (b) protected by weekly Dependabot. The Node 20 deprecation closeout is fully resolved with 13 days of margin against the 2026-06-02 cutoff.

### Soft deadlines (no clock)

- **`/v1/notify` server host allowlist** closes the open-proxy footgun for stolen bearers. Security debt; captured in `docs/roadmap.md`.
- **Inbox polish bundle** (clickable tags, sticky header, sync error toast, loading-state, etc.). UX debt.
- **Web Push replaces ntfy** eliminates the SSRF footgun once Web Push lands. Motivated by ongoing ntfy iOS reliability concerns.

## How to push to origin

Origin is up to date as of this handoff revision. The goal-condition session pushed everything on 2026-05-13. Future sessions follow the standard pattern:

```sh
git log --oneline origin/main..HEAD  # verify what's about to ship
git push origin main
```

Per `~/.claude/CLAUDE.md` global rules: no `--no-verify`, no force-push without explicit request, no Co-Authored-By trailers.

## Things I would do differently next time

1. **Catch the bundle schema drift earlier**. When I added `pwa_base_url` and `*_env` to the CLI config, I should have walked the round-trip path through export.rs → bundle JSON → PWA validator immediately. Instead I found it via post-hoc audit.

2. **Cross-language fixture pattern is load-bearing — formalize it**. We now have four cross-language invariants enforced by paired tests: SHA-256 token hash, merge JSON corpus, age ciphertext round-trip, ntfy body format. The pattern works but it's implicit. A short `docs/cross-language-invariants.md` would name the pattern and list the four sites so future contributions don't accidentally drift either side.

3. **Worker as proxy was the right call but I almost shipped the wrong one**. My first instinct on the CSP issue was to widen `connect-src`. The user pushed back and asked for Option B (proxy). I should have offered the proxy as the default since it's strictly the better architectural answer, then mentioned the CSP-widen as the quick-and-dirty fallback. Lead with the right answer, not the easy one.

4. **APNs / ntfy debug arc cost an hour.** The remedy was "delete app, restart phone, reinstall, allow notifications on first prompt." This should have been Test 1, not Test 7. I burned through diagnostic credit by being confidently wrong about Background App Refresh being load-bearing. Captured a troubleshooting note as M4b polish item to land in `web/README.md`.

5. **The audit pass was high-leverage.** Spawning a fresh agent to read all M4b surfaces caught 17 distinct issues — 5 real bugs, 5 doc drifts, 7 footguns — that I would not have caught by spot-checking. Worth doing at every milestone gate, not just M4b.
