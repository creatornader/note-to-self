use super::{load_context, save_index};
use crate::storage::Storage;
use anyhow::Result;

pub fn run(id: &str) -> Result<()> {
    let (store, mut index, _identity, recipient) = load_context()?;

    if !index.remove_by_id(id) {
        anyhow::bail!("Message not found: {id}");
    }

    // Delete the blob
    let blob_key = format!("messages/{id}.age");
    store.delete_blob(&blob_key)?;

    save_index(&store, &index, &recipient)?;

    println!("Deleted: {id}");
    Ok(())
}
