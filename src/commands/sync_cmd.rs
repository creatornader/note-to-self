use crate::commands;
use crate::sync;
use anyhow::Result;

pub fn run() -> Result<()> {
    let mut ctx = commands::load_context()?;

    if !sync::is_sync_enabled(&ctx.config) {
        println!("Sync is not enabled. Set backend to r2:");
        println!("  nts config set storage.backend r2");
        println!("  nts config set storage.r2.bucket <bucket>");
        println!("  nts config set storage.r2.endpoint <endpoint>");
        println!("  nts config set storage.r2.access_key_id <key>");
        println!("  nts config set storage.r2.secret_access_key <secret>");
        return Ok(());
    }

    ctx.index.enforce_ttl();

    println!("Syncing...");

    sync::push_pending(
        &ctx.index,
        &ctx.store,
        &ctx.config,
        &mut ctx.sync_state,
        &ctx.identity,
        &ctx.recipient,
    )?;

    ctx.sync_state.save(&ctx.data_dir)?;
    commands::save_index(&ctx.store, &ctx.index, &ctx.recipient)?;

    println!("Sync complete.");
    if ctx.sync_state.pending_ids.is_empty() && ctx.sync_state.pending_deletes.is_empty() {
        println!("All changes synchronized.");
    } else {
        println!(
            "Warning: {} change(s) still pending.",
            ctx.sync_state.pending_ids.len() + ctx.sync_state.pending_deletes.len()
        );
    }

    Ok(())
}
