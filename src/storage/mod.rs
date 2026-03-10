pub mod local;

use anyhow::Result;

pub trait Storage {
    fn read_blob(&self, key: &str) -> Result<Vec<u8>>;
    fn write_blob(&self, key: &str, data: &[u8]) -> Result<()>;
    fn delete_blob(&self, key: &str) -> Result<()>;
    fn blob_exists(&self, key: &str) -> bool;
    fn list_blobs(&self, prefix: &str) -> Result<Vec<String>>;
}
