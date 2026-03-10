use super::{load_context, save_index};
use crate::index::MessageStatus;
use anyhow::Result;

pub fn run(id: &str) -> Result<()> {
    let (store, mut index, _identity, recipient) = load_context()?;
    index.enforce_ttl();

    let entry = index
        .find_by_id_mut(id)
        .ok_or_else(|| anyhow::anyhow!("Message not found: {id}"))?;

    entry.status = MessageStatus::Read;
    save_index(&store, &index, &recipient)?;

    println!("Marked as read: {id}");
    Ok(())
}
