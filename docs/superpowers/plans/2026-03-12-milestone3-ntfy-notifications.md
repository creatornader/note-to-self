# Milestone 3: ntfy Push Notifications — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send push notifications to the user's phone via ntfy.sh when a message is pushed, without ever exposing message content.

**Architecture:** A new `notify.rs` module handles notification logic (body generation, priority mapping, HTTP POST). Config gains a `[notify]` section. The push command calls `notify::send()` after a successful save_and_sync. Notifications are fire-and-forget — failures warn but never block.

**Tech Stack:** `ureq` (blocking HTTP client), ntfy.sh API (simple POST), existing `config.rs` + `clap` patterns.

**Spec:** `docs/superpowers/specs/2026-03-12-milestone3-ntfy-notifications-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/notify.rs` | Notification logic: body generation, priority mapping, HTTP POST to ntfy | Create |
| `src/config.rs` | Add `NotifyConfig` + `NtfyConfig` structs, extend `get()`/`set()` | Modify |
| `src/commands/notify_cmd.rs` | `nts notify setup` command implementation | Create |
| `src/commands/push.rs` | Call `notify::send()` after successful push | Modify |
| `src/commands/mod.rs` | Add `pub mod notify_cmd;` | Modify |
| `src/main.rs` | Add `mod notify;`, `--priority`/`--quiet` flags, `Notify` subcommand | Modify |
| `Cargo.toml` | Add `ureq` dependency | Modify |
| `src/commands/config_cmd.rs` | Update secret masking to include `token` keys | Modify |
| `tests/integration.rs` | Integration tests for notify setup and push with --quiet | Modify |

---

## Chunk 1: Config and Notify Module

### Task 1: Add `ureq` dependency and `NotifyConfig` to config

**Files:**
- Modify: `Cargo.toml`
- Modify: `src/config.rs`

- [ ] **Step 1: Add ureq to Cargo.toml**

Add `ureq` to `[dependencies]` in `Cargo.toml`, after the `rpassword` line:

```toml
ureq = "2"
```

- [ ] **Step 2: Add NotifyConfig and NtfyConfig structs to config.rs**

