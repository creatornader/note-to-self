# Milestone 1: nts CLI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working `nts` Rust CLI that encrypts/decrypts personal messages with age, stored as individual files on the local filesystem.

**Architecture:** CLI binary built with clap for argument parsing, the `age` crate for encryption, and serde for JSON serialization. Messages are stored as individual age-encrypted JSON blobs in `~/.local/share/nts/messages/`. An encrypted JSON index tracks metadata (tags, status, TTL). Storage is abstracted behind a trait for future R2 support.

**Tech Stack:** Rust 1.90, age 0.11.2, clap 4, serde/serde_json, chrono, rand, directories, toml

**Spec:** `docs/superpowers/specs/2026-03-10-milestone1-cli-design.md`

---

## Chunk 1: Project Scaffolding + Core Types

### Task 1: Initialize Rust project with dependencies

**Files:**
- Create: `Cargo.toml`
- Create: `src/main.rs`

- [ ] **Step 1: Create Cargo project**

```bash
cd /Users/naderhelmy/repos/note-to-self
cargo init --name nts
```

- [ ] **Step 2: Add dependencies to Cargo.toml**

Replace the `[dependencies]` section in `Cargo.toml`:

```toml
[dependencies]
age = { version = "0.11", features = ["armor"] }
clap = { version = "4", features = ["derive"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
toml = "0.8"
chrono = { version = "0.4", features = ["serde"] }
rand = "0.9"
directories = "6"
colored = "3"
anyhow = "1"
secrecy = "0.10"

[dev-dependencies]
tempfile = "3"
assert_cmd = "2"
predicates = "3"
```

- [ ] **Step 3: Verify it compiles**

```bash
cargo build
```
Expected: compiles successfully.

- [ ] **Step 4: Commit**

```bash
git add Cargo.toml Cargo.lock src/main.rs
git commit -m "feat: initialize Rust project with dependencies"
```

---

### Task 2: Define core data types (Message, IndexEntry, Index)

**Files:**
- Create: `src/message.rs`
- Create: `src/index.rs`

- [ ] **Step 1: Write tests for message serialization**

Create `src/message.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub v: u32,
    pub id: String,
    pub content: String,
    pub content_type: String,
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub device: String,
}

impl Message {
    pub fn new(id: String, content: String, tags: Vec<String>) -> Self {
        Self {
            v: 1,
            id,
            content,
            content_type: "text/plain".to_string(),
            tags,
            created_at: Utc::now(),
            device: "cli".to_string(),
        }
    }

    pub fn preview(&self, max_len: usize) -> String {
        if self.content.len() <= max_len {
            self.content.clone()
        } else {
            format!("{}...", &self.content[..max_len])
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_new() {
        let msg = Message::new(
            "123_abc".to_string(),
            "hello world".to_string(),
            vec!["work".to_string()],
        );
        assert_eq!(msg.v, 1);
        assert_eq!(msg.content, "hello world");
        assert_eq!(msg.tags, vec!["work"]);
        assert_eq!(msg.content_type, "text/plain");
        assert_eq!(msg.device, "cli");
    }

    #[test]
    fn test_message_serialization_roundtrip() {
        let msg = Message::new(
            "123_abc".to_string(),
            "test content".to_string(),
            vec![],
        );
        let json = serde_json::to_string(&msg).unwrap();
        let deserialized: Message = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.content, "test content");
        assert_eq!(deserialized.id, "123_abc");
    }

    #[test]
    fn test_preview_short() {
        let msg = Message::new("1".to_string(), "short".to_string(), vec![]);
        assert_eq!(msg.preview(50), "short");
    }

    #[test]
    fn test_preview_truncated() {
        let msg = Message::new("1".to_string(), "a".repeat(100), vec![]);
        let preview = msg.preview(20);
        assert!(preview.ends_with("..."));
        assert_eq!(preview.len(), 23); // 20 chars + "..."
    }
}
```

- [ ] **Step 2: Write index types and tests**

Create `src/index.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageStatus {
    Unread,
    Read,
    Consumed,
    Expired,
}

impl std::fmt::Display for MessageStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unread => write!(f, "unread"),
            Self::Read => write!(f, "read"),
            Self::Consumed => write!(f, "consumed"),
            Self::Expired => write!(f, "expired"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexEntry {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub tags: Vec<String>,
    pub ttl_seconds: Option<u64>,
    pub expires_at: Option<DateTime<Utc>>,
    pub status: MessageStatus,
    pub content_preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Index {
    pub version: u32,
    pub messages: Vec<IndexEntry>,
}

impl Index {
    pub fn new() -> Self {
        Self {
            version: 1,
            messages: Vec::new(),
        }
    }

    pub fn add_entry(&mut self, entry: IndexEntry) {
        self.messages.push(entry);
    }

    pub fn find_by_id(&self, id: &str) -> Option<&IndexEntry> {
        self.messages.iter().find(|e| e.id == id)
    }

    pub fn find_by_id_mut(&mut self, id: &str) -> Option<&mut IndexEntry> {
        self.messages.iter_mut().find(|e| e.id == id)
    }

    pub fn latest_unread(&self) -> Option<&IndexEntry> {
        self.messages
            .iter()
            .rev()
            .find(|e| e.status == MessageStatus::Unread)
    }

    pub fn enforce_ttl(&mut self) {
        let now = Utc::now();
        for entry in &mut self.messages {
            if let Some(expires_at) = entry.expires_at {
                if now >= expires_at && entry.status != MessageStatus::Expired {
                    entry.status = MessageStatus::Expired;
                }
            }
        }
    }

    pub fn remove_by_id(&mut self, id: &str) -> bool {
        let len_before = self.messages.len();
        self.messages.retain(|e| e.id != id);
        self.messages.len() < len_before
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn make_entry(id: &str, status: MessageStatus) -> IndexEntry {
        IndexEntry {
            id: id.to_string(),
            created_at: Utc::now(),
            tags: vec![],
            ttl_seconds: None,
            expires_at: None,
            status,
            content_preview: format!("preview {id}"),
        }
    }

    #[test]
    fn test_new_index() {
        let idx = Index::new();
        assert_eq!(idx.version, 1);
        assert!(idx.messages.is_empty());
    }

    #[test]
    fn test_add_and_find() {
        let mut idx = Index::new();
        idx.add_entry(make_entry("abc", MessageStatus::Unread));
        assert!(idx.find_by_id("abc").is_some());
        assert!(idx.find_by_id("xyz").is_none());
    }

    #[test]
    fn test_latest_unread() {
        let mut idx = Index::new();
        idx.add_entry(make_entry("1", MessageStatus::Unread));
        idx.add_entry(make_entry("2", MessageStatus::Read));
        idx.add_entry(make_entry("3", MessageStatus::Unread));
        assert_eq!(idx.latest_unread().unwrap().id, "3");
    }

    #[test]
    fn test_latest_unread_none() {
        let mut idx = Index::new();
        idx.add_entry(make_entry("1", MessageStatus::Read));
        assert!(idx.latest_unread().is_none());
    }

    #[test]
    fn test_enforce_ttl() {
        let mut idx = Index::new();
        let mut entry = make_entry("1", MessageStatus::Unread);
        entry.expires_at = Some(Utc::now() - Duration::seconds(10));
        idx.add_entry(entry);
        idx.enforce_ttl();
        assert_eq!(idx.find_by_id("1").unwrap().status, MessageStatus::Expired);
    }

    #[test]
    fn test_enforce_ttl_not_expired() {
        let mut idx = Index::new();
        let mut entry = make_entry("1", MessageStatus::Unread);
        entry.expires_at = Some(Utc::now() + Duration::seconds(3600));
        idx.add_entry(entry);
        idx.enforce_ttl();
        assert_eq!(idx.find_by_id("1").unwrap().status, MessageStatus::Unread);
    }

    #[test]
    fn test_remove_by_id() {
        let mut idx = Index::new();
        idx.add_entry(make_entry("1", MessageStatus::Unread));
        idx.add_entry(make_entry("2", MessageStatus::Unread));
        assert!(idx.remove_by_id("1"));
        assert_eq!(idx.messages.len(), 1);
        assert!(!idx.remove_by_id("nonexistent"));
    }

    #[test]
    fn test_serialization_roundtrip() {
        let mut idx = Index::new();
        idx.add_entry(make_entry("1", MessageStatus::Unread));
        let json = serde_json::to_string(&idx).unwrap();
        let deserialized: Index = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.messages.len(), 1);
        assert_eq!(deserialized.messages[0].id, "1");
    }
}
```

