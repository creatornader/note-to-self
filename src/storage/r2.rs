use super::{Storage, WriteResult};
use anyhow::{Context, Result};
use http::header::{IF_MATCH, IF_NONE_MATCH};
use s3::creds::Credentials;
use s3::region::Region;
use s3::Bucket;
use tokio::runtime::Runtime as TokioRuntime;

pub struct R2Storage {
    bucket: Box<Bucket>,
    runtime: TokioRuntime,
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

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .context("Failed to create tokio runtime")?;

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
        let etag = response.headers().get("etag").cloned();
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
        let mut custom_headers = http::HeaderMap::new();
        if let Some(etag) = expected_etag {
            custom_headers.insert(IF_MATCH, etag.parse().context("Invalid ETag header value")?);
        }
        if if_none_match {
            custom_headers.insert(IF_NONE_MATCH, "*".parse().unwrap());
        }

        let bucket_with_headers = self
            .bucket
            .with_extra_headers(custom_headers)
            .context("Failed to set conditional headers")?;

        let result = self
            .runtime
            .block_on(bucket_with_headers.put_object(key, data));

        match result {
            Ok(_) => Ok(WriteResult::Success { etag: None }),
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
