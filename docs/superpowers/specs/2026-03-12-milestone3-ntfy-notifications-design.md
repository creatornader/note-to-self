# Milestone 3: ntfy Push Notifications — Design Spec

## Goal

Phone gets notified when a new message is pushed. Notification is a nudge only — message content never travels through the notification system, preserving the E2E encryption guarantee.

## Config

`config.toml` gains a top-level `[notify]` section:

```toml
[notify]
enabled = true
backend = "ntfy"

[notify.ntfy]
server = "https://ntfy.sh"       # default, overridable for self-hosted
topic = "nts-a1b2c3d4"           # random topic name
token = "tk_..."                 # optional access token for private topics
```

- `enabled`: master toggle (default: `true` once setup is run)
- `backend`: only `"ntfy"` for now, extensible later
- `server`: defaults to `https://ntfy.sh`, can point to self-hosted instance
- `topic`: random name generated during setup to avoid guessable names
- `token`: optional Bearer token for private topic auth

Individual settings adjustable via `nts config get/set notify.*`.

## Setup Flow

`nts notify setup`:

1. Generates a random topic name: `nts-` + 8 random hex chars
2. Prints instructions: "Install the ntfy app on your phone, subscribe to topic `nts-<hash>`"
3. Sends a test notification: "nts connected!"
4. Prints: "If you received the notification, you're all set!"
5. Saves `[notify]` section to `config.toml` with `enabled = true`

If the user already has a topic or self-hosted instance, they can skip setup and use `nts config set notify.ntfy.topic <topic>` directly.

If `nts notify setup` is run again, it warns that notifications are already configured and asks the user to use `nts config set` to change individual settings. It does not overwrite the existing topic.

## Notification Behavior

### What Gets Sent

**Never** the message content. The notification body is a generic nudge:

- Default: `"New note"`
- With tags: `"New note: work, urgent"` (tag names only — these are user-chosen labels, not message content)
- With TTL: `"New note (expires in 4h)"`
- With both: `"New note: work (expires in 4h)"`

Title is always `"Note to Self"`.

### When It Fires

- After successful push (message blob + index saved/synced)
- Only if `notify.enabled = true` in config
- Skippable per-push with `--quiet` flag
- If the HTTP request to ntfy fails: print a warning, never fail the push

### Configurable Default

`notify.enabled` in config sets the default behavior. Per-push override:

- `--quiet`: suppress notification for this push (regardless of config)
- Config `enabled = false`: no notifications unless explicitly re-enabled

### Priority Mapping

The `--priority` flag on `nts push` maps to ntfy priority levels:

| `--priority` value | ntfy priority | Phone behavior |
|---------------------|---------------|----------------|
| (omitted)           | 3 (default)   | Normal notification |
| `low`               | 2             | Silent / no sound |
| `high`              | 4             | Loud, shows prominently |
| `urgent`            | 5             | Persistent, bypasses DND |

Priority is a transient signal — it affects the notification only, not stored on the message.

## HTTP Request

Single blocking POST to the ntfy server:

```
POST https://ntfy.sh/{topic}
Authorization: Bearer tk_...  (only if token is configured)
X-Priority: 3
X-Title: Note to Self

New note
```

Uses `ureq` crate (blocking, minimal, no async runtime needed). Timeout: 5 seconds — a hung ntfy server must never block the CLI.

## New CLI Surface

### New flags on `nts push`:

| Flag | Purpose |
|------|---------|
| `--priority <level>` | Notification priority: `low`, `default`, `high`, `urgent` |
| `--quiet` | Suppress notification for this push |

### New subcommand:

| Command | Purpose |
|---------|---------|
| `nts notify setup` | Guided setup: generate topic, send test notification, save config |

## Code Architecture

### New files:

- `src/notify.rs` — `NtfyConfig` struct, `send()` function, priority mapping, notification body generation

### Modified files:

- `src/config.rs` — Add `NotifyConfig` struct with `enabled`, `backend`, `ntfy` fields; extend `get()`/`set()` matchers
- `src/commands/push.rs` — Call `notify::send()` after successful save_and_sync if enabled and not `--quiet`
- `src/main.rs` — Add `--priority` and `--quiet` to Push args, add `Notify(NotifyCommands)` with `Setup` subcommand
- `src/commands/notify_cmd.rs` (new) — `nts notify setup` implementation

### Dependencies:

| Crate | Purpose |
|-------|---------|
| `ureq` | Blocking HTTP client for ntfy POST requests |

## Error Handling

| Scenario | Behavior |
|----------|----------|
| ntfy unreachable | Warn: "Note pushed. Notification failed: connection error" |
| Invalid token (401/403) | Warn: "Notification auth failed — check `nts config set notify.ntfy.token`" |
| Topic not configured | Skip silently (notifications not set up) |
| Malformed notify config | Warn, skip notification |
| Rate limited (429) | Warn: "ntfy rate limit reached — notification skipped. Consider self-hosting." |
| Empty/whitespace topic | Treat as not configured, skip silently |

All errors follow the same pattern as M2: **never block the user, warn clearly**.

## Testing

- Unit tests: priority mapping, notification body generation (with/without tags/TTL), config parsing
- Integration test: `nts notify setup` writes config correctly
- No live ntfy calls in tests — test request construction, not the network

## Scope Exclusions

- **Self-hosted ntfy Docker compose**: Out of scope. Users can self-host and point `notify.ntfy.server` at it — no code changes needed.
- **Tag-based priority mapping**: Excluded. `--priority` flag is explicit and simpler.
- **Message content in notifications**: Explicitly forbidden by design — notifications are nudges only.

## Success Criteria

1. `nts notify setup` generates topic, sends test notification, saves config
2. `nts push "hello"` sends a notification with title "Note to Self" and body "New note"
3. `nts push "hello" --priority high` sends a high-priority notification
4. `nts push "hello" --quiet` suppresses the notification
5. `nts push "hello" --tag work` sends notification with body "New note: work"
6. `nts push "hello" --ttl 4h` sends notification with body "New note (expires in 4h)"
7. `nts config set notify.enabled false` disables all notifications
8. Notification failure never blocks or fails the push
9. All existing tests pass (no regressions)
10. `nts config get notify.ntfy.token` masks the secret