- [ ] **Step 3: Wire modules into main.rs**

Update `src/main.rs`:

```rust
mod index;
mod message;

fn main() {
    println!("nts - Note to Self");
}
```

- [ ] **Step 4: Run tests**

```bash
cargo test
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/message.rs src/index.rs src/main.rs
git commit -m "feat: add Message and Index core types with tests"
```

---

### Task 3: Crypto module (age encrypt/decrypt wrappers)

**Files:**
- Create: `src/crypto.rs`

- [ ] **Step 1: Write crypto module with tests**

Create `src/crypto.rs`:

```rust
use age::secrecy::ExposeSecret;
use anyhow::{Context, Result};
use std::io::{Read, Write};

pub struct KeyPair {
    pub identity: age::x25519::Identity,
    pub recipient: age::x25519::Recipient,
}

pub fn generate_keypair() -> KeyPair {
    let identity = age::x25519::Identity::generate();
    let recipient = identity.to_public();
    KeyPair {
        identity,
        recipient,
    }
}

pub fn encrypt(plaintext: &[u8], recipient: &age::x25519::Recipient) -> Result<Vec<u8>> {
    let encryptor =
        age::Encryptor::with_recipients(vec![Box::new(recipient.clone())])
            .context("Failed to create encryptor")?;

    let mut encrypted = vec![];
    let mut writer = encryptor
        .wrap_output(&mut encrypted)
        .context("Failed to wrap output")?;
    writer
        .write_all(plaintext)
        .context("Failed to write plaintext")?;
    writer.finish()?;

    Ok(encrypted)
}

pub fn decrypt(ciphertext: &[u8], identity: &age::x25519::Identity) -> Result<Vec<u8>> {
    let decryptor = age::Decryptor::new(ciphertext).context("Failed to create decryptor")?;

    let mut decrypted = vec![];
    match decryptor {
        age::Decryptor::Recipients(d) => {
            let mut reader = d
                .decrypt(std::iter::once(identity as &dyn age::Identity))
                .map_err(|e| anyhow::anyhow!("Decryption failed: {e}"))?;
            reader
                .read_to_end(&mut decrypted)
                .context("Failed to read decrypted data")?;
        }
        _ => anyhow::bail!("Unexpected decryptor type"),
    }

    Ok(decrypted)
}

pub fn identity_to_string(identity: &age::x25519::Identity) -> String {
    identity.to_string().expose_secret().to_string()
}

pub fn recipient_to_string(recipient: &age::x25519::Recipient) -> String {
    recipient.to_string()
}

pub fn parse_identity(s: &str) -> Result<age::x25519::Identity> {
    s.parse()
        .map_err(|e| anyhow::anyhow!("Failed to parse identity: {e}"))
}

pub fn parse_recipient(s: &str) -> Result<age::x25519::Recipient> {
    s.parse()
        .map_err(|e| anyhow::anyhow!("Failed to parse recipient: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_keypair() {
        let kp = generate_keypair();
        let id_str = identity_to_string(&kp.identity);
        let rc_str = recipient_to_string(&kp.recipient);
        assert!(id_str.starts_with("AGE-SECRET-KEY-"));
        assert!(rc_str.starts_with("age1"));
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let kp = generate_keypair();
        let plaintext = b"hello, note to self!";
        let ciphertext = encrypt(plaintext, &kp.recipient).unwrap();
        assert_ne!(ciphertext, plaintext);
        let decrypted = decrypt(&ciphertext, &kp.identity).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_encrypt_decrypt_empty() {
        let kp = generate_keypair();
        let plaintext = b"";
        let ciphertext = encrypt(plaintext, &kp.recipient).unwrap();
        let decrypted = decrypt(&ciphertext, &kp.identity).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_encrypt_decrypt_large() {
        let kp = generate_keypair();
        let plaintext = vec![0x42u8; 100_000];
        let ciphertext = encrypt(&plaintext, &kp.recipient).unwrap();
        let decrypted = decrypt(&ciphertext, &kp.identity).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_wrong_key_fails() {
        let kp1 = generate_keypair();
        let kp2 = generate_keypair();
        let ciphertext = encrypt(b"secret", &kp1.recipient).unwrap();
        let result = decrypt(&ciphertext, &kp2.identity);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_identity_roundtrip() {
        let kp = generate_keypair();
        let s = identity_to_string(&kp.identity);
        let parsed = parse_identity(&s).unwrap();
        // Verify by encrypting with original recipient and decrypting with parsed identity
        let ct = encrypt(b"test", &kp.recipient).unwrap();
        let pt = decrypt(&ct, &parsed).unwrap();
        assert_eq!(pt, b"test");
    }

    #[test]
    fn test_parse_recipient_roundtrip() {
        let kp = generate_keypair();
        let s = recipient_to_string(&kp.recipient);
        let parsed = parse_recipient(&s).unwrap();
        // Verify by encrypting with parsed recipient and decrypting with original identity
        let ct = encrypt(b"test", &parsed).unwrap();
        let pt = decrypt(&ct, &kp.identity).unwrap();
        assert_eq!(pt, b"test");
    }
}
```

