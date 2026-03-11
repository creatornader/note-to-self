use crate::index::MessageStatus;
use anyhow::Result;

pub fn run(id: &str) -> Result<()> {
    let mut ctx = super::load_context()?;
    ctx.index.enforce_ttl();

    let entry = ctx
        .index
        .find_by_id_mut(id)
        .ok_or_else(|| anyhow::anyhow!("Message not found: {id}"))?;

    entry.status = MessageStatus::Read;
    super::save_and_sync(&mut ctx)?;

    println!("Marked as read: {id}");
    Ok(())
}
