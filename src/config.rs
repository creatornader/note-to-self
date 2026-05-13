use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NtfyConfig {
    pub server: String,
    pub topic: String,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub token_env: Option<String>,
}

impl NtfyConfig {
    pub fn resolve_token(&self) -> Option<String> {
        // Returns None when neither side resolves; the caller treats that as
        // "no auth token" rather than an error. Per ntfy convention, public
        // topics work without a token at all.
        if self.token_env.is_some() || self.token.is_some() {
            crate::secret::resolve(
                self.token_env.as_deref(),
                self.token.as_deref(),
                "notify.ntfy.token",
            )
            .ok()
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotifyConfig {
    pub enabled: bool,
    pub backend: String,
    pub ntfy: Option<NtfyConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub storage: StorageConfig,
    #[serde(default)]
    pub notify: Option<NotifyConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct R2Config {
    pub bucket: String,
    pub endpoint: String,
    #[serde(default)]
    pub access_key_id: String,
    #[serde(default)]
    pub secret_access_key: String,
    #[serde(default)]
    pub access_key_id_env: Option<String>,
    #[serde(default)]
    pub secret_access_key_env: Option<String>,
}

impl R2Config {
    pub fn resolve_access_key_id(&self) -> Result<String> {
        crate::secret::resolve(
            self.access_key_id_env.as_deref(),
            Some(self.access_key_id.as_str()),
            "storage.r2.access_key_id",
        )
    }
    pub fn resolve_secret_access_key(&self) -> Result<String> {
        crate::secret::resolve(
            self.secret_access_key_env.as_deref(),
            Some(self.secret_access_key.as_str()),
            "storage.r2.secret_access_key",
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    pub backend: String,
    pub path: String,
    pub r2: Option<R2Config>,
    #[serde(default)]
    pub worker_base_url: Option<String>,
    #[serde(default)]
    pub pwa_base_url: Option<String>,
}

impl Config {
    pub fn default_with_path(data_dir: &Path) -> Self {
        Self {
            storage: StorageConfig {
                backend: "local".to_string(),
                path: data_dir.to_string_lossy().to_string(),
                r2: None,
                worker_base_url: None,
                pwa_base_url: None,
            },
            notify: None,
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
            "storage.worker_base_url" => self.storage.worker_base_url.clone(),
            "storage.pwa_base_url" => self.storage.pwa_base_url.clone(),
            "storage.r2.bucket" => self.storage.r2.as_ref().map(|r| r.bucket.clone()),
            "storage.r2.endpoint" => self.storage.r2.as_ref().map(|r| r.endpoint.clone()),
            "storage.r2.access_key_id" => {
                self.storage.r2.as_ref().map(|r| r.access_key_id.clone())
            }
            "storage.r2.secret_access_key" => {
                self.storage.r2.as_ref().map(|r| r.secret_access_key.clone())
            }
            "storage.r2.access_key_id_env" => self
                .storage
                .r2
                .as_ref()
                .and_then(|r| r.access_key_id_env.clone()),
            "storage.r2.secret_access_key_env" => self
                .storage
                .r2
                .as_ref()
                .and_then(|r| r.secret_access_key_env.clone()),
            "notify.enabled" => self.notify.as_ref().map(|n| n.enabled.to_string()),
            "notify.backend" => self.notify.as_ref().map(|n| n.backend.clone()),
            "notify.ntfy.server" => self.notify.as_ref().and_then(|n| n.ntfy.as_ref()).map(|f| f.server.clone()),
            "notify.ntfy.topic" => self.notify.as_ref().and_then(|n| n.ntfy.as_ref()).map(|f| f.topic.clone()),
            "notify.ntfy.token" => self.notify.as_ref().and_then(|n| n.ntfy.as_ref()).and_then(|f| f.token.clone()),
            "notify.ntfy.token_env" => self
                .notify
                .as_ref()
                .and_then(|n| n.ntfy.as_ref())
                .and_then(|f| f.token_env.clone()),
            _ => None,
        }
    }

    pub fn set(&mut self, key: &str, value: &str) -> Result<()> {
        match key {
            "storage.backend" => self.storage.backend = value.to_string(),
            "storage.path" => self.storage.path = value.to_string(),
            "storage.worker_base_url" => self.storage.worker_base_url = Some(value.to_string()),
            "storage.pwa_base_url" => self.storage.pwa_base_url = Some(value.to_string()),
            k if k.starts_with("storage.r2.") => {
                let r2 = self.storage.r2.get_or_insert(R2Config {
                    bucket: String::new(),
                    endpoint: String::new(),
                    access_key_id: String::new(),
                    secret_access_key: String::new(),
                    access_key_id_env: None,
                    secret_access_key_env: None,
                });
                match k {
                    "storage.r2.bucket" => r2.bucket = value.to_string(),
                    "storage.r2.endpoint" => r2.endpoint = value.to_string(),
                    "storage.r2.access_key_id" => r2.access_key_id = value.to_string(),
                    "storage.r2.secret_access_key" => r2.secret_access_key = value.to_string(),
                    "storage.r2.access_key_id_env" => {
                        r2.access_key_id_env = Some(value.to_string())
                    }
                    "storage.r2.secret_access_key_env" => {
                        r2.secret_access_key_env = Some(value.to_string())
                    }
                    _ => anyhow::bail!("Unknown config key: {k}"),
                }
            }
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
                    token_env: None,
                });
                match k {
                    "notify.ntfy.server" => ntfy.server = value.to_string(),
                    "notify.ntfy.topic" => ntfy.topic = value.to_string(),
                    "notify.ntfy.token" => ntfy.token = Some(value.to_string()),
                    "notify.ntfy.token_env" => ntfy.token_env = Some(value.to_string()),
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
            access_key_id_env: None,
            secret_access_key_env: None,
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
            access_key_id_env: None,
            secret_access_key_env: None,
        });
        cfg.storage.worker_base_url = Some("https://my-worker.workers.dev".to_string());
        cfg.storage.pwa_base_url = Some("https://my-pwa.pages.dev".to_string());

        assert_eq!(cfg.get("storage.backend").unwrap(), "local");
        assert_eq!(cfg.get("storage.r2.bucket").unwrap(), "test-bucket");
        assert_eq!(
            cfg.get("storage.worker_base_url").unwrap(),
            "https://my-worker.workers.dev"
        );
        assert_eq!(
            cfg.get("storage.pwa_base_url").unwrap(),
            "https://my-pwa.pages.dev"
        );
        assert!(cfg.get("nonexistent").is_none());
    }

    #[test]
    fn test_config_set_dotted_key() {
        let mut cfg = Config::default_with_path(Path::new("/tmp"));
        cfg.set("storage.backend", "r2").unwrap();
        assert_eq!(cfg.storage.backend, "r2");

        cfg.set("storage.r2.bucket", "my-bucket").unwrap();
        assert_eq!(cfg.storage.r2.as_ref().unwrap().bucket, "my-bucket");

        cfg.set("storage.pwa_base_url", "https://my-pwa.pages.dev")
            .unwrap();
        assert_eq!(
            cfg.storage.pwa_base_url.as_deref().unwrap(),
            "https://my-pwa.pages.dev"
        );
    }

    #[test]
    fn test_config_mask_secrets() {
        let cfg_val = "my-secret-access-key-12345";
        assert_eq!(Config::mask_secret(cfg_val), "my-s...2345");
    }

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
                token_env: None,
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
                token_env: None,
            }),
        });
        assert_eq!(cfg.get("notify.enabled").unwrap(), "true");
        assert_eq!(cfg.get("notify.ntfy.topic").unwrap(), "test-topic");
        assert_eq!(cfg.get("notify.ntfy.token").unwrap(), "tk_secret");
    }
}
