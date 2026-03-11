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