- [ ] **Step 2: Add to main.rs**

Add `mod crypto;` to `src/main.rs`.

- [ ] **Step 3: Run tests**

```bash
cargo test
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/crypto.rs src/main.rs
git commit -m "feat: add age encryption/decryption crypto module with tests"
```

---

### Task 4: Local storage backend

**Files:**
- Create: `src/storage/mod.rs`
- Create: `src/storage/local.rs`
- Create: `src/config.rs`

- [ ] **Step 1: Write storage trait and local implementation**

Create `src/storage/mod.rs`:

```rust
pub mod local;

use anyhow::Result;

pub trait Storage {
    fn read_blob(&self, key: &str) -> Result<Vec<u8>>;
    fn write_blob(&self, key: &str, data: &[u8]) -> Result<()>;
    fn delete_blob(&self, key: &str) -> Result<()>;
    fn blob_exists(&self, key: &str) -> bool;
    fn list_blobs(&self, prefix: &str) -> Result<Vec<String>>;
}
```

Create `src/storage/local.rs`:

```rust
use super::Storage;
use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};

pub struct LocalStorage {
    base_path: PathBuf,
}

impl LocalStorage {
    pub fn new(base_path: &Path) -> Result<Self> {
        fs::create_dir_all(base_path)
            .with_context(|| format!("Failed to create storage dir: {}", base_path.display()))?;
        Ok(Self {
            base_path: base_path.to_path_buf(),
        })
    }

    fn full_path(&self, key: &str) -> PathBuf {
        self.base_path.join(key)
    }
}

impl Storage for LocalStorage {
    fn read_blob(&self, key: &str) -> Result<Vec<u8>> {
        let path = self.full_path(key);
        fs::read(&path).with_context(|| format!("Failed to read: {}", path.display()))
    }

    fn write_blob(&self, key: &str, data: &[u8]) -> Result<()> {
        let path = self.full_path(key);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&path, data).with_context(|| format!("Failed to write: {}", path.display()))
    }

    fn delete_blob(&self, key: &str) -> Result<()> {
        let path = self.full_path(key);
        if path.exists() {
            fs::remove_file(&path)
                .with_context(|| format!("Failed to delete: {}", path.display()))?;
        }
        Ok(())
    }

    fn blob_exists(&self, key: &str) -> bool {
        self.full_path(key).exists()
    }

    fn list_blobs(&self, prefix: &str) -> Result<Vec<String>> {
        let dir = self.full_path(prefix);
        if !dir.exists() {
            return Ok(vec![]);
        }
        let mut keys = vec![];
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                if let Some(name) = entry.file_name().to_str() {
                    keys.push(format!("{prefix}/{name}"));
                }
            }
        }
        keys.sort();
        Ok(keys)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_write_and_read() {
        let tmp = TempDir::new().unwrap();
        let store = LocalStorage::new(tmp.path()).unwrap();
        store.write_blob("test.txt", b"hello").unwrap();
        let data = store.read_blob("test.txt").unwrap();
        assert_eq!(data, b"hello");
    }

    #[test]
    fn test_write_nested() {
        let tmp = TempDir::new().unwrap();
        let store = LocalStorage::new(tmp.path()).unwrap();
        store
            .write_blob("messages/abc.age", b"encrypted")
            .unwrap();
        let data = store.read_blob("messages/abc.age").unwrap();
        assert_eq!(data, b"encrypted");
    }

    #[test]
    fn test_delete() {
        let tmp = TempDir::new().unwrap();
        let store = LocalStorage::new(tmp.path()).unwrap();
        store.write_blob("del.txt", b"bye").unwrap();
        assert!(store.blob_exists("del.txt"));
        store.delete_blob("del.txt").unwrap();
        assert!(!store.blob_exists("del.txt"));
    }

    #[test]
    fn test_delete_nonexistent() {
        let tmp = TempDir::new().unwrap();
        let store = LocalStorage::new(tmp.path()).unwrap();
        // Should not error
        store.delete_blob("nope.txt").unwrap();
    }

    #[test]
    fn test_list_blobs() {
        let tmp = TempDir::new().unwrap();
        let store = LocalStorage::new(tmp.path()).unwrap();
        store.write_blob("messages/a.age", b"1").unwrap();
        store.write_blob("messages/b.age", b"2").unwrap();
        let keys = store.list_blobs("messages").unwrap();
        assert_eq!(keys, vec!["messages/a.age", "messages/b.age"]);
    }

    #[test]
    fn test_list_empty_dir() {
        let tmp = TempDir::new().unwrap();
        let store = LocalStorage::new(tmp.path()).unwrap();
        let keys = store.list_blobs("messages").unwrap();
        assert!(keys.is_empty());
    }
}
```

- [ ] **Step 2: Write config module**

Create `src/config.rs`:

```rust
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub storage: StorageConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    pub backend: String,
    pub path: String,
}

impl Config {
    pub fn default_with_path(data_dir: &Path) -> Self {
        Self {
            storage: StorageConfig {
                backend: "local".to_string(),
                path: data_dir.to_string_lossy().to_string(),
            },
        }
    }

    pub fn load(path: &Path) -> Result<Self> {
        let content =
            fs::read_to_string(path).with_context(|| format!("Failed to read config: {}", path.display()))?;
        toml::from_str(&content).context("Failed to parse config")
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let content = toml::to_string_pretty(self).context("Failed to serialize config")?;
        fs::write(path, content).with_context(|| format!("Failed to write config: {}", path.display()))
    }

    pub fn data_dir(&self) -> PathBuf {
        PathBuf::from(shellexpand::tilde(&self.storage.path).to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_config_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let cfg = Config::default_with_path(tmp.path());
        let path = tmp.path().join("config.toml");
        cfg.save(&path).unwrap();
        let loaded = Config::load(&path).unwrap();
        assert_eq!(loaded.storage.backend, "local");
    }
}
```

- [ ] **Step 3: Add shellexpand dependency**

Add to `Cargo.toml` under `[dependencies]`:
```toml
shellexpand = "3"
```

- [ ] **Step 4: Wire modules into main.rs**

Update `src/main.rs` to include:
```rust
mod config;
mod crypto;
mod index;
mod message;
mod storage;

fn main() {
    println!("nts - Note to Self");
}
```

- [ ] **Step 5: Run tests**

