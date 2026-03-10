use super::{load_context, save_index};
use crate::display;
use crate::index::MessageStatus;
use crate::storage::Storage;
use anyhow::Result;

pub fn run() -> Result<()> {
    let (store, mut index, identity, recipient) = load_context()?;
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

    // Mark as consumed
    if let Some(e) = index.find_by_id_mut(&entry.id) {
        e.status = MessageStatus::Consumed;
    }
    save_index(&store, &index, &recipient)?;

    Ok(())
}
