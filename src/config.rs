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