```bash
cargo test
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/storage/ src/config.rs src/main.rs Cargo.toml Cargo.lock
git commit -m "feat: add local storage backend and config module with tests"
```

---

## Chunk 2: CLI Commands (init, push, peek/pop/list)

### Task 5: ID generation helper + CLI skeleton with clap

**Files:**
- Create: `src/helpers.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: Create helpers module**

Create `src/helpers.rs`:

```rust
use chrono::Utc;
use rand::Rng;

pub fn generate_id() -> String {
    let ts = Utc::now().timestamp_millis();
    let mut rng = rand::rng();
    let suffix: u32 = rng.random_range(0..0xFFFFFFFF);
    format!("{ts}_{suffix:08x}")
}

pub fn parse_duration(s: &str) -> Result<u64, String> {
    let s = s.trim();
    if s.is_empty() {
        return Err("Empty duration string".to_string());
    }

    let (num_str, unit) = s.split_at(s.len() - 1);
    let num: u64 = num_str
        .parse()
        .map_err(|_| format!("Invalid duration number: {num_str}"))?;

    match unit {
        "s" => Ok(num),
        "m" => Ok(num * 60),
        "h" => Ok(num * 3600),
        "d" => Ok(num * 86400),
        _ => Err(format!("Unknown duration unit: {unit}. Use s, m, h, or d")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_id_format() {
        let id = generate_id();
        let parts: Vec<&str> = id.split('_').collect();
        assert_eq!(parts.len(), 2);
        assert!(parts[0].parse::<i64>().is_ok());
        assert_eq!(parts[1].len(), 8);
    }

    #[test]
    fn test_generate_id_unique() {
        let id1 = generate_id();
        let id2 = generate_id();
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_parse_duration_seconds() {
        assert_eq!(parse_duration("30s").unwrap(), 30);
    }

    #[test]
    fn test_parse_duration_minutes() {
        assert_eq!(parse_duration("5m").unwrap(), 300);
    }

    #[test]
    fn test_parse_duration_hours() {
        assert_eq!(parse_duration("4h").unwrap(), 14400);
    }

    #[test]
    fn test_parse_duration_days() {
        assert_eq!(parse_duration("7d").unwrap(), 604800);
    }

    #[test]
    fn test_parse_duration_invalid() {
        assert!(parse_duration("5x").is_err());
        assert!(parse_duration("").is_err());
        assert!(parse_duration("abc").is_err());
    }
}
```

- [ ] **Step 2: Build clap CLI skeleton in main.rs**

Replace `src/main.rs`:

```rust
mod commands;
mod config;
mod crypto;
mod helpers;
mod index;
mod message;
mod storage;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "nts", about = "Note to Self — encrypted personal message queue")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize nts (generate keypair, create data directory)
    Init,
    /// Push a new message
    Push {
        /// Message content (reads from stdin if omitted)
        content: Option<String>,
        /// Tags for the message
        #[arg(long, short)]
        tag: Vec<String>,
        /// Time-to-live (e.g., 30m, 4h, 7d)
        #[arg(long)]
        ttl: Option<String>,
    },
    /// Show the latest unread message without marking it
    Peek,
    /// Show the latest unread message and mark it consumed
    Pop,
    /// List all messages
    List {
        /// Filter by tag
        #[arg(long)]
        tag: Option<String>,
        /// Filter by status (unread, read, consumed, expired)
        #[arg(long)]
        status: Option<String>,
    },
    /// Show a specific message by ID
    Show {
        /// Message ID
        id: String,
    },
    /// Mark a message as read
    Ack {
        /// Message ID
        id: String,
    },
    /// Delete a message permanently
    Delete {
        /// Message ID
        id: String,
    },
    /// Clean up expired messages
    Purge {
        /// Remove expired messages
        #[arg(long)]
        expired: bool,
    },
    /// Search messages by content
    Search {
        /// Search query
        query: String,
    },
}

fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Init => commands::init::run(),
        Commands::Push { content, tag, ttl } => commands::push::run(content, tag, ttl),
        Commands::Peek => commands::peek::run(),
        Commands::Pop => commands::pop::run(),
        Commands::List { tag, status } => commands::list::run(tag, status),
        Commands::Show { id } => commands::show::run(&id),
        Commands::Ack { id } => commands::ack::run(&id),
        Commands::Delete { id } => commands::delete::run(&id),
        Commands::Purge { expired } => commands::purge::run(expired),
        Commands::Search { query } => commands::search::run(&query),
    };

    if let Err(e) = result {
        eprintln!("Error: {e:#}");
        std::process::exit(1);
    }
}
```

- [ ] **Step 3: Create commands module stubs**

Create `src/commands/mod.rs`:

```rust
pub mod ack;
pub mod delete;
pub mod init;
pub mod list;
pub mod peek;
pub mod pop;
pub mod purge;
pub mod push;
pub mod search;
pub mod show;

use crate::config::Config;
use crate::crypto;
use crate::index::Index;
use crate::storage::local::LocalStorage;
use crate::storage::Storage;
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

