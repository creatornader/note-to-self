use crate::helpers::{generate_id, parse_duration};
use crate::index::{IndexEntry, MessageStatus};
use crate::message::Message;
use crate::notify;
use crate::storage::Storage;
use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use std::io::{self, Read};

pub fn run(content: Option<String>, tags: Vec<String>, ttl: Option<String>, priority: Option<String>, quiet: bool) -> Result<()> {
    let content = match content {
        Some(c) => c,
        None => {
            let mut buf = String::new();
            if std::io::IsTerminal::is_terminal(&io::stdin()) {
                anyhow::bail!("No message provided. Usage: nts push \"your message\"");
            }
            io::stdin()
                .read_to_string(&mut buf)
                .context("Failed to read from stdin")?;
            let trimmed = buf.trim().to_string();
            if trimmed.is_empty() {
                anyhow::bail!("Empty message from stdin");
            }
            trimmed
        }
    };

    let mut ctx = super::load_context()?;

    // Enforce TTL on existing messages while we have the index open
    ctx.index.enforce_ttl();

    let id = generate_id();

    // Parse TTL
    let (ttl_seconds, expires_at) = match &ttl {
        Some(ttl_str) => {
            let secs = parse_duration(ttl_str).map_err(|e| anyhow::anyhow!("Invalid TTL: {e}"))?;
            let expires = Utc::now() + Duration::seconds(secs as i64);
            (Some(secs), Some(expires))
        }
        None => (None, None),
    };

    // Create message
    let msg = Message::new(id.clone(), content, tags.clone());
    let msg_json = serde_json::to_string_pretty(&msg)?;
    let encrypted = crate::crypto::encrypt(msg_json.as_bytes(), &ctx.recipient)?;

    // Store encrypted message blob
    let blob_key = format!("messages/{id}.age");
    ctx.store.write_blob(&blob_key, &encrypted)?;

    // Clone tags for notification before moving into IndexEntry
    let notify_tags = tags.clone();

    // Add to index
    let entry = IndexEntry {
        id: id.clone(),
        created_at: msg.created_at,
        tags,
        ttl_seconds,
        expires_at,
        status: MessageStatus::Unread,
        content_preview: msg.preview(80),
    };
    ctx.index.add_entry(entry);

    // Sync: upload blob to R2 if enabled
    if crate::sync::is_sync_enabled(&ctx.config) {
        let blob_data = ctx.store.read_blob(&blob_key)?;
        if !crate::sync::push_blob(&blob_key, &blob_data, &ctx.config).unwrap_or(false) {
            ctx.sync_state.pending_ids.insert(id.clone());
        }
    }
    super::save_and_sync(&mut ctx)?;

    println!("Pushed: {id}");

    // Send notification if configured and not suppressed
    if !quiet {
        let prio = priority.and_then(|p| notify::Priority::from_str(&p));
        notify::send(&ctx.config, &id, &notify_tags, &ttl, prio);
    }

    Ok(())
}
