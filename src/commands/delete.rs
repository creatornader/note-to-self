use crate::storage::Storage;
use anyhow::Result;

pub fn run(id: &str) -> Result<()> {
    let mut ctx = super::load_context()?;

    if !ctx.index.remove_by_id(id) {
        anyhow::bail!("Message not found: {id}");
    }

    // Delete the blob
    let blob_key = format!("messages/{id}.age");
    ctx.store.delete_blob(&blob_key)?;

    if crate::sync::is_sync_enabled(&ctx.config) {
        if !crate::sync::delete_blob(&format!("messages/{id}.age"), &ctx.config).unwrap_or(false) {
            ctx.sync_state.pending_deletes.insert(id.to_string());
        }
    }
    super::save_and_sync(&mut ctx)?;

    println!("Deleted: {id}");
    Ok(())
}
