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
