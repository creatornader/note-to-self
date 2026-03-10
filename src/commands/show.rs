use super::load_context;
use crate::display;
use crate::storage::Storage;
use anyhow::Result;

pub fn run(id: &str) -> Result<()> {
    let (store, mut index, identity, _recipient) = load_context()?;
    index.enforce_ttl();

    let entry = index
        .find_by_id(id)
        .ok_or_else(|| anyhow::anyhow!("Message not found: {id}"))?
        .clone();

    let blob_key = format!("messages/{}.age", entry.id);
    let encrypted = store.read_blob(&blob_key)?;
    let decrypted = crate::crypto::decrypt(&encrypted, &identity)?;
    let msg: crate::message::Message = serde_json::from_slice(&decrypted)?;

    display::print_message_detail(&entry, &msg.content);
    Ok(())
}