Add the following structs after `R2Config` (after line 17):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NtfyConfig {
    pub server: String,
    pub topic: String,
    #[serde(default)]
    pub token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotifyConfig {
    pub enabled: bool,
    pub backend: String,
    pub ntfy: Option<NtfyConfig>,
}
```

- [ ] **Step 3: Add `notify` field to Config struct**

Change the `Config` struct to:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub storage: StorageConfig,
    #[serde(default)]
    pub notify: Option<NotifyConfig>,
}
```

The `#[serde(default)]` ensures backward compatibility — existing `config.toml` files without `[notify]` will deserialize with `notify: None`.

- [ ] **Step 4: Extend `get()` with notify keys**

In the `get()` method, add these match arms before the `_ => None` catch-all:

```rust
"notify.enabled" => self.notify.as_ref().map(|n| n.enabled.to_string()),
"notify.backend" => self.notify.as_ref().map(|n| n.backend.clone()),
"notify.ntfy.server" => self.notify.as_ref().and_then(|n| n.ntfy.as_ref()).map(|f| f.server.clone()),
"notify.ntfy.topic" => self.notify.as_ref().and_then(|n| n.ntfy.as_ref()).map(|f| f.topic.clone()),
"notify.ntfy.token" => self.notify.as_ref().and_then(|n| n.ntfy.as_ref()).and_then(|f| f.token.clone()),
```

- [ ] **Step 5: Extend `set()` with notify keys**

In the `set()` method, add these match arms before the `_ => anyhow::bail!` catch-all:

```rust
"notify.enabled" => {
    let n = self.notify.get_or_insert(NotifyConfig {
        enabled: true,
        backend: "ntfy".to_string(),
        ntfy: None,
    });
    n.enabled = value.parse::<bool>().map_err(|_| anyhow::anyhow!("Expected true or false"))?;
}
"notify.backend" => {
    let n = self.notify.get_or_insert(NotifyConfig {
        enabled: true,
        backend: "ntfy".to_string(),
        ntfy: None,
    });
    n.backend = value.to_string();
}
k if k.starts_with("notify.ntfy.") => {
    let n = self.notify.get_or_insert(NotifyConfig {
        enabled: true,
        backend: "ntfy".to_string(),
        ntfy: None,
    });
    let ntfy = n.ntfy.get_or_insert(NtfyConfig {
        server: "https://ntfy.sh".to_string(),
        topic: String::new(),
        token: None,
    });
    match k {
        "notify.ntfy.server" => ntfy.server = value.to_string(),
        "notify.ntfy.topic" => ntfy.topic = value.to_string(),
        "notify.ntfy.token" => ntfy.token = Some(value.to_string()),
        _ => anyhow::bail!("Unknown config key: {k}"),
    }
}
```

- [ ] **Step 6: Write tests for notify config**

Add the following tests to the `#[cfg(test)] mod tests` block in `config.rs`:

```rust
#[test]
fn test_config_notify_roundtrip() {
    let tmp = TempDir::new().unwrap();
    let mut cfg = Config::default_with_path(tmp.path());
    cfg.notify = Some(NotifyConfig {
        enabled: true,
        backend: "ntfy".to_string(),
        ntfy: Some(NtfyConfig {
            server: "https://ntfy.sh".to_string(),
            topic: "nts-abcd1234".to_string(),
            token: Some("tk_test123456".to_string()),
        }),
    });
    let path = tmp.path().join("config.toml");
    cfg.save(&path).unwrap();
    let loaded = Config::load(&path).unwrap();
    let notify = loaded.notify.unwrap();
    assert!(notify.enabled);
    assert_eq!(notify.backend, "ntfy");
    let ntfy = notify.ntfy.unwrap();
    assert_eq!(ntfy.topic, "nts-abcd1234");
    assert_eq!(ntfy.token.unwrap(), "tk_test123456");
}

#[test]
fn test_config_without_notify_loads() {
    let tmp = TempDir::new().unwrap();
    let cfg = Config::default_with_path(tmp.path());
    let path = tmp.path().join("config.toml");
    cfg.save(&path).unwrap();
    let loaded = Config::load(&path).unwrap();
    assert!(loaded.notify.is_none());
}

#[test]
fn test_config_set_notify_keys() {
    let mut cfg = Config::default_with_path(Path::new("/tmp"));
    cfg.set("notify.enabled", "true").unwrap();
    cfg.set("notify.ntfy.topic", "my-topic").unwrap();
    cfg.set("notify.ntfy.token", "tk_abc").unwrap();
    assert!(cfg.notify.as_ref().unwrap().enabled);
    assert_eq!(
        cfg.notify.as_ref().unwrap().ntfy.as_ref().unwrap().topic,
        "my-topic"
    );
}

#[test]
fn test_config_get_notify_keys() {
    let mut cfg = Config::default_with_path(Path::new("/tmp"));
    cfg.notify = Some(NotifyConfig {
        enabled: true,
        backend: "ntfy".to_string(),
        ntfy: Some(NtfyConfig {
            server: "https://ntfy.sh".to_string(),
            topic: "test-topic".to_string(),
            token: Some("tk_secret".to_string()),
        }),
    });
    assert_eq!(cfg.get("notify.enabled").unwrap(), "true");
    assert_eq!(cfg.get("notify.ntfy.topic").unwrap(), "test-topic");
    assert_eq!(cfg.get("notify.ntfy.token").unwrap(), "tk_secret");
}
```

- [ ] **Step 7: Run tests to verify**

Run: `cargo test config::tests -- --nocapture`
Expected: All config tests pass (previous 5 + new 4 = 9 total).

- [ ] **Step 8: Commit**

```bash
git add Cargo.toml src/config.rs
git commit -m "feat: add notify config structs and get/set support"
```

---

### Task 2: Create the notify module

**Files:**
- Create: `src/notify.rs`
- Modify: `src/main.rs` (add `mod notify;`)

This task creates the core notification logic: priority mapping, body generation, and the HTTP POST to ntfy.

- [ ] **Step 1: Create `src/notify.rs` with priority enum and body generation**

```rust
use crate::config::{Config, NtfyConfig};

/// ntfy priority levels (1-5)
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Priority {
    Low,
    Default,
    High,
    Urgent,
}

impl Priority {
    /// Parse from CLI flag value
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "low" => Some(Self::Low),
            "default" => Some(Self::Default),
            "high" => Some(Self::High),
            "urgent" => Some(Self::Urgent),
            _ => None,
        }
    }

    /// Map to ntfy numeric priority
    pub fn to_ntfy_priority(self) -> u8 {
        match self {
            Self::Low => 2,
            Self::Default => 3,
            Self::High => 4,
            Self::Urgent => 5,
        }
    }
}

/// Build the notification body. Never includes message content.
pub fn build_body(tags: &[String], ttl: &Option<String>) -> String {
    let mut body = "New note".to_string();

    if !tags.is_empty() {
        body.push_str(": ");
        body.push_str(&tags.join(", "));
    }

    if let Some(ttl_str) = ttl {
        body.push_str(&format!(" (expires in {ttl_str})"));
    }

    body
}

/// Send a notification via ntfy. Fire-and-forget: prints warnings on failure, never errors.
pub fn send(config: &Config, tags: &[String], ttl: &Option<String>, priority: Option<Priority>) {
    let ntfy = match config.notify.as_ref().and_then(|n| {
        if n.enabled {
            n.ntfy.as_ref()
        } else {
            None
        }
    }) {
        Some(ntfy) => ntfy,
        None => return, // Notifications not configured or disabled
    };

    // Skip if topic is empty or whitespace
    if ntfy.topic.trim().is_empty() {
        return;
    }

    if let Err(msg) = send_request(ntfy, tags, ttl, priority) {
        eprintln!("Note pushed. {msg}");
    }
}

fn send_request(
    ntfy: &NtfyConfig,
    tags: &[String],
    ttl: &Option<String>,
    priority: Option<Priority>,
) -> Result<(), String> {
    let url = format!("{}/{}", ntfy.server.trim_end_matches('/'), ntfy.topic);
    let body = build_body(tags, ttl);
    let prio = priority.unwrap_or(Priority::Default).to_ntfy_priority().to_string();

    let mut req = ureq::post(&url)
        .header("X-Title", "Note to Self")
        .header("X-Priority", &prio)
        .timeout(std::time::Duration::from_secs(5));

    if let Some(token) = &ntfy.token {
        req = req.header("Authorization", &format!("Bearer {token}"));
    }

    match req.send_string(&body) {
        Ok(_) => Ok(()),
        Err(ureq::Error::Status(status, _)) => {
            match status {
                401 | 403 => Err("Notification auth failed — check `nts config set notify.ntfy.token`.".to_string()),
                429 => Err("ntfy rate limit reached — notification skipped. Consider self-hosting.".to_string()),
                _ => Err(format!("Notification failed (HTTP {status}).")),
            }
        }
        Err(_) => Err("Notification failed: connection error.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_priority_from_str() {
        assert_eq!(Priority::from_str("low"), Some(Priority::Low));
        assert_eq!(Priority::from_str("default"), Some(Priority::Default));
        assert_eq!(Priority::from_str("high"), Some(Priority::High));
        assert_eq!(Priority::from_str("urgent"), Some(Priority::Urgent));
        assert_eq!(Priority::from_str("invalid"), None);
    }

    #[test]
    fn test_priority_to_ntfy() {
        assert_eq!(Priority::Low.to_ntfy_priority(), 2);
        assert_eq!(Priority::Default.to_ntfy_priority(), 3);
        assert_eq!(Priority::High.to_ntfy_priority(), 4);
        assert_eq!(Priority::Urgent.to_ntfy_priority(), 5);
    }

    #[test]
    fn test_build_body_plain() {
        let body = build_body(&[], &None);
        assert_eq!(body, "New note");
    }

    #[test]
    fn test_build_body_with_tags() {
        let body = build_body(&["work".to_string(), "urgent".to_string()], &None);
        assert_eq!(body, "New note: work, urgent");
    }

    #[test]
    fn test_build_body_with_ttl() {
        let body = build_body(&[], &Some("4h".to_string()));
        assert_eq!(body, "New note (expires in 4h)");
    }

    #[test]
    fn test_build_body_with_tags_and_ttl() {
        let body = build_body(&["work".to_string()], &Some("30m".to_string()));
        assert_eq!(body, "New note: work (expires in 30m)");
    }
}
```

- [ ] **Step 2: Add `mod notify;` to main.rs**

In `src/main.rs`, add `mod notify;` after `mod sync_state;` (after line 11):

```rust
mod notify;
```

- [ ] **Step 3: Run tests to verify**

Run: `cargo test notify::tests -- --nocapture`
Expected: All 6 notify tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/notify.rs src/main.rs
git commit -m "feat: notify module with priority mapping and body generation"
```

---

## Chunk 2: CLI Integration and Notify Setup Command

### Task 3: Add --priority and --quiet flags to push command

**Files:**
- Modify: `src/main.rs`
- Modify: `src/commands/push.rs`

- [ ] **Step 1: Add flags to Push variant in main.rs**

In `src/main.rs`, update the `Push` variant in the `Commands` enum to add `priority` and `quiet` after the existing `ttl` field:

```rust
    Push {
        /// Message content (reads from stdin if omitted)
        content: Option<String>,
        /// Tags for the message
        #[arg(long, short)]
        tag: Vec<String>,
        /// Time-to-live (e.g., 30m, 4h, 7d)
        #[arg(long)]
        ttl: Option<String>,
        /// Notification priority (low, default, high, urgent)
        #[arg(long)]
        priority: Option<String>,
        /// Suppress notification for this push
        #[arg(long)]
        quiet: bool,
    },
```

- [ ] **Step 2: Update the match arm for Push in main.rs**

Update the `Commands::Push` match arm in `fn main()`:

```rust
Commands::Push { content, tag, ttl, priority, quiet } => {
    commands::push::run(content, tag, ttl, priority, quiet)
}
```

- [ ] **Step 3: Update push.rs signature and add notification call**

Update `src/commands/push.rs` to accept the new parameters and call `notify::send()`:

Change the function signature from:
```rust
pub fn run(content: Option<String>, tags: Vec<String>, ttl: Option<String>) -> Result<()> {
```
to:
```rust
pub fn run(content: Option<String>, tags: Vec<String>, ttl: Option<String>, priority: Option<String>, quiet: bool) -> Result<()> {
```

Add `use crate::notify;` to the imports at the top of the file (after the existing `use` statements).

Clone `tags` before they're moved into `IndexEntry`. Add `let notify_tags = tags.clone();` just before the `IndexEntry` construction (before line 55):

```rust
    let notify_tags = tags.clone();
    let entry = IndexEntry {
        id: id.clone(),
        created_at: msg.created_at,
        tags,
        ttl_seconds,
        expires_at,
        status: MessageStatus::Unread,
        content_preview: msg.preview(80),
    };
```

After `println!("Pushed: {id}");` (after line 75), add the notification call:

```rust
    // Send notification if configured and not suppressed
    if !quiet {
        let prio = priority.and_then(|p| notify::Priority::from_str(&p));
        notify::send(&ctx.config, &notify_tags, &ttl, prio);
    }
```

- [ ] **Step 4: Run all tests to verify**

Run: `cargo test`
Expected: All existing tests pass. The push tests use `run(content, tag, ttl)` which will need the new parameters — update any direct calls to `push::run` in tests to include `None` and `false` for priority and quiet. (Check: there are no direct unit tests for `push::run` — it's only called from `main.rs` and integration tests use the CLI binary, so no test changes needed.)

- [ ] **Step 5: Commit**

```bash
git add src/main.rs src/commands/push.rs
git commit -m "feat: add --priority and --quiet flags to nts push"
```

---

### Task 4: Create the `nts notify setup` command

**Files:**
- Create: `src/commands/notify_cmd.rs`
- Modify: `src/commands/mod.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: Create `src/commands/notify_cmd.rs`**

```rust
use crate::commands::get_data_dir;
use crate::config::{Config, NotifyConfig, NtfyConfig};
use anyhow::Result;
use rand::Rng;

pub fn run_setup() -> Result<()> {
    let data_dir = get_data_dir()?;
    let config_path = data_dir.join("config.toml");

    let mut config = if config_path.exists() {
        Config::load(&config_path)?
    } else {
        Config::default_with_path(&data_dir)
    };

    // Check if already configured
    if let Some(notify) = &config.notify {
        if let Some(ntfy) = &notify.ntfy {
            if !ntfy.topic.is_empty() {
                println!("Notifications already configured (topic: {}).", ntfy.topic);
                println!("Use `nts config set notify.ntfy.<key> <value>` to change settings.");
                return Ok(());
            }
        }
    }

    // Generate random topic name
    let mut rng = rand::rng();
    let suffix: u32 = rng.random_range(0..0xFFFFFFFF);
    let topic = format!("nts-{suffix:08x}");

    // Save config
    config.notify = Some(NotifyConfig {
        enabled: true,
        backend: "ntfy".to_string(),
        ntfy: Some(NtfyConfig {
            server: "https://ntfy.sh".to_string(),
            topic: topic.clone(),
            token: None,
        }),
    });
    config.save(&config_path)?;

    println!("Notification topic: {topic}");
    println!();
    println!("Setup:");
    println!("  1. Install the ntfy app on your phone (ntfy.sh)");
    println!("  2. Subscribe to topic: {topic}");
    println!("  3. That's it! You'll get notified on every `nts push`");
    println!();

    // Send test notification
    let ntfy = config.notify.as_ref().unwrap().ntfy.as_ref().unwrap();
    let url = format!("{}/{}", ntfy.server.trim_end_matches('/'), ntfy.topic);
    match ureq::post(&url)
        .header("X-Title", "Note to Self")
        .header("X-Priority", "3")
        .timeout(std::time::Duration::from_secs(5))
        .send_string("nts connected!")
    {
        Ok(_) => println!("Test notification sent! Check your phone."),
        Err(_) => println!("Could not send test notification — check your internet connection."),
    }

    println!();
    println!("To add an access token for a private topic:");
    println!("  nts config set notify.ntfy.token tk_...");
    println!();
    println!("To disable notifications:");
    println!("  nts config set notify.enabled false");

    Ok(())
}
```

- [ ] **Step 2: Add `pub mod notify_cmd;` to commands/mod.rs**

In `src/commands/mod.rs`, add `pub mod notify_cmd;` to the module list (alphabetically, after `pub mod list;`):

```rust
pub mod notify_cmd;
```

- [ ] **Step 3: Add Notify subcommand to main.rs**

In `src/main.rs`, add the `Notify` variant and `NotifyCommands` enum.

Add to the `Commands` enum, after `Sync`:

```rust
    /// Manage push notifications
    #[command(subcommand)]
    Notify(NotifyCommands),
```

Add the `NotifyCommands` enum after `ConfigCommands`:

```rust
#[derive(Subcommand)]
enum NotifyCommands {
    /// Set up push notifications via ntfy
    Setup,
}
```

Add the match arm in `fn main()`, after the `Commands::Sync` arm:

```rust
Commands::Notify(cmd) => match cmd {
    NotifyCommands::Setup => commands::notify_cmd::run_setup(),
},
```

- [ ] **Step 4: Run all tests**

Run: `cargo test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/commands/notify_cmd.rs src/commands/mod.rs src/main.rs
git commit -m "feat: add nts notify setup command"
```

---

## Chunk 3: Integration Tests and Documentation

### Task 5: Fix token masking and add integration tests

**Files:**
- Modify: `src/commands/config_cmd.rs`
- Modify: `tests/integration.rs`

- [ ] **Step 1: Update secret masking in config_cmd.rs**

The current masking logic in `config_cmd.rs` only checks `key.contains("secret") || key.contains("key")`. The key `notify.ntfy.token` contains neither, so tokens won't be masked. Fix both the `run_get` and `run_set` functions.

In `run_get()`, change:
```rust
let display = if key.contains("secret") || key.contains("key") {
```
to:
```rust
let display = if key.contains("secret") || key.contains("key") || key.contains("token") {
```

In `run_set()`, change:
```rust
let display = if key.contains("secret") || key.contains("key") {
```
to:
```rust
let display = if key.contains("secret") || key.contains("key") || key.contains("token") {
```

- [ ] **Step 2: Add integration tests**

Add at the end of `tests/integration.rs`:

```rust
#[test]
fn test_notify_setup_creates_config() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .args(["notify", "setup"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Notification topic: nts-"))
        .stdout(predicate::str::contains("Subscribe to topic:"));

    // Verify config was written
    let config_content = std::fs::read_to_string(tmp.path().join("config.toml")).unwrap();
    assert!(config_content.contains("[notify]"));
    assert!(config_content.contains("enabled = true"));
    assert!(config_content.contains("nts-"));
}

#[test]
fn test_notify_setup_idempotent() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    // First setup
    nts(&tmp)
        .args(["notify", "setup"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Notification topic:"));

    // Second setup should warn
    nts(&tmp)
        .args(["notify", "setup"])
        .assert()
        .success()
        .stdout(predicate::str::contains("already configured"));
}

#[test]
fn test_push_with_quiet_flag() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .args(["push", "test message", "--quiet"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Pushed:"));
}

#[test]
fn test_push_with_priority_flag() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .args(["push", "urgent message", "--priority", "high"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Pushed:"));
}

#[test]
fn test_config_get_set_notify() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .args(["config", "set", "notify.ntfy.topic", "my-custom-topic"])
        .assert()
        .success();

    nts(&tmp)
        .args(["config", "get", "notify.ntfy.topic"])
        .assert()
        .success()
        .stdout(predicate::str::contains("my-custom-topic"));
}

#[test]
fn test_config_get_notify_token_masked() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .args(["config", "set", "notify.ntfy.token", "tk_longsecrettoken123"])
        .assert()
        .success();

    nts(&tmp)
        .args(["config", "get", "notify.ntfy.token"])
        .assert()
        .success()
        .stdout(predicate::str::contains("tk_l...n123"));
}
```

- [ ] **Step 2: Run integration tests**

Run: `cargo test --test integration`
Expected: All integration tests pass (previous 14 + new 6 = 20 total).

Note: The `test_notify_setup_creates_config` test may show a warning about the test notification failing (no internet in test env) — this is expected and fine, the command still succeeds.

- [ ] **Step 3: Run full test suite**

Run: `cargo test`
Expected: All tests pass (unit + integration).

- [ ] **Step 4: Commit**

```bash
git add src/commands/config_cmd.rs tests/integration.rs
git commit -m "fix: token masking in config_cmd + integration tests for M3"
```

---

### Task 6: Update documentation

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Check off M3 items in roadmap.md**

In `docs/roadmap.md`, update the M3 section to check off completed items:

```markdown
## Milestone 3: Push Notifications (ntfy)
**Goal**: Phone gets notified when new message is pushed.

- [x] ntfy.sh integration (send notification after push)
- [x] `nts config set ntfy.topic <topic>`
- [x] Private topic with access token auth
- [x] Priority levels mapped to message urgency
- [ ] Optional: self-hosted ntfy Docker compose
```

Note: The Docker compose item stays unchecked — it's explicitly out of M3 scope (users can self-host by pointing the server URL at their instance).

- [ ] **Step 2: Update CLAUDE.md project structure**

In `CLAUDE.md`, update the project structure to include the new files. Add `notify.rs` to the `src/` section and `notify_cmd.rs` to `commands/`:

Under `src/`:
```
│   ├── notify.rs          # ntfy notification logic (body, priority, HTTP POST)
```

Under `commands/`:
```
│   │   ├── notify_cmd.rs  # nts notify setup
```

Update the test count to reflect the new tests.

- [ ] **Step 3: Commit**

```bash
git add docs/roadmap.md CLAUDE.md
git commit -m "docs: update roadmap and project structure for M3"
```