pub fn load_context() -> Result<(LocalStorage, Index, age::x25519::Identity, age::x25519::Recipient)> {
    let data_dir = get_data_dir()?;
    let identity_path = data_dir.join("identity.txt");
    let recipients_path = data_dir.join("recipients.txt");

    if !identity_path.exists() {
        anyhow::bail!("Not initialized. Run `nts init` first.");
    }

    let identity_str = std::fs::read_to_string(&identity_path)
        .context("Failed to read identity file")?;
    let identity = crypto::parse_identity(identity_str.trim())?;

    let recipient_str = std::fs::read_to_string(&recipients_path)
        .context("Failed to read recipients file")?;
    let recipient = crypto::parse_recipient(recipient_str.trim())?;

    let store = LocalStorage::new(&data_dir)?;

    let index = if store.blob_exists("index.age") {
        let encrypted = store.read_blob("index.age")?;
        let decrypted = crypto::decrypt(&encrypted, &identity)?;
        serde_json::from_slice(&decrypted).context("Failed to parse index")?
    } else {
        Index::new()
    };

    Ok((store, index, identity, recipient))
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
```

Create stub files for each command (all identical pattern):

Create `src/commands/init.rs`:
```rust
use anyhow::Result;

pub fn run() -> Result<()> {
    todo!("init command")
}
```

Create each of the remaining command stubs (`push.rs`, `peek.rs`, `pop.rs`, `list.rs`, `show.rs`, `ack.rs`, `delete.rs`, `purge.rs`, `search.rs`) with the same pattern but matching their function signatures from `main.rs`.

For example, `src/commands/push.rs`:
```rust
use anyhow::Result;

pub fn run(_content: Option<String>, _tags: Vec<String>, _ttl: Option<String>) -> Result<()> {
    todo!("push command")
}
```

`src/commands/peek.rs`:
```rust
use anyhow::Result;

pub fn run() -> Result<()> {
    todo!("peek command")
}
```

`src/commands/pop.rs`:
```rust
use anyhow::Result;

pub fn run() -> Result<()> {
    todo!("pop command")
}
```

`src/commands/list.rs`:
```rust
use anyhow::Result;

pub fn run(_tag: Option<String>, _status: Option<String>) -> Result<()> {
    todo!("list command")
}
```

`src/commands/show.rs`:
```rust
use anyhow::Result;

pub fn run(_id: &str) -> Result<()> {
    todo!("show command")
}
```

`src/commands/ack.rs`:
```rust
use anyhow::Result;

pub fn run(_id: &str) -> Result<()> {
    todo!("ack command")
}
```

`src/commands/delete.rs`:
```rust
use anyhow::Result;

pub fn run(_id: &str) -> Result<()> {
    todo!("delete command")
}
```

`src/commands/purge.rs`:
```rust
use anyhow::Result;

pub fn run(_expired: bool) -> Result<()> {
    todo!("purge command")
}
```

`src/commands/search.rs`:
```rust
use anyhow::Result;

pub fn run(_query: &str) -> Result<()> {
    todo!("search command")
}
```

- [ ] **Step 4: Verify it compiles**

```bash
cargo build
```

- [ ] **Step 5: Verify help text works**

```bash
cargo run -- --help
cargo run -- push --help
```

- [ ] **Step 6: Commit**

```bash
git add src/helpers.rs src/main.rs src/commands/
git commit -m "feat: add CLI skeleton with clap and command stubs"
```

---

### Task 6: Implement `nts init`

**Files:**
- Modify: `src/commands/init.rs`

- [ ] **Step 1: Implement init command**

Replace `src/commands/init.rs`:

```rust
use super::get_data_dir;
use crate::config::Config;
use crate::crypto;
use anyhow::{Context, Result};
use std::fs;
use std::os::unix::fs::PermissionsExt;

pub fn run() -> Result<()> {
    let data_dir = get_data_dir()?;
    let identity_path = data_dir.join("identity.txt");

    if identity_path.exists() {
        anyhow::bail!(
            "Already initialized at {}. Delete the directory to re-initialize.",
            data_dir.display()
        );
    }

    // Create directories
    fs::create_dir_all(data_dir.join("messages"))
        .context("Failed to create data directory")?;

    // Generate keypair
    let keypair = crypto::generate_keypair();

    // Write identity (private key) with 0600 permissions
    let identity_str = crypto::identity_to_string(&keypair.identity);
    fs::write(&identity_path, format!("{identity_str}\n"))?;
    fs::set_permissions(&identity_path, fs::Permissions::from_mode(0o600))?;

    // Write recipient (public key)
    let recipient_str = crypto::recipient_to_string(&keypair.recipient);
    fs::write(
        data_dir.join("recipients.txt"),
        format!("{recipient_str}\n"),
    )?;

    // Write default config
    let config = Config::default_with_path(&data_dir);
    config.save(&data_dir.join("config.toml"))?;

    println!("Initialized Note to Self at {}", data_dir.display());
    println!("Public key: {recipient_str}");
    println!("\nStart sending notes: nts push \"hello, future me\"");

    Ok(())
}
```

- [ ] **Step 2: Test manually**

```bash
NTS_HOME=/tmp/nts-test cargo run -- init
ls -la /tmp/nts-test/
cat /tmp/nts-test/recipients.txt
stat -f "%Lp" /tmp/nts-test/identity.txt  # Should show 600
rm -rf /tmp/nts-test
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/init.rs
git commit -m "feat: implement nts init command"
```

---

### Task 7: Implement `nts push`

**Files:**
- Modify: `src/commands/push.rs`

- [ ] **Step 1: Implement push command**

Replace `src/commands/push.rs`:

```rust
use super::{load_context, save_index};
use crate::helpers::{generate_id, parse_duration};
use crate::index::{IndexEntry, MessageStatus};
use crate::message::Message;
use crate::storage::Storage;
use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use std::io::{self, Read};

pub fn run(content: Option<String>, tags: Vec<String>, ttl: Option<String>) -> Result<()> {
    let content = match content {
        Some(c) => c,
        None => {
            // Read from stdin
            let mut buf = String::new();
            if atty::is(atty::Stream::Stdin) {
                anyhow::bail!("No message provided. Usage: nts push \"your message\"");
            }
            io::stdin()
                .read_to_string(&mut buf)
                .context("Failed to read from stdin")?;
            let trimmed = buf.trim().to_string();
            if trimmed.is_empty() {
                anyhow::bail!("Empty message from stdin");
            }
            trimmed
        }
    };

    let (store, mut index, identity, recipient) = load_context()?;

    // Enforce TTL on existing messages while we have the index open
    index.enforce_ttl();

    let id = generate_id();

    // Parse TTL
    let (ttl_seconds, expires_at) = match &ttl {
        Some(ttl_str) => {
            let secs = parse_duration(ttl_str)
                .map_err(|e| anyhow::anyhow!("Invalid TTL: {e}"))?;
            let expires = Utc::now() + Duration::seconds(secs as i64);
            (Some(secs), Some(expires))
        }
        None => (None, None),
    };

    // Create message
    let msg = Message::new(id.clone(), content.clone(), tags.clone());
    let msg_json = serde_json::to_string_pretty(&msg)?;
    let encrypted = crate::crypto::encrypt(msg_json.as_bytes(), &recipient)?;

    // Store encrypted message blob
    let blob_key = format!("messages/{id}.age");
    store.write_blob(&blob_key, &encrypted)?;

    // Add to index
    let entry = IndexEntry {
        id: id.clone(),
        created_at: msg.created_at,
        tags,
        ttl_seconds,
        expires_at,
        status: MessageStatus::Unread,
        content_preview: msg.preview(80),
    };
    index.add_entry(entry);

    // Save encrypted index
    save_index(&store, &index, &recipient)?;

    println!("Pushed: {id}");
    Ok(())
}
```

- [ ] **Step 2: Add atty dependency for stdin detection**

Add to `Cargo.toml` under `[dependencies]`:
```toml
atty = "0.2"
```

- [ ] **Step 3: Test manually**

```bash
NTS_HOME=/tmp/nts-test cargo run -- init
NTS_HOME=/tmp/nts-test cargo run -- push "hello world"
NTS_HOME=/tmp/nts-test cargo run -- push "tagged" --tag work --tag urgent
NTS_HOME=/tmp/nts-test cargo run -- push "expires soon" --ttl 1h
echo "from pipe" | NTS_HOME=/tmp/nts-test cargo run -- push
ls /tmp/nts-test/messages/
rm -rf /tmp/nts-test
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/push.rs Cargo.toml Cargo.lock
git commit -m "feat: implement nts push command with tags, TTL, and stdin support"
```

---

### Task 8: Implement `nts peek`, `nts pop`, `nts show`

**Files:**
- Modify: `src/commands/peek.rs`
- Modify: `src/commands/pop.rs`
- Modify: `src/commands/show.rs`
- Create: `src/display.rs` (shared display formatting)

- [ ] **Step 1: Create display helper**

Create `src/display.rs`:

```rust
use crate::index::IndexEntry;
use colored::Colorize;

pub fn print_message_detail(entry: &IndexEntry, content: &str) {
    println!("{}", "─── Note to Self ───────────────────────────────".dimmed());
    println!("  {}: {}", "ID".bold(), entry.id);
    if !entry.tags.is_empty() {
        println!("  {}: {}", "Tags".bold(), entry.tags.join(", "));
    }
    println!("  {}: {}", "Status".bold(), entry.status);
    println!(
        "  {}: {}",
        "Created".bold(),
        entry.created_at.format("%Y-%m-%d %H:%M:%S %Z")
    );
    if let Some(expires) = entry.expires_at {
        let now = chrono::Utc::now();
        if expires > now {
            let remaining = expires - now;
            let hours = remaining.num_hours();
            let mins = remaining.num_minutes() % 60;
            println!("  {}: in {}h {}m", "Expires".bold(), hours, mins);
        } else {
            println!("  {}: {}", "Expired".bold(), "yes".red());
        }
    }
    println!();
    println!("  {content}");
    println!("{}", "────────────────────────────────────────────────".dimmed());
}
```

- [ ] **Step 2: Implement peek**

Replace `src/commands/peek.rs`:

```rust
use super::load_context;
use crate::display;
use crate::storage::Storage;
use anyhow::Result;

pub fn run() -> Result<()> {
    let (store, mut index, identity, _recipient) = load_context()?;
    index.enforce_ttl();

    let entry = index
        .latest_unread()
        .ok_or_else(|| anyhow::anyhow!("No unread messages. Push one with: nts push \"hello\""))?
        .clone();

    // Decrypt message content
    let blob_key = format!("messages/{}.age", entry.id);
    let encrypted = store.read_blob(&blob_key)?;
    let decrypted = crate::crypto::decrypt(&encrypted, &identity)?;
    let msg: crate::message::Message = serde_json::from_slice(&decrypted)?;

    display::print_message_detail(&entry, &msg.content);
    Ok(())
}
```

- [ ] **Step 3: Implement pop**

Replace `src/commands/pop.rs`:

```rust
use super::{load_context, save_index};
use crate::display;
use crate::index::MessageStatus;
use crate::storage::Storage;
use anyhow::Result;

pub fn run() -> Result<()> {
    let (store, mut index, identity, recipient) = load_context()?;
    index.enforce_ttl();

    let entry = index
        .latest_unread()
        .ok_or_else(|| anyhow::anyhow!("No unread messages. Push one with: nts push \"hello\""))?
        .clone();

    // Decrypt message content
    let blob_key = format!("messages/{}.age", entry.id);
    let encrypted = store.read_blob(&blob_key)?;
    let decrypted = crate::crypto::decrypt(&encrypted, &identity)?;
    let msg: crate::message::Message = serde_json::from_slice(&decrypted)?;

    display::print_message_detail(&entry, &msg.content);

    // Mark as consumed
    if let Some(e) = index.find_by_id_mut(&entry.id) {
        e.status = MessageStatus::Consumed;
    }
    save_index(&store, &index, &recipient)?;

    Ok(())
}
```

- [ ] **Step 4: Implement show**

Replace `src/commands/show.rs`:

```rust
use super::load_context;
use crate::display;
use crate::storage::Storage;
use anyhow::Result;

pub fn run(id: &str) -> Result<()> {
    let (store, mut index, identity, _recipient) = load_context()?;
    index.enforce_ttl();

    let entry = index
        .find_by_id(id)
        .ok_or_else(|| anyhow::anyhow!("Message not found: {id}"))?
        .clone();

    let blob_key = format!("messages/{}.age", entry.id);
    let encrypted = store.read_blob(&blob_key)?;
    let decrypted = crate::crypto::decrypt(&encrypted, &identity)?;
    let msg: crate::message::Message = serde_json::from_slice(&decrypted)?;

    display::print_message_detail(&entry, &msg.content);
    Ok(())
}
```

- [ ] **Step 5: Add display module to main.rs**

Add `mod display;` to `src/main.rs`.

- [ ] **Step 6: Test manually**

```bash
NTS_HOME=/tmp/nts-test cargo run -- init
NTS_HOME=/tmp/nts-test cargo run -- push "first note" --tag test
NTS_HOME=/tmp/nts-test cargo run -- push "second note"
NTS_HOME=/tmp/nts-test cargo run -- peek
NTS_HOME=/tmp/nts-test cargo run -- pop
NTS_HOME=/tmp/nts-test cargo run -- peek  # Should show "first note" now
rm -rf /tmp/nts-test
```

- [ ] **Step 7: Commit**

```bash
git add src/display.rs src/commands/peek.rs src/commands/pop.rs src/commands/show.rs src/main.rs
git commit -m "feat: implement peek, pop, and show commands"
```

---

### Task 9: Implement `nts list`

**Files:**
- Modify: `src/commands/list.rs`

- [ ] **Step 1: Implement list command**

Replace `src/commands/list.rs`:

```rust
use super::load_context;
use crate::index::MessageStatus;
use colored::Colorize;
use anyhow::Result;

pub fn run(tag: Option<String>, status: Option<String>) -> Result<()> {
    let (_store, mut index, _identity, _recipient) = load_context()?;
    index.enforce_ttl();

    let status_filter: Option<MessageStatus> = match status.as_deref() {
        Some("unread") => Some(MessageStatus::Unread),
        Some("read") => Some(MessageStatus::Read),
        Some("consumed") => Some(MessageStatus::Consumed),
        Some("expired") => Some(MessageStatus::Expired),
        Some(s) => anyhow::bail!("Unknown status: {s}. Use: unread, read, consumed, expired"),
        None => None,
    };

    let filtered: Vec<_> = index
        .messages
        .iter()
        .filter(|e| {
            if let Some(ref t) = tag {
                if !e.tags.contains(t) {
                    return false;
                }
            }
            if let Some(ref s) = status_filter {
                if &e.status != s {
                    return false;
                }
            }
            true
        })
        .collect();

    if filtered.is_empty() {
        println!("No messages found.");
        return Ok(());
    }

    // Print header
    println!(
        "  {:<30} {:<10} {:<15} {}",
        "ID".bold(),
        "STATUS".bold(),
        "TAGS".bold(),
        "PREVIEW".bold()
    );

    for entry in &filtered {
        let status_str = match entry.status {
            MessageStatus::Unread => entry.status.to_string().yellow().to_string(),
            MessageStatus::Read => entry.status.to_string().green().to_string(),
            MessageStatus::Consumed => entry.status.to_string().dimmed().to_string(),
            MessageStatus::Expired => entry.status.to_string().red().to_string(),
        };
        let tags_str = if entry.tags.is_empty() {
            String::new()
        } else {
            entry.tags.join(", ")
        };
        let mut preview = entry.content_preview.clone();
        if let Some(expires) = entry.expires_at {
            let now = chrono::Utc::now();
            if expires > now {
                let remaining = expires - now;
                let hours = remaining.num_hours();
                let mins = remaining.num_minutes() % 60;
                preview = format!("{preview} (expires in {hours}h {mins}m)");
            }
        }
        println!("  {:<30} {:<10} {:<15} {}", entry.id, status_str, tags_str, preview);
    }

    println!("\n  {} message(s)", filtered.len());
    Ok(())
}
```

- [ ] **Step 2: Test manually**

```bash
NTS_HOME=/tmp/nts-test cargo run -- init
NTS_HOME=/tmp/nts-test cargo run -- push "note one" --tag work
NTS_HOME=/tmp/nts-test cargo run -- push "note two" --tag personal
NTS_HOME=/tmp/nts-test cargo run -- push "expires" --ttl 2h
NTS_HOME=/tmp/nts-test cargo run -- list
NTS_HOME=/tmp/nts-test cargo run -- list --tag work
NTS_HOME=/tmp/nts-test cargo run -- list --status unread
rm -rf /tmp/nts-test
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/list.rs
git commit -m "feat: implement nts list command with tag and status filtering"
```

---

## Chunk 3: Remaining Commands + Integration Tests

### Task 10: Implement `nts ack`, `nts delete`, `nts purge`

**Files:**
- Modify: `src/commands/ack.rs`
- Modify: `src/commands/delete.rs`
- Modify: `src/commands/purge.rs`

- [ ] **Step 1: Implement ack**

Replace `src/commands/ack.rs`:

```rust
use super::{load_context, save_index};
use crate::index::MessageStatus;
use anyhow::Result;

pub fn run(id: &str) -> Result<()> {
    let (store, mut index, _identity, recipient) = load_context()?;
    index.enforce_ttl();

    let entry = index
        .find_by_id_mut(id)
        .ok_or_else(|| anyhow::anyhow!("Message not found: {id}"))?;

    entry.status = MessageStatus::Read;
    save_index(&store, &index, &recipient)?;

    println!("Marked as read: {id}");
    Ok(())
}
```

- [ ] **Step 2: Implement delete**

Replace `src/commands/delete.rs`:

```rust
use super::{load_context, save_index};
use crate::storage::Storage;
use anyhow::Result;

pub fn run(id: &str) -> Result<()> {
    let (store, mut index, _identity, recipient) = load_context()?;

    if !index.remove_by_id(id) {
        anyhow::bail!("Message not found: {id}");
    }

    // Delete the blob
    let blob_key = format!("messages/{id}.age");
    store.delete_blob(&blob_key)?;

    save_index(&store, &index, &recipient)?;

    println!("Deleted: {id}");
    Ok(())
}
```

- [ ] **Step 3: Implement purge**

Replace `src/commands/purge.rs`:

```rust
use super::{load_context, save_index};
use crate::index::MessageStatus;
use crate::storage::Storage;
use anyhow::Result;

pub fn run(expired: bool) -> Result<()> {
    if !expired {
        anyhow::bail!("Usage: nts purge --expired");
    }

    let (store, mut index, _identity, recipient) = load_context()?;
    index.enforce_ttl();

    let expired_ids: Vec<String> = index
        .messages
        .iter()
        .filter(|e| e.status == MessageStatus::Expired)
        .map(|e| e.id.clone())
        .collect();

    if expired_ids.is_empty() {
        println!("No expired messages to purge.");
        return Ok(());
    }

    let count = expired_ids.len();
    for id in &expired_ids {
        let blob_key = format!("messages/{id}.age");
        store.delete_blob(&blob_key)?;
        index.remove_by_id(id);
    }

    save_index(&store, &index, &recipient)?;

    println!("Purged {count} expired message(s).");
    Ok(())
}
```

- [ ] **Step 4: Test manually**

```bash
NTS_HOME=/tmp/nts-test cargo run -- init
NTS_HOME=/tmp/nts-test cargo run -- push "keep me"
NTS_HOME=/tmp/nts-test cargo run -- push "ack me"
# Note the IDs from output, then:
# NTS_HOME=/tmp/nts-test cargo run -- ack <id>
# NTS_HOME=/tmp/nts-test cargo run -- delete <id>
NTS_HOME=/tmp/nts-test cargo run -- list
rm -rf /tmp/nts-test
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/ack.rs src/commands/delete.rs src/commands/purge.rs
git commit -m "feat: implement ack, delete, and purge commands"
```

---

### Task 11: Implement `nts search`

**Files:**
- Modify: `src/commands/search.rs`

- [ ] **Step 1: Implement search**

Replace `src/commands/search.rs`:

```rust
use super::load_context;
use crate::index::MessageStatus;
use crate::storage::Storage;
use colored::Colorize;
use anyhow::Result;

pub fn run(query: &str) -> Result<()> {
    let (store, mut index, identity, _recipient) = load_context()?;
    index.enforce_ttl();

    let query_lower = query.to_lowercase();
    let mut matches = vec![];

    for entry in &index.messages {
        if entry.status == MessageStatus::Expired {
            continue;
        }

        let blob_key = format!("messages/{}.age", entry.id);
        if let Ok(encrypted) = store.read_blob(&blob_key) {
            if let Ok(decrypted) = crate::crypto::decrypt(&encrypted, &identity) {
                if let Ok(msg) = serde_json::from_slice::<crate::message::Message>(&decrypted) {
                    if msg.content.to_lowercase().contains(&query_lower) {
                        matches.push((entry.clone(), msg.content));
                    }
                }
            }
        }
    }

    if matches.is_empty() {
        println!("No messages matching \"{query}\".");
        return Ok(());
    }

    println!("{} match(es) for \"{}\":\n", matches.len(), query.bold());

    for (entry, content) in &matches {
        println!(
            "  {} [{}] {}",
            entry.id.dimmed(),
            entry.status,
            entry.created_at.format("%Y-%m-%d %H:%M")
        );
        // Highlight match in content
        let highlighted = content.replace(
            query,
            &format!("{}", query.bold().underline()),
        );
        println!("  {highlighted}\n");
    }

    Ok(())
}
```

- [ ] **Step 2: Test manually**

```bash
NTS_HOME=/tmp/nts-test cargo run -- init
NTS_HOME=/tmp/nts-test cargo run -- push "my api key is abc123"
NTS_HOME=/tmp/nts-test cargo run -- push "meeting at 3pm"
NTS_HOME=/tmp/nts-test cargo run -- push "another api endpoint"
NTS_HOME=/tmp/nts-test cargo run -- search "api"
NTS_HOME=/tmp/nts-test cargo run -- search "nonexistent"
rm -rf /tmp/nts-test
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/search.rs
git commit -m "feat: implement nts search with case-insensitive matching"
```

---

### Task 12: Integration tests

**Files:**
- Create: `tests/integration.rs`

- [ ] **Step 1: Write integration tests**

Create `tests/integration.rs`:

```rust
use assert_cmd::Command;
use predicates::prelude::*;
use tempfile::TempDir;

fn nts(tmp: &TempDir) -> Command {
    let mut cmd = Command::cargo_bin("nts").unwrap();
    cmd.env("NTS_HOME", tmp.path());
    cmd
}

#[test]
fn test_init_creates_files() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    assert!(tmp.path().join("identity.txt").exists());
    assert!(tmp.path().join("recipients.txt").exists());
    assert!(tmp.path().join("config.toml").exists());
    assert!(tmp.path().join("messages").exists());
}

