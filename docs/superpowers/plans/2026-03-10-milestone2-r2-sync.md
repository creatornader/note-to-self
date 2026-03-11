# Milestone 2: R2 Cloud Sync — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cross-device sync via Cloudflare R2 with offline fallback, merge-on-read, optimistic locking, and device bootstrapping.

**Architecture:** Every CLI operation follows pull-operate-push. A pure merge function reconciles local and remote indexes by message ID, advancing status forward. Offline changes are tracked in `sync_state.json` and reconciled on next successful sync. ETags prevent concurrent overwrites.

**Tech Stack:** Rust, `rust-s3` (S3-compatible client), `tokio` (async runtime for R2), `rpassword` (passphrase prompts), `age` (encryption for export bundles)

**Spec:** `docs/superpowers/specs/2026-03-10-milestone2-r2-sync-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `Cargo.toml` | Modify | Add `rust-s3`, `tokio`, `http`, `rpassword` dependencies |
| `src/config.rs` | Modify | Add `R2Config` struct, `get`/`set` helpers, secret masking |
| `src/index.rs` | Modify | Add `MessageStatus::ordinal()` for status comparison |
| `src/merge.rs` | Create | Pure merge function: `merge(local, remote, pending_ids, pending_deletes) -> Index` |
| `src/sync_state.rs` | Create | Load/save `sync_state.json`, add/remove pending IDs |
| `src/storage/r2.rs` | Create | `R2Storage` implementing `Storage` trait, ETag tracking |
| `src/storage/mod.rs` | Modify | Add `r2` module, ETag-aware methods on trait |
| `src/sync.rs` | Create | Pull/push orchestration, ETag retry logic |
| `src/commands/mod.rs` | Modify | `load_context()` gains sync behavior, new module declarations |
| `src/commands/config_cmd.rs` | Create | `nts config get/set` |
| `src/commands/sync_cmd.rs` | Create | `nts sync` |
| `src/commands/status.rs` | Create | `nts status` |
| `src/commands/export.rs` | Create | `nts export [--passphrase]` |
| `src/commands/import.rs` | Create | `nts import <file> [--passphrase]` |
| `src/main.rs` | Modify | Add Config, Sync, Status, Export, Import subcommands |
| `tests/integration.rs` | Modify | Add local-backend sync/config/status/export/import tests |

---

## Chunk 1: Foundation (merge, sync_state, config)

### Task 1: Add New Dependencies

**Files:**
- Modify: `Cargo.toml`

- [ ] **Step 1: Add dependencies to Cargo.toml**

Add under `[dependencies]`:

```toml
rust-s3 = { version = "0.35", default-features = false, features = ["tokio-rustls-tls"] }
tokio = { version = "1", features = ["rt", "macros"] }
http = "1"
rpassword = "7"
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check`
Expected: Compiles successfully (new deps downloaded, no errors)

- [ ] **Step 3: Commit**

```bash
git add Cargo.toml Cargo.lock
git commit -m "deps: add rust-s3, tokio, http, rpassword for M2 sync"
```

---

### Task 2: Add Status Ordinal to MessageStatus

**Files:**
- Modify: `src/index.rs`

- [ ] **Step 1: Write the failing test**

Add to `src/index.rs` in the `#[cfg(test)] mod tests` block:

```rust
#[test]
fn test_status_ordinal() {
    assert!(MessageStatus::Unread.ordinal() < MessageStatus::Read.ordinal());
    assert!(MessageStatus::Read.ordinal() < MessageStatus::Consumed.ordinal());
    assert!(MessageStatus::Consumed.ordinal() < MessageStatus::Expired.ordinal());
}

#[test]
fn test_status_max() {
    assert_eq!(
        MessageStatus::Unread.max_status(MessageStatus::Read),
        MessageStatus::Read
    );
    assert_eq!(
        MessageStatus::Consumed.max_status(MessageStatus::Read),
        MessageStatus::Consumed
    );
    assert_eq!(
        MessageStatus::Expired.max_status(MessageStatus::Expired),
        MessageStatus::Expired
    );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --lib index::tests::test_status_ordinal`
Expected: FAIL — `ordinal` method not defined

- [ ] **Step 3: Implement ordinal and max_status on MessageStatus**

Add to `MessageStatus` impl block in `src/index.rs`:

```rust
impl MessageStatus {
    pub fn ordinal(&self) -> u8 {
        match self {
            Self::Unread => 0,
            Self::Read => 1,
            Self::Consumed => 2,
            Self::Expired => 3,
        }
    }

    pub fn max_status(self, other: Self) -> Self {
        if self.ordinal() >= other.ordinal() {
            self
        } else {
            other
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --lib index::tests`
Expected: All index tests pass including the two new ones

- [ ] **Step 5: Commit**

```bash
git add src/index.rs
git commit -m "feat: add status ordinal and max_status for merge comparison"
```

---

### Task 3: Merge Algorithm (Pure Function)

**Files:**
- Create: `src/merge.rs`
- Modify: `src/main.rs` (add `mod merge;`)

This is the core of M2. The merge function is pure — no I/O, no side effects. It takes two indexes and two sets of pending IDs, and returns a merged index.

- [ ] **Step 1: Write the failing tests**

Create `src/merge.rs` with tests only:

```rust
use crate::index::{Index, IndexEntry, MessageStatus};
use std::collections::HashSet;

pub fn merge(
    local: &Index,
    remote: &Index,
    pending_ids: &HashSet<String>,
    pending_deletes: &HashSet<String>,
) -> Index {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn entry(id: &str, status: MessageStatus) -> IndexEntry {
        IndexEntry {
            id: id.to_string(),
            created_at: Utc::now(),
            tags: vec![],
            ttl_seconds: None,
            expires_at: None,
            status,
            content_preview: format!("msg {id}"),
        }
    }

    #[test]
    fn test_merge_both_present_takes_later_status() {
        let mut local = Index::new();
        local.add_entry(entry("a", MessageStatus::Unread));

        let mut remote = Index::new();
        remote.add_entry(entry("a", MessageStatus::Read));

        let merged = merge(&local, &remote, &HashSet::new(), &HashSet::new());
        assert_eq!(merged.find_by_id("a").unwrap().status, MessageStatus::Read);
    }

    #[test]
    fn test_merge_remote_only_added_locally() {
        let local = Index::new();
        let mut remote = Index::new();
        remote.add_entry(entry("b", MessageStatus::Unread));

        let merged = merge(&local, &remote, &HashSet::new(), &HashSet::new());
        assert!(merged.find_by_id("b").is_some());
    }

    #[test]
    fn test_merge_remote_only_but_pending_delete_skipped() {
        let local = Index::new();
        let mut remote = Index::new();
        remote.add_entry(entry("c", MessageStatus::Unread));

        let pending_deletes: HashSet<String> = ["c".to_string()].into();
        let merged = merge(&local, &remote, &HashSet::new(), &pending_deletes);
        assert!(merged.find_by_id("c").is_none());
    }

    #[test]
    fn test_merge_local_only_pending_kept() {
        let mut local = Index::new();
        local.add_entry(entry("d", MessageStatus::Unread));

        let remote = Index::new();
        let pending_ids: HashSet<String> = ["d".to_string()].into();

        let merged = merge(&local, &remote, &pending_ids, &HashSet::new());
        assert!(merged.find_by_id("d").is_some());
    }

    #[test]
    fn test_merge_local_only_not_pending_removed() {
        let mut local = Index::new();
        local.add_entry(entry("e", MessageStatus::Unread));

        let remote = Index::new();

        let merged = merge(&local, &remote, &HashSet::new(), &HashSet::new());
        assert!(merged.find_by_id("e").is_none());
    }

    #[test]
    fn test_merge_union_of_disjoint() {
        let mut local = Index::new();
        local.add_entry(entry("x", MessageStatus::Unread));

        let mut remote = Index::new();
        remote.add_entry(entry("y", MessageStatus::Unread));

        let pending_ids: HashSet<String> = ["x".to_string()].into();
        let merged = merge(&local, &remote, &pending_ids, &HashSet::new());

        assert!(merged.find_by_id("x").is_some());
        assert!(merged.find_by_id("y").is_some());
        assert_eq!(merged.messages.len(), 2);
    }

    #[test]
    fn test_merge_empty_indexes() {
        let merged = merge(
            &Index::new(),
            &Index::new(),
            &HashSet::new(),
            &HashSet::new(),
        );
        assert!(merged.messages.is_empty());
    }

    #[test]
    fn test_merge_status_never_moves_backward() {
        let mut local = Index::new();
        local.add_entry(entry("f", MessageStatus::Consumed));

        let mut remote = Index::new();
        remote.add_entry(entry("f", MessageStatus::Unread));

        let merged = merge(&local, &remote, &HashSet::new(), &HashSet::new());
        assert_eq!(
            merged.find_by_id("f").unwrap().status,
            MessageStatus::Consumed
        );
    }
}
```

