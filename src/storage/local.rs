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
            if entry.file_type()?.is_file()
                && let Some(name) = entry.file_name().to_str()
            {
                keys.push(format!("{prefix}/{name}"));
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
        store.write_blob("messages/abc.age", b"encrypted").unwrap();
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