#[test]
fn test_init_twice_fails() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp)
        .arg("init")
        .assert()
        .failure()
        .stderr(predicate::str::contains("Already initialized"));
}

#[test]
fn test_push_without_init_fails() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp)
        .args(["push", "hello"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("nts init"));
}

#[test]
fn test_push_and_peek() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp)
        .args(["push", "hello world"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Pushed:"));
    nts(&tmp)
        .arg("peek")
        .assert()
        .success()
        .stdout(predicate::str::contains("hello world"));
}

#[test]
fn test_push_and_pop() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp).args(["push", "msg one"]).assert().success();
    nts(&tmp).args(["push", "msg two"]).assert().success();

    // Pop returns latest (msg two)
    nts(&tmp)
        .arg("pop")
        .assert()
        .success()
        .stdout(predicate::str::contains("msg two"));

    // Next peek returns msg one
    nts(&tmp)
        .arg("peek")
        .assert()
        .success()
        .stdout(predicate::str::contains("msg one"));
}

#[test]
fn test_list() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp)
        .args(["push", "tagged", "--tag", "work"])
        .assert()
        .success();
    nts(&tmp).args(["push", "untagged"]).assert().success();

    nts(&tmp)
        .arg("list")
        .assert()
        .success()
        .stdout(predicate::str::contains("tagged"))
        .stdout(predicate::str::contains("untagged"));

    nts(&tmp)
        .args(["list", "--tag", "work"])
        .assert()
        .success()
        .stdout(predicate::str::contains("tagged"))
        .stdout(predicate::str::contains("untagged").not());
}

