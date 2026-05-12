use crate::storage::Storage;
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const DEVICES_BLOB_KEY: &str = "devices.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceEntry {
    pub name: String,
    pub token_hash: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct DeviceList {
    #[serde(default)]
    pub devices: Vec<DeviceEntry>,
}

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
    if !storage.blob_exists(DEVICES_BLOB_KEY) {
        return Ok(DeviceList::default());
    }
    let bytes = storage.read_blob(DEVICES_BLOB_KEY)?;
    serde_json::from_slice(&bytes).context("Failed to parse devices.json")
}

pub fn save(storage: &dyn Storage, list: &DeviceList) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(list)?;
    storage.write_blob(DEVICES_BLOB_KEY, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::local::LocalStorage;
    use tempfile::TempDir;

    #[test]
    fn test_mint_token_is_unique() {
        let (t1, _) = mint_token();
        let (t2, _) = mint_token();
        assert_ne!(t1, t2);
        assert!(t1.starts_with("nts_"));
        assert_eq!(t1.len(), 4 + 64);
    }

    #[test]
    fn test_mint_token_hash_matches() {
        let (token, hash) = mint_token();
        assert_eq!(hash_token(&token), hash);
    }

    #[test]
    fn test_hash_token_is_deterministic() {
        assert_eq!(hash_token("nts_abc"), hash_token("nts_abc"));
        assert_ne!(hash_token("nts_abc"), hash_token("nts_abd"));
        assert_eq!(hash_token("nts_abc").len(), 64);
    }

    // Cross-language SHA-256 fixture: this exact (token, hash) pair is
    // duplicated in web/worker/test/worker.test.ts. If the Rust hash function
    // and the Worker's Web Crypto SHA-256 ever diverge, both sides fail.
    #[test]
    fn test_hash_token_matches_cross_language_fixture() {
        let token = "nts_known_fixture_token_v1";
        let expected = "44d40537bb51f5d5b161190e25fe3c81dd1a90b06a3ea58350f6f7fa00998920";
        assert_eq!(hash_token(token), expected);
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

    #[test]
    fn test_load_returns_empty_when_missing() {
        let tmp = TempDir::new().unwrap();
        let store = LocalStorage::new(tmp.path()).unwrap();
        let list = load(&store).unwrap();
        assert!(list.devices.is_empty());
    }

    #[test]
    fn test_save_then_load() {
        let tmp = TempDir::new().unwrap();
        let store = LocalStorage::new(tmp.path()).unwrap();

        let mut list = DeviceList::default();
        list.devices.push(DeviceEntry {
            name: "laptop".to_string(),
            token_hash: hash_token("nts_xyz"),
            created_at: Utc::now(),
        });
        save(&store, &list).unwrap();

        let back = load(&store).unwrap();
        assert_eq!(back.devices.len(), 1);
        assert_eq!(back.devices[0].name, "laptop");
    }
}
