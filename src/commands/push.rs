use super::{load_context, save_index};
use crate::helpers::{generate_id, parse_duration};
use crate::index::{IndexEntry, MessageStatus};
use crate::message::Message;
use crate::storage::Storage;
use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use std::io::{self, Read};

pub fn run(content: Option<String>, tags: Vec<String>, ttl: Option<String>) -> Result<()> {
    let content = match content {
        Some(c) => c,
        None => {
            let mut buf = String::new();
            if atty::is(atty::Stream::Stdin) {
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

    let (store, mut index, _identity, recipient) = load_context()?;

    // Enforce TTL on existing messages while we have the index open
    index.enforce_ttl();

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
    let encrypted = crate::crypto::encrypt(msg_json.as_bytes(), &recipient)?;

    // Store encrypted message blob
    let blob_key = format!("messages/{id}.age");
    store.write_blob(&blob_key, &encrypted)?;

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
    index.add_entry(entry);

    // Save encrypted index
    save_index(&store, &index, &recipient)?;

    println!("Pushed: {id}");
    Ok(())
}