#[test]
fn test_search() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp)
        .args(["push", "my secret api key"])
        .assert()
        .success();
    nts(&tmp)
        .args(["push", "meeting tomorrow"])
        .assert()
        .success();

    nts(&tmp)
        .args(["search", "api"])
        .assert()
        .success()
        .stdout(predicate::str::contains("api key"));

    nts(&tmp)
        .args(["search", "nonexistent"])
        .assert()
        .success()
        .stdout(predicate::str::contains("No messages matching"));
}

#[test]
fn test_delete() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    let output = nts(&tmp)
        .args(["push", "delete me"])
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let id = stdout.trim().strip_prefix("Pushed: ").unwrap();

    nts(&tmp)
        .args(["delete", id])
        .assert()
        .success()
        .stdout(predicate::str::contains("Deleted:"));

    nts(&tmp)
        .arg("list")
        .assert()
        .success()
        .stdout(predicate::str::contains("No messages"));
}

#[test]
fn test_encrypted_at_rest() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp)
        .args(["push", "super secret message"])
        .assert()
        .success();

    // Read raw index file — should NOT contain plaintext
    let index_bytes = std::fs::read(tmp.path().join("index.age")).unwrap();
    let index_str = String::from_utf8_lossy(&index_bytes);
    assert!(!index_str.contains("super secret"));

    // Read raw message file — should NOT contain plaintext
    let msg_dir = tmp.path().join("messages");
    for entry in std::fs::read_dir(&msg_dir).unwrap() {
        let entry = entry.unwrap();
        let bytes = std::fs::read(entry.path()).unwrap();
        let content = String::from_utf8_lossy(&bytes);
        assert!(!content.contains("super secret"));
    }
}
```

- [ ] **Step 2: Run integration tests**

```bash
cargo test --test integration
```
Expected: all tests pass.

- [ ] **Step 3: Run all tests**

```bash
cargo test
```
Expected: all unit + integration tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration.rs
git commit -m "test: add integration tests for all nts commands"
```

