use crate::index::MessageStatus;
use crate::storage::Storage;
use anyhow::Result;

pub fn run(expired: bool) -> Result<()> {
    if !expired {
        anyhow::bail!("Usage: nts purge --expired");
    }

    let mut ctx = super::load_context()?;
    ctx.index.enforce_ttl();

    let expired_ids: Vec<String> = ctx
        .index
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
        ctx.store.delete_blob(&blob_key)?;
        ctx.index.remove_by_id(id);

        if crate::sync::is_sync_enabled(&ctx.config) {
            if !crate::sync::delete_blob(&format!("messages/{id}.age"), &ctx.config)
                .unwrap_or(false)
            {
                ctx.sync_state.pending_deletes.insert(id.to_string());
            }
        }
    }

    super::save_and_sync(&mut ctx)?;

    println!("Purged {count} expired message(s).");
    Ok(())
}
