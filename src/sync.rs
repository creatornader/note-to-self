use crate::config::Config;
use crate::crypto;
use crate::index::Index;
use crate::merge;
use crate::storage::r2::R2Storage;
use crate::storage::{Storage, WriteResult};
use crate::sync_state::SyncState;
use anyhow::{Context, Result};

const MAX_ETAG_RETRIES: u32 = 3;

/// Result of a sync pull operation.
pub struct PullResult {
    pub merged_index: Index,
    pub sync_state: SyncState,
    pub was_online: bool,
}

/// Pull remote index, merge with local, return merged result.
/// Does NOT save anything — caller decides what to persist.
pub fn pull(
    local_index: &Index,
    config: &Config,
    sync_state: &SyncState,
    identity: &age::x25519::Identity,
) -> PullResult {
    let r2 = match create_r2_storage(config) {
        Ok(r2) => r2,
        Err(e) => {
            eprintln!("Offline — working from local cache ({e:#})");
            return PullResult {
                merged_index: local_index.clone(),
                sync_state: sync_state.clone(),
                was_online: false,
            };
        }
    };

    match r2.read_blob_with_etag("index.age") {
        Ok((encrypted_index, etag)) => {
            match crypto::decrypt(&encrypted_index, identity) {
                Ok(decrypted) => {
                    match serde_json::from_slice::<Index>(&decrypted) {
                        Ok(remote_index) => {
                            let merged = merge::merge(
                                local_index,
                                &remote_index,
                                &sync_state.pending_ids,
                                &sync_state.pending_deletes,
                            );
                            let mut new_state = sync_state.clone();
                            new_state.remote_etag = etag;
                            new_state.last_sync = Some(chrono::Utc::now());
                            PullResult {
                                merged_index: merged,
                                sync_state: new_state,
                                was_online: true,
                            }
                        }
                        Err(e) => {
                            eprintln!("Remote index unreadable — working from local cache. Run `nts sync` to retry ({e})");
                            PullResult {
                                merged_index: local_index.clone(),
                                sync_state: sync_state.clone(),
                                was_online: false,
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Remote index unreadable — working from local cache. Run `nts sync` to retry ({e})");
                    PullResult {
                        merged_index: local_index.clone(),
                        sync_state: sync_state.clone(),
                        was_online: false,
                    }
                }
            }
        }
        Err(_) => {
            // No remote index yet — first sync from this device
            PullResult {
                merged_index: local_index.clone(),
                sync_state: sync_state.clone(),
                was_online: true,
            }
        }
    }
}

/// Push the updated index to R2 with ETag-based optimistic locking.
/// Retries up to MAX_ETAG_RETRIES times on precondition failure.
pub fn push_index(
    index: &Index,
    config: &Config,
    sync_state: &mut SyncState,
    identity: &age::x25519::Identity,
    recipient: &age::x25519::Recipient,
) -> Result<bool> {
    let r2 = match create_r2_storage(config) {
        Ok(r2) => r2,
        Err(e) => {
            eprintln!("Offline — changes saved locally ({e:#})");
            return Ok(false);
        }
    };

    let json = serde_json::to_string_pretty(index)?;
    let encrypted = crypto::encrypt(json.as_bytes(), recipient)?;

    for attempt in 0..MAX_ETAG_RETRIES {
        let result = r2.write_blob_conditional(
            "index.age",
            &encrypted,
            sync_state.remote_etag.as_deref(),
            sync_state.remote_etag.is_none(),
        )?;

        match result {
            WriteResult::Success { etag } => {
                if let Some(new_etag) = etag {
                    sync_state.remote_etag = Some(new_etag);
                }
                sync_state.last_sync = Some(chrono::Utc::now());
                return Ok(true);
            }
            WriteResult::PreconditionFailed => {
                if attempt + 1 < MAX_ETAG_RETRIES {
                    eprintln!(
                        "Index was modified remotely — re-merging (attempt {}/{})",
                        attempt + 2,
                        MAX_ETAG_RETRIES
                    );
                    // Re-pull, re-merge, re-encrypt, and retry
                    let pull_result = pull(index, config, sync_state, identity);
                    sync_state.remote_etag = pull_result.sync_state.remote_etag.clone();

                    let new_json = serde_json::to_string_pretty(&pull_result.merged_index)?;
                    let new_encrypted = crypto::encrypt(new_json.as_bytes(), recipient)?;

                    let retry_result = r2.write_blob_conditional(
                        "index.age",
                        &new_encrypted,
                        sync_state.remote_etag.as_deref(),
                        false,
                    )?;

                    match retry_result {
                        WriteResult::Success { etag } => {
                            if let Some(new_etag) = etag {
                                sync_state.remote_etag = Some(new_etag);
                            }
                            sync_state.last_sync = Some(chrono::Utc::now());
                            return Ok(true);
                        }
                        WriteResult::PreconditionFailed => continue,
                    }
                }
            }
        }
    }

    eprintln!("Warning: Could not sync index after {MAX_ETAG_RETRIES} attempts — changes saved locally");
    Ok(false)
}

/// Upload a message blob to R2.
pub fn push_blob(key: &str, data: &[u8], config: &Config) -> Result<bool> {
    let r2 = match create_r2_storage(config) {
        Ok(r2) => r2,
        Err(_) => return Ok(false),
    };
    r2.write_blob(key, data)?;
    Ok(true)
}

/// Delete a message blob from R2.
pub fn delete_blob(key: &str, config: &Config) -> Result<bool> {
    let r2 = match create_r2_storage(config) {
        Ok(r2) => r2,
        Err(_) => return Ok(false),
    };
    r2.delete_blob(key)?;
    Ok(true)
}

/// Push all pending changes (called by `nts sync`).
pub fn push_pending(
    index: &Index,
    local_store: &dyn Storage,  // needed to read pending blobs
    config: &Config,
    sync_state: &mut SyncState,
    identity: &age::x25519::Identity,
    recipient: &age::x25519::Recipient,
) -> Result<()> {
    let r2 = match create_r2_storage(config) {
        Ok(r2) => r2,
        Err(e) => {
            anyhow::bail!("Cannot sync — R2 unreachable: {e:#}");
        }
    };

    // Upload pending message blobs
    let uploaded: Vec<String> = sync_state
        .pending_ids
        .iter()
        .filter_map(|id| {
            let blob_key = format!("messages/{id}.age");
            match local_store.read_blob(&blob_key) {
                Ok(data) => match r2.write_blob(&blob_key, &data) {
                    Ok(_) => Some(id.clone()),
                    Err(e) => {
                        eprintln!("Warning: failed to upload {blob_key}: {e}");
                        None
                    }
                },
                Err(_) => {
                    // Blob might have been deleted locally already
                    Some(id.clone())
                }
            }
        })
        .collect();

    for id in &uploaded {
        sync_state.pending_ids.remove(id);
    }

    // Delete pending remote blobs
    let deleted: Vec<String> = sync_state
        .pending_deletes
        .iter()
        .filter_map(|id| {
            let blob_key = format!("messages/{id}.age");
            match r2.delete_blob(&blob_key) {
                Ok(_) => Some(id.clone()),
                Err(e) => {
                    eprintln!("Warning: failed to delete remote {blob_key}: {e}");
                    None
                }
            }
        })
        .collect();

    for id in &deleted {
        sync_state.pending_deletes.remove(id);
    }

    // Push the index
    push_index(index, config, sync_state, identity, recipient)?;

    Ok(())
}

fn create_r2_storage(config: &Config) -> Result<R2Storage> {
    let r2_config = config
        .storage
        .r2
        .as_ref()
        .context("R2 not configured — run `nts config set storage.r2.bucket <bucket>` etc.")?;

    R2Storage::new(
        &r2_config.bucket,
        &r2_config.endpoint,
        &r2_config.access_key_id,
        &r2_config.secret_access_key,
    )
}

/// Check if sync is enabled (backend is "r2" and R2 config exists).
pub fn is_sync_enabled(config: &Config) -> bool {
    config.storage.backend == "r2" && config.storage.r2.is_some()
}