---

### Task 13: Final cleanup and push

- [ ] **Step 1: Run clippy and fix any warnings**

```bash
cargo clippy -- -W clippy::all
```

Fix any warnings that appear.

- [ ] **Step 2: Format code**

```bash
cargo fmt
```

- [ ] **Step 3: Run full test suite one last time**

```bash
cargo test
```

- [ ] **Step 4: Manual smoke test of the full workflow**

```bash
NTS_HOME=/tmp/nts-smoke cargo run -- init
NTS_HOME=/tmp/nts-smoke cargo run -- push "first note" --tag work
NTS_HOME=/tmp/nts-smoke cargo run -- push "grab milk" --ttl 4h
echo "from clipboard" | NTS_HOME=/tmp/nts-smoke cargo run -- push --tag clipboard
NTS_HOME=/tmp/nts-smoke cargo run -- list
NTS_HOME=/tmp/nts-smoke cargo run -- peek
NTS_HOME=/tmp/nts-smoke cargo run -- pop
NTS_HOME=/tmp/nts-smoke cargo run -- list
NTS_HOME=/tmp/nts-smoke cargo run -- search "milk"
NTS_HOME=/tmp/nts-smoke cargo run -- purge --expired
rm -rf /tmp/nts-smoke
```

- [ ] **Step 5: Commit any fixes and push**

```bash
git add -A
git status
# If there are changes:
git commit -m "chore: clippy fixes and formatting"
git push origin main
```
