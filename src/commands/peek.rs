use super::load_context;
use crate::display;
use crate::storage::Storage;
use anyhow::Result;

pub fn run() -> Result<()> {
    let (store, mut index, identity, _recipient) = load_context()?;
    index.enforce_ttl();

    let entry = index
        .latest_unread()
        .ok_or_else(|| anyhow::anyhow!("No unread messages. Push one with: nts push \"hello\""))?
        .clone();

    // Decrypt message content
    let blob_key = format!("messages/{}.age", entry.id);
    let encrypted = store.read_blob(&blob_key)?;
    let decrypted = crate::crypto::decrypt(&encrypted, &identity)?;
    let msg: crate::message::Message = serde_json::from_slice(&decrypted)?;

    display::print_message_detail(&entry, &msg.content);
    Ok(())
}
