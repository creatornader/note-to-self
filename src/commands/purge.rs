use super::{load_context, save_index};
use crate::index::MessageStatus;
use crate::storage::Storage;
use anyhow::Result;

pub fn run(expired: bool) -> Result<()> {
    if !expired {
        anyhow::bail!("Usage: nts purge --expired");
    }

    let (store, mut index, _identity, recipient) = load_context()?;
    index.enforce_ttl();

    let expired_ids: Vec<String> = index
        .messages
        .iter()
        .filter(|e| e.status == MessageStatus::Expired)
        .map(|e| e.id.clone())
        .collect();

    if expired_ids.is_empty() {
        println!("No expired messages to purge.");
        return Ok(());
    }

    let count = expired_ids.len();
    for id in &expired_ids {
        let blob_key = format!("messages/{id}.age");
        store.delete_blob(&blob_key)?;
        index.remove_by_id(id);
    }

    save_index(&store, &index, &recipient)?;

    println!("Purged {count} expired message(s).");
    Ok(())
}