- [ ] **Step 2: Add mod declaration**

Add `mod merge;` to `src/main.rs` after the existing module declarations.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test --lib merge::tests`
Expected: FAIL — all tests panic with `todo!()`

- [ ] **Step 4: Implement the merge function**

Replace the `todo!()` body in `src/merge.rs`:

```rust
pub fn merge(
    local: &Index,
    remote: &Index,
    pending_ids: &HashSet<String>,
    pending_deletes: &HashSet<String>,
) -> Index {
    let mut merged = Index::new();
    let mut seen: HashSet<&str> = HashSet::new();

    // Process all local entries
    for entry in &local.messages {
        seen.insert(&entry.id);

        if let Some(remote_entry) = remote.find_by_id(&entry.id) {
            // Both present: take the one with the later status
            let winner_status = entry.status.max_status(remote_entry.status);
            let mut winner = entry.clone();
            winner.status = winner_status;
            merged.add_entry(winner);
        } else if pending_ids.contains(&entry.id) {
            // Local only + pending sync: keep it
            merged.add_entry(entry.clone());
        }
        // Local only + not pending: removed on another device, drop it
    }

    // Process remote-only entries
    for entry in &remote.messages {
        if seen.contains(entry.id.as_str()) {
            continue;
        }

        if pending_deletes.contains(&entry.id) {
            // Deleted locally, don't re-add
            continue;
        }

        // New from remote: add to local
        merged.add_entry(entry.clone());
    }

    merged
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --lib merge::tests`
Expected: All 8 merge tests pass

- [ ] **Step 6: Run full test suite for regressions**

Run: `cargo test`
Expected: All existing tests still pass

- [ ] **Step 7: Commit**

```bash
git add src/merge.rs src/main.rs
git commit -m "feat: pure merge algorithm for index reconciliation"
```

---

### Task 4: Sync State Module

**Files:**
- Create: `src/sync_state.rs`
- Modify: `src/main.rs` (add `mod sync_state;`)

- [ ] **Step 1: Write the failing tests**

Create `src/sync_state.rs`:

```rust
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncState {
    pub pending_ids: HashSet<String>,
    pub pending_deletes: HashSet<String>,
    pub last_sync: Option<DateTime<Utc>>,
    pub remote_etag: Option<String>,
}

impl SyncState {
    pub fn new() -> Self {
        todo!()
    }

    pub fn load(data_dir: &Path) -> Result<Self> {
        todo!()
    }

    pub fn save(&self, data_dir: &Path) -> Result<()> {
        todo!()
    }

    pub fn file_path(data_dir: &Path) -> PathBuf {
        data_dir.join("sync_state.json")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_new_sync_state() {
        let state = SyncState::new();
        assert!(state.pending_ids.is_empty());
        assert!(state.pending_deletes.is_empty());
        assert!(state.last_sync.is_none());
        assert!(state.remote_etag.is_none());
    }

    #[test]
    fn test_save_and_load_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let mut state = SyncState::new();
        state.pending_ids.insert("abc".to_string());
        state.pending_deletes.insert("def".to_string());
        state.last_sync = Some(Utc::now());
        state.remote_etag = Some("\"etag123\"".to_string());

        state.save(tmp.path()).unwrap();
        let loaded = SyncState::load(tmp.path()).unwrap();

        assert_eq!(loaded.pending_ids.len(), 1);
        assert!(loaded.pending_ids.contains("abc"));
        assert!(loaded.pending_deletes.contains("def"));
        assert!(loaded.last_sync.is_some());
        assert_eq!(loaded.remote_etag.unwrap(), "\"etag123\"");
    }

    #[test]
    fn test_load_missing_file_returns_default() {
        let tmp = TempDir::new().unwrap();
        let state = SyncState::load(tmp.path()).unwrap();
        assert!(state.pending_ids.is_empty());
    }
}
```

- [ ] **Step 2: Add mod declaration**

Add `mod sync_state;` to `src/main.rs`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test --lib sync_state::tests`
Expected: FAIL — `todo!()`

- [ ] **Step 4: Implement SyncState methods**

Replace the `todo!()` bodies:

```rust
impl SyncState {
    pub fn new() -> Self {
        Self {
            pending_ids: HashSet::new(),
            pending_deletes: HashSet::new(),
            last_sync: None,
            remote_etag: None,
        }
    }

    pub fn load(data_dir: &Path) -> Result<Self> {
        let path = Self::file_path(data_dir);
        if !path.exists() {
            return Ok(Self::new());
        }
        let content = std::fs::read_to_string(&path)
            .with_context(|| format!("Failed to read sync state: {}", path.display()))?;
        serde_json::from_str(&content).context("Failed to parse sync state")
    }

    pub fn save(&self, data_dir: &Path) -> Result<()> {
        let path = Self::file_path(data_dir);
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, content)
            .with_context(|| format!("Failed to write sync state: {}", path.display()))
    }

    pub fn file_path(data_dir: &Path) -> PathBuf {
        data_dir.join("sync_state.json")
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --lib sync_state::tests`
Expected: All 3 sync_state tests pass

- [ ] **Step 6: Commit**

```bash
git add src/sync_state.rs src/main.rs
git commit -m "feat: sync_state module for tracking pending sync operations"
```

---

### Task 5: Extend Config for R2

**Files:**
- Modify: `src/config.rs`

- [ ] **Step 1: Write the failing tests**

Add to `src/config.rs` test module:

```rust
#[test]
fn test_config_with_r2() {
    let tmp = TempDir::new().unwrap();
    let mut cfg = Config::default_with_path(tmp.path());
    cfg.storage.backend = "r2".to_string();
    cfg.storage.r2 = Some(R2Config {
        bucket: "nts-messages".to_string(),
        endpoint: "https://example.r2.cloudflarestorage.com".to_string(),
        access_key_id: "AKID".to_string(),
        secret_access_key: "SECRET".to_string(),
    });

    let path = tmp.path().join("config.toml");
    cfg.save(&path).unwrap();
    let loaded = Config::load(&path).unwrap();

    assert_eq!(loaded.storage.backend, "r2");
    let r2 = loaded.storage.r2.unwrap();
    assert_eq!(r2.bucket, "nts-messages");
    assert_eq!(r2.access_key_id, "AKID");
}

#[test]
fn test_config_get_dotted_key() {
    let mut cfg = Config::default_with_path(Path::new("/tmp"));
    cfg.storage.r2 = Some(R2Config {
        bucket: "test-bucket".to_string(),
        endpoint: "https://example.com".to_string(),
        access_key_id: "AK".to_string(),
        secret_access_key: "SK".to_string(),
    });

    assert_eq!(cfg.get("storage.backend").unwrap(), "local");
    assert_eq!(cfg.get("storage.r2.bucket").unwrap(), "test-bucket");
    assert!(cfg.get("nonexistent").is_none());
}

#[test]
fn test_config_set_dotted_key() {
    let mut cfg = Config::default_with_path(Path::new("/tmp"));
    cfg.set("storage.backend", "r2").unwrap();
    assert_eq!(cfg.storage.backend, "r2");

    cfg.set("storage.r2.bucket", "my-bucket").unwrap();
    assert_eq!(cfg.storage.r2.as_ref().unwrap().bucket, "my-bucket");
}

#[test]
fn test_config_mask_secrets() {
    let cfg_val = "my-secret-access-key-12345";
    assert_eq!(Config::mask_secret(cfg_val), "my-s...2345");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib config::tests`
Expected: FAIL — `R2Config`, `get`, `set`, `mask_secret` not defined

- [ ] **Step 3: Add R2Config struct and extend StorageConfig**

Update `src/config.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct R2Config {
    pub bucket: String,
    pub endpoint: String,
    pub access_key_id: String,
    pub secret_access_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    pub backend: String,
    pub path: String,
    pub r2: Option<R2Config>,
}
```

Update `default_with_path` to include `r2: None`.

- [ ] **Step 4: Add get/set/mask_secret methods to Config**

```rust
impl Config {
    pub fn get(&self, key: &str) -> Option<String> {
        match key {
            "storage.backend" => Some(self.storage.backend.clone()),
            "storage.path" => Some(self.storage.path.clone()),
            "storage.r2.bucket" => self.storage.r2.as_ref().map(|r| r.bucket.clone()),
            "storage.r2.endpoint" => self.storage.r2.as_ref().map(|r| r.endpoint.clone()),
            "storage.r2.access_key_id" => {
                self.storage.r2.as_ref().map(|r| r.access_key_id.clone())
            }
            "storage.r2.secret_access_key" => {
                self.storage.r2.as_ref().map(|r| r.secret_access_key.clone())
            }
            _ => None,
        }
    }

    pub fn set(&mut self, key: &str, value: &str) -> Result<()> {
        match key {
            "storage.backend" => self.storage.backend = value.to_string(),
            "storage.path" => self.storage.path = value.to_string(),
            k if k.starts_with("storage.r2.") => {
                let r2 = self.storage.r2.get_or_insert(R2Config {
                    bucket: String::new(),
                    endpoint: String::new(),
                    access_key_id: String::new(),
                    secret_access_key: String::new(),
                });
                match k {
                    "storage.r2.bucket" => r2.bucket = value.to_string(),
                    "storage.r2.endpoint" => r2.endpoint = value.to_string(),
                    "storage.r2.access_key_id" => r2.access_key_id = value.to_string(),
                    "storage.r2.secret_access_key" => r2.secret_access_key = value.to_string(),
                    _ => anyhow::bail!("Unknown config key: {k}"),
                }
            }
            _ => anyhow::bail!("Unknown config key: {key}"),
        }
        Ok(())
    }

    pub fn mask_secret(value: &str) -> String {
        if value.len() <= 8 {
            return "****".to_string();
        }
        format!("{}...{}", &value[..4], &value[value.len() - 4..])
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --lib config::tests`
Expected: All config tests pass (old + 4 new)

- [ ] **Step 6: Run full test suite**

Run: `cargo test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/config.rs
git commit -m "feat: extend config with R2 settings, get/set helpers, secret masking"
```

---

## Chunk 2: R2 Storage Backend

### Task 6: R2 Storage Implementation

**Files:**
- Create: `src/storage/r2.rs`
- Modify: `src/storage/mod.rs`

The R2 storage backend wraps the `rust-s3` crate. It uses `tokio::runtime::Runtime::block_on()` to keep the `Storage` trait synchronous. It also tracks ETags for optimistic locking.

- [ ] **Step 1: Update Storage trait with ETag support**

Modify `src/storage/mod.rs` to add an optional ETag-aware read method with a default implementation:

```rust
pub mod local;
pub mod r2;

use anyhow::Result;

pub trait Storage {
    fn read_blob(&self, key: &str) -> Result<Vec<u8>>;
    fn write_blob(&self, key: &str, data: &[u8]) -> Result<()>;
    fn delete_blob(&self, key: &str) -> Result<()>;
    fn blob_exists(&self, key: &str) -> bool;
    fn list_blobs(&self, prefix: &str) -> Result<Vec<String>>;

    /// Read a blob and return its ETag (for optimistic locking).
    /// Default: returns None for ETag (local storage doesn't use ETags).
    fn read_blob_with_etag(&self, key: &str) -> Result<(Vec<u8>, Option<String>)> {
        let data = self.read_blob(key)?;
        Ok((data, None))
    }

    /// Write a blob with an ETag precondition (optimistic locking).
    /// `expected_etag`: if Some, only write if current ETag matches.
    /// `if_none_match`: if true, only write if the key doesn't exist.
    /// Default: ignores ETags and writes unconditionally.
    fn write_blob_conditional(
        &self,
        key: &str,
        data: &[u8],
        _expected_etag: Option<&str>,
        _if_none_match: bool,
    ) -> Result<WriteResult> {
        self.write_blob(key, data)?;
        Ok(WriteResult::Success { etag: None })
    }
}

#[derive(Debug)]
pub enum WriteResult {
    Success { etag: Option<String> },
    PreconditionFailed,
}
```

- [ ] **Step 2: Verify existing code still compiles**

Run: `cargo check`
Expected: Compiles — default trait methods don't break `LocalStorage`

- [ ] **Step 3: Create R2Storage skeleton**

Create `src/storage/r2.rs`:

```rust
use super::{Storage, WriteResult};
use anyhow::{Context, Result};
use http::header::{HeaderMap, HeaderName, IF_MATCH, IF_NONE_MATCH};
use s3::creds::Credentials;
use s3::region::Region;
use s3::Bucket;
use tokio::runtime::Runtime;

pub struct R2Storage {
    bucket: Box<Bucket>,
    runtime: Runtime,
}

impl R2Storage {
    pub fn new(
        bucket_name: &str,
        endpoint: &str,
        access_key_id: &str,
        secret_access_key: &str,
    ) -> Result<Self> {
        let region = Region::Custom {
            region: "auto".to_string(),
            endpoint: endpoint.to_string(),
        };
        let credentials = Credentials::new(
            Some(access_key_id),
            Some(secret_access_key),
            None,
            None,
            None,
        )
        .context("Failed to create R2 credentials")?;

        let bucket = Bucket::new(bucket_name, region, credentials)
            .context("Failed to create R2 bucket client")?
            .with_path_style();

        let runtime =
            Runtime::new().context("Failed to create tokio runtime")?;

        Ok(Self { bucket, runtime })
    }
}

impl Storage for R2Storage {
    fn read_blob(&self, key: &str) -> Result<Vec<u8>> {
        let response = self
            .runtime
            .block_on(self.bucket.get_object(key))
            .with_context(|| format!("R2: failed to read {key}"))?;
        Ok(response.bytes().to_vec())
    }

    fn read_blob_with_etag(&self, key: &str) -> Result<(Vec<u8>, Option<String>)> {
        let response = self
            .runtime
            .block_on(self.bucket.get_object(key))
            .with_context(|| format!("R2: failed to read {key}"))?;
        let etag = response
            .headers()
            .get("etag")
            .cloned();
        Ok((response.bytes().to_vec(), etag))
    }

    fn write_blob(&self, key: &str, data: &[u8]) -> Result<()> {
        self.runtime
            .block_on(self.bucket.put_object(key, data))
            .with_context(|| format!("R2: failed to write {key}"))?;
        Ok(())
    }

    fn write_blob_conditional(
        &self,
        key: &str,
        data: &[u8],
        expected_etag: Option<&str>,
        if_none_match: bool,
    ) -> Result<WriteResult> {
        // Build custom headers for conditional write using http crate
        let mut custom_headers = HeaderMap::new();
        if let Some(etag) = expected_etag {
            custom_headers.insert(
                IF_MATCH,
                etag.parse().context("Invalid ETag header value")?,
            );
        }
        if if_none_match {
            custom_headers.insert(
                IF_NONE_MATCH,
                "*".parse().unwrap(),
            );
        }

        // Create a bucket clone with extra headers for this request
        let bucket_with_headers = self
            .bucket
            .with_extra_headers(custom_headers)
            .context("Failed to set conditional headers")?;

        let result = self
            .runtime
            .block_on(bucket_with_headers.put_object(key, data));

        match result {
            Ok(_) => Ok(WriteResult::Success {
                etag: None, // We'll get the new ETag on next read
            }),
            Err(e) => {
                let err_str = e.to_string();
                if err_str.contains("412") || err_str.contains("PreconditionFailed") {
                    Ok(WriteResult::PreconditionFailed)
                } else {
                    Err(e).with_context(|| format!("R2: failed to write {key}"))
                }
            }
        }
    }

    fn delete_blob(&self, key: &str) -> Result<()> {
        self.runtime
            .block_on(self.bucket.delete_object(key))
            .with_context(|| format!("R2: failed to delete {key}"))?;
        Ok(())
    }

    fn blob_exists(&self, key: &str) -> bool {
        self.runtime
            .block_on(self.bucket.head_object(key))
            .is_ok()
    }

    fn list_blobs(&self, prefix: &str) -> Result<Vec<String>> {
        let results = self
            .runtime
            .block_on(self.bucket.list(prefix.to_string(), None))
            .with_context(|| format!("R2: failed to list {prefix}"))?;

        let mut keys = Vec::new();
        for result in results {
            for object in result.contents {
                keys.push(object.key);
            }
        }
        keys.sort();
        Ok(keys)
    }
}
```

> **Note:** The `rust-s3` 0.35 API may differ slightly from what's shown here. During implementation, verify:
> - `Bucket::new()` return type (may return `Box<Bucket>` directly)
> - `ResponseData` method names (`bytes()` vs `to_vec()`)
> - `headers()` return type (`HashMap<String, String>` vs `HeaderMap`)
> - `with_extra_headers()` signature and availability
>
> If any API differs, adjust accordingly — the pattern stays the same.

- [ ] **Step 4: Verify it compiles**

Run: `cargo check`
Expected: Compiles (can't run tests without real R2, but it type-checks)

- [ ] **Step 5: Commit**

```bash
git add src/storage/mod.rs src/storage/r2.rs
git commit -m "feat: R2 storage backend with ETag support for optimistic locking"
```

---

## Chunk 3: Sync Orchestration

### Task 7: Sync Module (Pull/Push/Retry)

**Files:**
- Create: `src/sync.rs`
- Modify: `src/main.rs` (add `mod sync;`)

The sync module orchestrates pull-merge-push. It reads from R2, merges with local, and pushes back with ETag checks. Retry logic handles concurrent writes.

- [ ] **Step 1: Write sync module with pull/push functions**

Create `src/sync.rs`:

```rust
use crate::config::Config;
use crate::crypto;
use crate::index::Index;
use crate::merge;
use crate::storage::r2::R2Storage;
use crate::storage::{Storage, WriteResult};
use crate::sync_state::SyncState;
use anyhow::{Context, Result};
use std::path::Path;

const MAX_ETAG_RETRIES: u32 = 3;

/// Result of a sync pull operation.
pub struct PullResult {
    pub merged_index: Index,
    pub sync_state: SyncState,
    pub was_online: bool,
}

/// Pull remote index, merge with local, return merged result.
/// Does NOT save anything — caller decides what to persist.
pub fn pull(
    local_index: &Index,
    config: &Config,
    sync_state: &SyncState,
    identity: &age::x25519::Identity,
) -> PullResult {
    let r2 = match create_r2_storage(config) {
        Ok(r2) => r2,
        Err(e) => {
            eprintln!("Offline — working from local cache ({e:#})");
            return PullResult {
                merged_index: local_index.clone(),
                sync_state: sync_state.clone(),
                was_online: false,
            };
        }
    };

    match r2.read_blob_with_etag("index.age") {
        Ok((encrypted_index, etag)) => {
            match crypto::decrypt(&encrypted_index, identity) {
                Ok(decrypted) => {
                    match serde_json::from_slice::<Index>(&decrypted) {
                        Ok(remote_index) => {
                            let merged = merge::merge(
                                local_index,
                                &remote_index,
                                &sync_state.pending_ids,
                                &sync_state.pending_deletes,
                            );
                            let mut new_state = sync_state.clone();
                            new_state.remote_etag = etag;
                            new_state.last_sync = Some(chrono::Utc::now());
                            PullResult {
                                merged_index: merged,
                                sync_state: new_state,
                                was_online: true,
                            }
                        }
                        Err(e) => {
                            eprintln!("Remote index unreadable — working from local cache. Run `nts sync` to retry ({e})");
                            PullResult {
                                merged_index: local_index.clone(),
                                sync_state: sync_state.clone(),
                                was_online: false,
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Remote index unreadable — working from local cache. Run `nts sync` to retry ({e})");
                    PullResult {
                        merged_index: local_index.clone(),
                        sync_state: sync_state.clone(),
                        was_online: false,
                    }
                }
            }
        }
        Err(_) => {
            // No remote index yet — first sync from this device
            PullResult {
                merged_index: local_index.clone(),
                sync_state: sync_state.clone(),
                was_online: true,
            }
        }
    }
}

/// Push the updated index to R2 with ETag-based optimistic locking.
/// Retries up to MAX_ETAG_RETRIES times on precondition failure.
/// Returns the updated sync state.
pub fn push_index(
    index: &Index,
    config: &Config,
    sync_state: &mut SyncState,
    identity: &age::x25519::Identity,
    recipient: &age::x25519::Recipient,
) -> Result<bool> {
    let r2 = match create_r2_storage(config) {
        Ok(r2) => r2,
        Err(e) => {
            eprintln!("Offline — changes saved locally ({e:#})");
            return Ok(false);
        }
    };

    let json = serde_json::to_string_pretty(index)?;
    let encrypted = crypto::encrypt(json.as_bytes(), recipient)?;

    for attempt in 0..MAX_ETAG_RETRIES {
        let result = r2.write_blob_conditional(
            "index.age",
            &encrypted,
            sync_state.remote_etag.as_deref(),
            sync_state.remote_etag.is_none(),
        )?;

        match result {
            WriteResult::Success { etag } => {
                if let Some(new_etag) = etag {
                    sync_state.remote_etag = Some(new_etag);
                }
                sync_state.last_sync = Some(chrono::Utc::now());
                return Ok(true);
            }
            WriteResult::PreconditionFailed => {
                if attempt + 1 < MAX_ETAG_RETRIES {
                    eprintln!(
                        "Index was modified remotely — re-merging (attempt {}/{})",
                        attempt + 2,
                        MAX_ETAG_RETRIES
                    );
                    // Re-pull, re-merge, re-encrypt, and retry
                    let pull_result = pull(index, config, sync_state, identity);
                    sync_state.remote_etag = pull_result.sync_state.remote_etag.clone();

                    let new_json = serde_json::to_string_pretty(&pull_result.merged_index)?;
                    let new_encrypted = crypto::encrypt(new_json.as_bytes(), recipient)?;

                    let retry_result = r2.write_blob_conditional(
                        "index.age",
                        &new_encrypted,
                        sync_state.remote_etag.as_deref(),
                        false,
                    )?;

                    match retry_result {
                        WriteResult::Success { etag } => {
                            if let Some(new_etag) = etag {
                                sync_state.remote_etag = Some(new_etag);
                            }
                            sync_state.last_sync = Some(chrono::Utc::now());
                            return Ok(true);
                        }
                        WriteResult::PreconditionFailed => continue,
                    }
                }
            }
        }
    }

    eprintln!("Warning: Could not sync index after {MAX_ETAG_RETRIES} attempts — changes saved locally");
    Ok(false)
}

/// Upload a message blob to R2.
pub fn push_blob(key: &str, data: &[u8], config: &Config) -> Result<bool> {
    let r2 = match create_r2_storage(config) {
        Ok(r2) => r2,
        Err(_) => return Ok(false),
    };
    r2.write_blob(key, data)?;
    Ok(true)
}

/// Delete a message blob from R2.
pub fn delete_blob(key: &str, config: &Config) -> Result<bool> {
    let r2 = match create_r2_storage(config) {
        Ok(r2) => r2,
        Err(_) => return Ok(false),
    };
    r2.delete_blob(key)?;
    Ok(true)
}

/// Push all pending changes (called by `nts sync`).
pub fn push_pending(
    index: &Index,
    local_store: &dyn Storage,  // needed to read pending blobs
    config: &Config,
    sync_state: &mut SyncState,
    identity: &age::x25519::Identity,
    recipient: &age::x25519::Recipient,
) -> Result<()> {
    let r2 = match create_r2_storage(config) {
        Ok(r2) => r2,
        Err(e) => {
            anyhow::bail!("Cannot sync — R2 unreachable: {e:#}");
        }
    };

    // Upload pending message blobs
    let uploaded: Vec<String> = sync_state
        .pending_ids
        .iter()
        .filter_map(|id| {
            let blob_key = format!("messages/{id}.age");
            match local_store.read_blob(&blob_key) {
                Ok(data) => match r2.write_blob(&blob_key, &data) {
                    Ok(_) => Some(id.clone()),
                    Err(e) => {
                        eprintln!("Warning: failed to upload {blob_key}: {e}");
                        None
                    }
                },
                Err(_) => {
                    // Blob might have been deleted locally already
                    Some(id.clone())
                }
            }
        })
        .collect();

    for id in &uploaded {
        sync_state.pending_ids.remove(id);
    }

    // Delete pending remote blobs
    let deleted: Vec<String> = sync_state
        .pending_deletes
        .iter()
        .filter_map(|id| {
            let blob_key = format!("messages/{id}.age");
            match r2.delete_blob(&blob_key) {
                Ok(_) => Some(id.clone()),
                Err(e) => {
                    eprintln!("Warning: failed to delete remote {blob_key}: {e}");
                    None
                }
            }
        })
        .collect();

    for id in &deleted {
        sync_state.pending_deletes.remove(id);
    }

    // Push the index
    push_index(index, config, sync_state, identity, recipient)?;

    Ok(())
}

fn create_r2_storage(config: &Config) -> Result<R2Storage> {
    let r2_config = config
        .storage
        .r2
        .as_ref()
        .context("R2 not configured — run `nts config set storage.r2.bucket <bucket>` etc.")?;

    R2Storage::new(
        &r2_config.bucket,
        &r2_config.endpoint,
        &r2_config.access_key_id,
        &r2_config.secret_access_key,
    )
}

/// Check if sync is enabled (backend is "r2" and R2 config exists).
pub fn is_sync_enabled(config: &Config) -> bool {
    config.storage.backend == "r2" && config.storage.r2.is_some()
}
```

- [ ] **Step 2: Add mod declaration**

Add `mod sync;` to `src/main.rs`.

- [ ] **Step 3: Verify it compiles**

Run: `cargo check`
Expected: Compiles successfully

- [ ] **Step 4: Commit**

```bash
git add src/sync.rs src/main.rs
git commit -m "feat: sync orchestration with pull/push/retry and ETag locking"
```

---

## Chunk 4: Updated Commands + New CLI Commands

### Task 8: Update load_context with Sync Behavior

**Files:**
- Modify: `src/commands/mod.rs`

The key change: `load_context()` now loads config, checks if sync is enabled, and if so, performs a pull-merge before returning the index. It also returns the sync state and config so commands can push after mutations.

- [ ] **Step 1: Update load_context to support sync**

Replace `src/commands/mod.rs` with:

```rust
pub mod ack;
pub mod config_cmd;
pub mod delete;
pub mod export;
pub mod import;
pub mod init;
pub mod list;
pub mod peek;
pub mod pop;
pub mod purge;
pub mod push;
pub mod search;
pub mod show;
pub mod status;
pub mod sync_cmd;

use crate::config::Config;
use crate::crypto;
use crate::index::Index;
use crate::storage::local::LocalStorage;
use crate::storage::Storage;
use crate::sync;
use crate::sync_state::SyncState;
use anyhow::{Context, Result};
use std::path::PathBuf;

pub fn get_data_dir() -> Result<PathBuf> {
    if let Ok(home) = std::env::var("NTS_HOME") {
        return Ok(PathBuf::from(home));
    }
    let dirs = directories::ProjectDirs::from("", "", "nts")
        .context("Could not determine data directory")?;
    Ok(dirs.data_dir().to_path_buf())
}

pub struct AppContext {
    pub store: LocalStorage,
    pub index: Index,
    pub identity: age::x25519::Identity,
    pub recipient: age::x25519::Recipient,
    pub config: Config,
    pub sync_state: SyncState,
    pub data_dir: PathBuf,
}

pub fn load_context() -> Result<AppContext> {
    let data_dir = get_data_dir()?;
    let identity_path = data_dir.join("identity.txt");
    let recipients_path = data_dir.join("recipients.txt");
    let config_path = data_dir.join("config.toml");

    if !identity_path.exists() {
        anyhow::bail!("Not initialized. Run `nts init` first.");
    }

    let identity_str =
        std::fs::read_to_string(&identity_path).context("Failed to read identity file")?;
    let identity = crypto::parse_identity(identity_str.trim())?;

    let recipient_str =
        std::fs::read_to_string(&recipients_path).context("Failed to read recipients file")?;
    let recipient = crypto::parse_recipient(recipient_str.trim())?;

    let store = LocalStorage::new(&data_dir)?;

    let config = if config_path.exists() {
        Config::load(&config_path)?
    } else {
        Config::default_with_path(&data_dir)
    };

    let sync_state = SyncState::load(&data_dir)?;

    let mut index = if store.blob_exists("index.age") {
        let encrypted = store.read_blob("index.age")?;
        let decrypted = crypto::decrypt(&encrypted, &identity)?;
        serde_json::from_slice(&decrypted).context("Failed to parse index")?
    } else {
        Index::new()
    };

    // If sync is enabled, pull and merge
    let sync_state = if sync::is_sync_enabled(&config) {
        let pull_result = sync::pull(&index, &config, &sync_state, &identity);
        index = pull_result.merged_index;

        // Save merged index locally
        let _ = save_index(&store, &index, &recipient);
        let _ = pull_result.sync_state.save(&data_dir);

        pull_result.sync_state
    } else {
        sync_state
    };

    Ok(AppContext {
        store,
        index,
        identity,
        recipient,
        config,
        sync_state,
        data_dir,
    })
}

pub fn save_index(
    store: &dyn Storage,
    index: &Index,
    recipient: &age::x25519::Recipient,
) -> Result<()> {
    let json = serde_json::to_string_pretty(index)?;
    let encrypted = crypto::encrypt(json.as_bytes(), recipient)?;
    store.write_blob("index.age", &encrypted)
}

/// After mutating the index, save locally and push to R2 if sync is enabled.
pub fn save_and_sync(ctx: &mut AppContext) -> Result<()> {
    save_index(&ctx.store, &ctx.index, &ctx.recipient)?;

    if sync::is_sync_enabled(&ctx.config) {
        sync::push_index(
            &ctx.index,
            &ctx.config,
            &mut ctx.sync_state,
            &ctx.identity,
            &ctx.recipient,
        )?;
        ctx.sync_state.save(&ctx.data_dir)?;
    }

    Ok(())
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check`
Expected: Will fail — existing commands use the old `load_context` return type. That's expected; we'll update them next.

---

### Task 9: Update Existing Commands for New AppContext

**Files:**
- Modify: `src/commands/push.rs`
- Modify: `src/commands/peek.rs`
- Modify: `src/commands/pop.rs`
- Modify: `src/commands/list.rs`
- Modify: `src/commands/show.rs`
- Modify: `src/commands/ack.rs`
- Modify: `src/commands/delete.rs`
- Modify: `src/commands/purge.rs`
- Modify: `src/commands/search.rs`

Each command needs to switch from the old 4-tuple return to using `AppContext`, and mutation commands need to call `save_and_sync` instead of just `save_index`.

The pattern for each command:
- **Read-only commands** (`peek`, `list`, `show`, `search`): Change `let (store, mut index, identity, recipient) = commands::load_context()?` to `let mut ctx = commands::load_context()?`, access fields via `ctx.store`, `ctx.index`, etc. No push needed.
- **Status-mutation commands** (`pop`, `ack`): Same destructuring change + replace `commands::save_index(...)` with `commands::save_and_sync(&mut ctx)?`.
- **Write commands** (`push`): Same + also upload the new message blob to R2 and track in pending_ids if upload fails.
- **Delete commands** (`delete`, `purge`): Same + also delete blob from R2 and track in pending_deletes if delete fails.

- [ ] **Step 1: Update all 9 command files**

For each file, the changes follow a mechanical pattern. I'll show the key changes per file type:

**Read-only commands** (`peek.rs`, `list.rs`, `show.rs`, `search.rs`) — change the destructuring:
```rust
// OLD:
let (store, mut index, identity, recipient) = super::load_context()?;
// NEW:
let mut ctx = super::load_context()?;
// Then replace: store → ctx.store, index → ctx.index, identity → ctx.identity, recipient → ctx.recipient
```

**Status-mutation commands** (`pop.rs`, `ack.rs`) — change destructuring + save:
```rust
// OLD:
super::save_index(&store, &index, &recipient)?;
// NEW:
super::save_and_sync(&mut ctx)?;
```

**Write command** (`push.rs`) — change destructuring + save + upload blob + track pending:
```rust
// After writing the message blob locally, add:
if crate::sync::is_sync_enabled(&ctx.config) {
    let blob_key = format!("messages/{}.age", entry.id);
    if let Ok(blob_data) = ctx.store.read_blob(&blob_key) {
        if !crate::sync::push_blob(&blob_key, &blob_data, &ctx.config).unwrap_or(false) {
            ctx.sync_state.pending_ids.insert(entry.id.clone());
        }
    }
}
super::save_and_sync(&mut ctx)?;
// Note: save_and_sync already saves sync_state when sync is enabled
```

**Delete commands** (`delete.rs`, `purge.rs`) — change destructuring + save + delete remote blob + track pending_deletes:
```rust
// After deleting locally, add:
if crate::sync::is_sync_enabled(&ctx.config) {
    if !crate::sync::delete_blob(&format!("messages/{id}.age"), &ctx.config).unwrap_or(false) {
        ctx.sync_state.pending_deletes.insert(id.to_string());
    }
}
super::save_and_sync(&mut ctx)?;
// Note: save_and_sync already saves sync_state when sync is enabled
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check`
Expected: Compiles successfully

- [ ] **Step 3: Run existing tests**

Run: `cargo test`
Expected: All 42 tests still pass (existing behavior unchanged for `local` backend)

- [ ] **Step 4: Commit**

```bash
git add src/commands/
git commit -m "refactor: update all commands to use AppContext with sync support"
```

---

### Task 10: Config Command

**Files:**
- Create: `src/commands/config_cmd.rs`
- Modify: `src/main.rs` (add Config subcommand)

- [ ] **Step 1: Create config_cmd.rs**

```rust
use crate::commands::get_data_dir;
use crate::config::Config;
use anyhow::{Context, Result};

pub fn run_get(key: &str) -> Result<()> {
    let data_dir = get_data_dir()?;
    let config_path = data_dir.join("config.toml");

    let config = if config_path.exists() {
        Config::load(&config_path)?
    } else {
        Config::default_with_path(&data_dir)
    };

    match config.get(key) {
        Some(value) => {
            let display = if key.contains("secret") || key.contains("key") {
                Config::mask_secret(&value)
            } else {
                value
            };
            println!("{key} = {display}");
        }
        None => {
            eprintln!("Unknown config key: {key}");
            std::process::exit(1);
        }
    }

    Ok(())
}

pub fn run_set(key: &str, value: &str) -> Result<()> {
    let data_dir = get_data_dir()?;
    let config_path = data_dir.join("config.toml");

    let mut config = if config_path.exists() {
        Config::load(&config_path)?
    } else {
        Config::default_with_path(&data_dir)
    };

    config.set(key, value)?;
    config.save(&config_path)?;

    let display = if key.contains("secret") || key.contains("key") {
        Config::mask_secret(value)
    } else {
        value.to_string()
    };
    println!("Set {key} = {display}");

    Ok(())
}
```

- [ ] **Step 2: Add Config subcommand to main.rs**

Add to the `Commands` enum in `src/main.rs`:

```rust
/// Manage configuration
#[command(subcommand)]
Config(ConfigCommands),
```

Add the `ConfigCommands` enum:

```rust
#[derive(Subcommand)]
enum ConfigCommands {
    /// Get a config value
    Get {
        /// Config key (e.g., storage.backend, storage.r2.bucket)
        key: String,
    },
    /// Set a config value
    Set {
        /// Config key
        key: String,
        /// Config value
        value: String,
    },
}
```

Add to the match in `main()`:

```rust
Commands::Config(cmd) => match cmd {
    ConfigCommands::Get { key } => commands::config_cmd::run_get(&key),
    ConfigCommands::Set { key, value } => commands::config_cmd::run_set(&key, &value),
},
```

- [ ] **Step 3: Verify it compiles and run manually**

Run: `cargo check`
Expected: Compiles

- [ ] **Step 4: Commit**

```bash
git add src/commands/config_cmd.rs src/main.rs
git commit -m "feat: nts config get/set for managing R2 settings"
```

---

### Task 11: Status Command

**Files:**
- Create: `src/commands/status.rs`
- Modify: `src/main.rs` (add Status subcommand)

- [ ] **Step 1: Create status.rs**

```rust
use crate::commands::get_data_dir;
use crate::config::Config;
use crate::sync_state::SyncState;
use anyhow::Result;

pub fn run() -> Result<()> {
    let data_dir = get_data_dir()?;
    let config_path = data_dir.join("config.toml");

    let config = if config_path.exists() {
        Config::load(&config_path)?
    } else {
        Config::default_with_path(&data_dir)
    };

    let sync_state = SyncState::load(&data_dir)?;

    println!("Backend: {}", config.storage.backend);

    if config.storage.backend == "r2" {
        if let Some(r2) = &config.storage.r2 {
            println!("Bucket: {}", r2.bucket);
            println!("Endpoint: {}", r2.endpoint);
        } else {
            println!("R2: not configured");
        }
    }

    match sync_state.last_sync {
        Some(ts) => println!("Last sync: {}", ts.format("%Y-%m-%d %H:%M:%S UTC")),
        None => println!("Last sync: never"),
    }

    let pending_count = sync_state.pending_ids.len() + sync_state.pending_deletes.len();
    if pending_count > 0 {
        println!(
            "Pending: {} push(es), {} delete(s)",
            sync_state.pending_ids.len(),
            sync_state.pending_deletes.len()
        );
    } else {
        println!("Pending: none");
    }

    Ok(())
}
```

- [ ] **Step 2: Add Status subcommand to main.rs**

Add to the `Commands` enum:

```rust
/// Show sync status
Status,
```

Add to the match:

```rust
Commands::Status => commands::status::run(),
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo check`

- [ ] **Step 4: Commit**

```bash
git add src/commands/status.rs src/main.rs
git commit -m "feat: nts status command showing sync state"
```

---

### Task 12: Sync Command

**Files:**
- Create: `src/commands/sync_cmd.rs`
- Modify: `src/main.rs` (add Sync subcommand)

- [ ] **Step 1: Create sync_cmd.rs**

```rust
use crate::commands;
use crate::sync;
use anyhow::Result;

pub fn run() -> Result<()> {
    let mut ctx = commands::load_context()?;

    if !sync::is_sync_enabled(&ctx.config) {
        println!("Sync is not enabled. Set backend to r2:");
        println!("  nts config set storage.backend r2");
        println!("  nts config set storage.r2.bucket <bucket>");
        println!("  nts config set storage.r2.endpoint <endpoint>");
        println!("  nts config set storage.r2.access_key_id <key>");
        println!("  nts config set storage.r2.secret_access_key <secret>");
        return Ok(());
    }

    ctx.index.enforce_ttl();

    println!("Syncing...");

    sync::push_pending(
        &ctx.index,
        &ctx.store,
        &ctx.config,
        &mut ctx.sync_state,
        &ctx.identity,
        &ctx.recipient,
    )?;

    ctx.sync_state.save(&ctx.data_dir)?;
    commands::save_index(&ctx.store, &ctx.index, &ctx.recipient)?;

    println!("Sync complete.");
    if ctx.sync_state.pending_ids.is_empty() && ctx.sync_state.pending_deletes.is_empty() {
        println!("All changes synchronized.");
    } else {
        println!(
            "Warning: {} change(s) still pending.",
            ctx.sync_state.pending_ids.len() + ctx.sync_state.pending_deletes.len()
        );
    }

    Ok(())
}
```

- [ ] **Step 2: Add Sync subcommand to main.rs**

Add to the `Commands` enum:

```rust
/// Force sync with R2
Sync,
```

Add to the match:

```rust
Commands::Sync => commands::sync_cmd::run(),
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo check`

- [ ] **Step 4: Commit**

```bash
git add src/commands/sync_cmd.rs src/main.rs
git commit -m "feat: nts sync command for manual push/pull"
```

---

## Chunk 5: Export/Import + Integration Tests

### Task 13: Export Command

**Files:**
- Create: `src/commands/export.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: Create export.rs**

```rust
use crate::commands::get_data_dir;
use crate::config::Config;
use crate::crypto;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::io::Write;

#[derive(Serialize, Deserialize)]
pub struct ExportBundle {
    pub v: u32,
    pub identity: String,
    pub recipient: String,
    pub config: Config,
}

pub fn run(passphrase: bool) -> Result<()> {
    let data_dir = get_data_dir()?;
    let identity_path = data_dir.join("identity.txt");
    let recipients_path = data_dir.join("recipients.txt");
    let config_path = data_dir.join("config.toml");

    if !identity_path.exists() {
        anyhow::bail!("Not initialized. Run `nts init` first.");
    }

    let identity_str = std::fs::read_to_string(&identity_path)
        .context("Failed to read identity")?;
    let recipient_str = std::fs::read_to_string(&recipients_path)
        .context("Failed to read recipient")?;

    let config = if config_path.exists() {
        Config::load(&config_path)?
    } else {
        Config::default_with_path(&data_dir)
    };

    let bundle = ExportBundle {
        v: 1,
        identity: identity_str.trim().to_string(),
        recipient: recipient_str.trim().to_string(),
        config,
    };

    let json = serde_json::to_string_pretty(&bundle)?;

    if passphrase {
        let pass = rpassword::prompt_password("Export passphrase: ")?;
        let pass_confirm = rpassword::prompt_password("Confirm passphrase: ")?;
        if pass != pass_confirm {
            anyhow::bail!("Passphrases do not match.");
        }

        // age::scrypt::Recipient wraps a passphrase for encryption.
        // NOTE: The exact constructor may vary by age version. If
        // `age::scrypt::Recipient::new()` doesn't exist in 0.11,
        // check for `age::scrypt::Recipient::from()` or use the
        // `Encryptor::with_user_passphrase()` API instead.
        let scrypt_recipient = age::scrypt::Recipient::new(
            age::secrecy::SecretString::from(pass),
        );
        let encrypted = age::encrypt(&scrypt_recipient, json.as_bytes())
            .map_err(|e| anyhow::anyhow!("Failed to encrypt bundle: {e}"))?;

        std::io::stdout().write_all(&encrypted)?;
    } else {
        println!("{json}");
    }

    eprintln!("Export complete. Transfer this file securely to your other device.");
    Ok(())
}
```

- [ ] **Step 2: Add Export subcommand to main.rs**

Add to `Commands` enum:

```rust
/// Export identity and config for device bootstrapping
Export {
    /// Encrypt the bundle with a passphrase
    #[arg(long)]
    passphrase: bool,
},
```

Add to match:

```rust
Commands::Export { passphrase } => commands::export::run(passphrase),
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo check`

- [ ] **Step 4: Commit**

```bash
git add src/commands/export.rs src/main.rs
git commit -m "feat: nts export for device bootstrapping"
```

---

### Task 14: Import Command

**Files:**
- Create: `src/commands/import.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: Create import.rs**

```rust
use crate::commands::get_data_dir;
use crate::commands::export::ExportBundle;
use crate::crypto;
use anyhow::{Context, Result};
use std::fs;
use std::os::unix::fs::PermissionsExt;

pub fn run(file: &str, passphrase: bool) -> Result<()> {
    let data_dir = get_data_dir()?;

    if data_dir.join("identity.txt").exists() {
        anyhow::bail!(
            "Already initialized at {}. Delete the data directory first to import.",
            data_dir.display()
        );
    }

    let file_bytes = fs::read(file)
        .with_context(|| format!("Failed to read import file: {file}"))?;

    let json_str = if passphrase {
        let pass = rpassword::prompt_password("Import passphrase: ")?;

        // age::scrypt::Identity wraps a passphrase for decryption.
        // NOTE: Same API caveat as export — verify exact constructor
        // in age 0.11. May need `Identity::from()` or the
        // `Decryptor::with_user_passphrase()` API instead.
        let identity = age::scrypt::Identity::new(
            age::secrecy::SecretString::from(pass),
        );
        let decrypted = age::decrypt(&identity, &file_bytes)
            .map_err(|e| anyhow::anyhow!("Failed to decrypt bundle (wrong passphrase?): {e}"))?;
        String::from_utf8(decrypted).context("Bundle is not valid UTF-8")?
    } else {
        String::from_utf8(file_bytes).context("Bundle is not valid UTF-8")?
    };

    let bundle: ExportBundle =
        serde_json::from_str(&json_str).context("Failed to parse export bundle")?;

    if bundle.v != 1 {
        anyhow::bail!("Unsupported bundle version: {}", bundle.v);
    }

    // Validate the keys parse correctly
    crypto::parse_identity(&bundle.identity)?;
    crypto::parse_recipient(&bundle.recipient)?;

    // Create data directory
    fs::create_dir_all(&data_dir)?;
    fs::create_dir_all(data_dir.join("messages"))?;

    // Write identity with restricted permissions
    let identity_path = data_dir.join("identity.txt");
    fs::write(&identity_path, &bundle.identity)?;
    fs::set_permissions(&identity_path, fs::Permissions::from_mode(0o600))?;

    // Write recipient
    fs::write(data_dir.join("recipients.txt"), &bundle.recipient)?;

    // Write config
    bundle.config.save(&data_dir.join("config.toml"))?;

    println!("Imported successfully to {}", data_dir.display());
    println!("Run `nts sync` to pull messages from R2.");

    Ok(())
}
```

- [ ] **Step 2: Add Import subcommand to main.rs**

Add to `Commands` enum:

```rust
/// Import identity and config from an export bundle
Import {
    /// Path to the export bundle file
    file: String,
    /// Bundle is passphrase-encrypted
    #[arg(long)]
    passphrase: bool,
},
```

Add to match:

```rust
Commands::Import { file, passphrase } => commands::import::run(&file, passphrase),
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo check`

- [ ] **Step 4: Commit**

```bash
git add src/commands/import.rs src/main.rs
git commit -m "feat: nts import for setting up new devices from export bundle"
```

---

### Task 15: Integration Tests for New Commands

**Files:**
- Modify: `tests/integration.rs`

- [ ] **Step 1: Add integration tests for config, status, and export/import**

Append to `tests/integration.rs`:

```rust
#[test]
fn test_config_set_and_get() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .args(["config", "set", "storage.backend", "r2"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Set storage.backend = r2"));

    nts(&tmp)
        .args(["config", "get", "storage.backend"])
        .assert()
        .success()
        .stdout(predicate::str::contains("r2"));
}

#[test]
fn test_status_local_backend() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .arg("status")
        .assert()
        .success()
        .stdout(predicate::str::contains("Backend: local"))
        .stdout(predicate::str::contains("Last sync: never"))
        .stdout(predicate::str::contains("Pending: none"));
}

#[test]
fn test_sync_without_r2_shows_instructions() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .arg("sync")
        .assert()
        .success()
        .stdout(predicate::str::contains("Sync is not enabled"));
}

#[test]
fn test_export_and_import_plaintext() {
    let tmp_src = TempDir::new().unwrap();
    nts(&tmp_src).arg("init").assert().success();
    nts(&tmp_src)
        .args(["push", "test message"])
        .assert()
        .success();

    // Export
    let output = nts(&tmp_src).arg("export").output().unwrap();
    assert!(output.status.success());

    let bundle_path = tmp_src.path().join("bundle.json");
    std::fs::write(&bundle_path, &output.stdout).unwrap();

    // Import to a new location
    let tmp_dst = TempDir::new().unwrap();
    nts(&tmp_dst)
        .args(["import", bundle_path.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("Imported successfully"));

    // Verify identity was imported
    assert!(tmp_dst.path().join("identity.txt").exists());
    assert!(tmp_dst.path().join("recipients.txt").exists());
    assert!(tmp_dst.path().join("config.toml").exists());
}

#[test]
fn test_import_fails_if_already_initialized() {
    let tmp_src = TempDir::new().unwrap();
    nts(&tmp_src).arg("init").assert().success();

    let output = nts(&tmp_src).arg("export").output().unwrap();
    let bundle_path = tmp_src.path().join("bundle.json");
    std::fs::write(&bundle_path, &output.stdout).unwrap();

    // Try to import into the same (already initialized) directory
    nts(&tmp_src)
        .args(["import", bundle_path.to_str().unwrap()])
        .assert()
        .failure()
        .stderr(predicate::str::contains("Already initialized"));
}
```

- [ ] **Step 2: Run the new integration tests**

Run: `cargo test --test integration`
Expected: All integration tests pass (old + 5 new)

- [ ] **Step 3: Run full test suite**

Run: `cargo test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/integration.rs
git commit -m "test: integration tests for config, status, sync, export, import"
```

---

### Task 16: Final Verification and Cleanup

- [ ] **Step 1: Run full test suite**

Run: `cargo test`
Expected: All tests pass

- [ ] **Step 2: Test CLI commands manually (local backend)**

```bash
NTS_HOME=/tmp/nts-m2-test cargo run -- init
NTS_HOME=/tmp/nts-m2-test cargo run -- push "hello from M2"
NTS_HOME=/tmp/nts-m2-test cargo run -- list
NTS_HOME=/tmp/nts-m2-test cargo run -- status
NTS_HOME=/tmp/nts-m2-test cargo run -- config get storage.backend
NTS_HOME=/tmp/nts-m2-test cargo run -- config set storage.backend r2
NTS_HOME=/tmp/nts-m2-test cargo run -- config get storage.backend
NTS_HOME=/tmp/nts-m2-test cargo run -- sync
```

- [ ] **Step 3: Update CLAUDE.md project structure**

Add new files to the project structure section.

- [ ] **Step 4: Update roadmap.md**

Check off M2 items in `docs/roadmap.md`.

- [ ] **Step 5: Commit docs updates**

```bash
git add CLAUDE.md docs/roadmap.md
git commit -m "docs: update project structure and roadmap for M2"
```

- [ ] **Step 6: Push to GitHub**

```bash
git push origin main
```

---

## Post-Implementation: Live R2 Testing

After all code tasks are complete, test with real R2 credentials:

```bash
nts config set storage.backend r2
nts config set storage.r2.bucket nts-messages
nts config set storage.r2.endpoint "https://<account-id>.r2.cloudflarestorage.com"
nts config set storage.r2.access_key_id "<key>"
nts config set storage.r2.secret_access_key "<secret>"
nts sync
nts push "first synced message"
nts list
nts status
```

This requires the user's actual R2 credentials and cannot be automated in tests.
