use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub storage: StorageConfig,
}

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

impl Config {
    pub fn default_with_path(data_dir: &Path) -> Self {
        Self {
            storage: StorageConfig {
                backend: "local".to_string(),
                path: data_dir.to_string_lossy().to_string(),
                r2: None,
            },
        }
    }

    pub fn load(path: &Path) -> Result<Self> {
        let content = fs::read_to_string(path)
            .with_context(|| format!("Failed to read config: {}", path.display()))?;
        toml::from_str(&content).context("Failed to parse config")
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let content = toml::to_string_pretty(self).context("Failed to serialize config")?;
        fs::write(path, content)
            .with_context(|| format!("Failed to write config: {}", path.display()))
    }

    pub fn data_dir(&self) -> PathBuf {
        PathBuf::from(shellexpand::tilde(&self.storage.path).to_string())
    }

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
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
}
