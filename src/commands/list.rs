use super::load_context;
use crate::index::MessageStatus;
use anyhow::Result;
use colored::Colorize;

pub fn run(tag: Option<String>, status: Option<String>) -> Result<()> {
    let (_store, mut index, _identity, _recipient) = load_context()?;
    index.enforce_ttl();

    let status_filter: Option<MessageStatus> = match status.as_deref() {
        Some("unread") => Some(MessageStatus::Unread),
        Some("read") => Some(MessageStatus::Read),
        Some("consumed") => Some(MessageStatus::Consumed),
        Some("expired") => Some(MessageStatus::Expired),
        Some(s) => anyhow::bail!("Unknown status: {s}. Use: unread, read, consumed, expired"),
        None => None,
    };

    let filtered: Vec<_> = index
        .messages
        .iter()
        .filter(|e| {
            if let Some(ref t) = tag
                && !e.tags.contains(t)
            {
                return false;
            }
            if let Some(ref s) = status_filter
                && &e.status != s
            {
                return false;
            }
            true
        })
        .collect();

    if filtered.is_empty() {
        println!("No messages found.");
        return Ok(());
    }

    // Print header
    println!(
        "  {:<30} {:<10} {:<15} {}",
        "ID".bold(),
        "STATUS".bold(),
        "TAGS".bold(),
        "PREVIEW".bold()
    );

    for entry in &filtered {
        let status_str = match entry.status {
            MessageStatus::Unread => entry.status.to_string().yellow().to_string(),
            MessageStatus::Read => entry.status.to_string().green().to_string(),
            MessageStatus::Consumed => entry.status.to_string().dimmed().to_string(),
            MessageStatus::Expired => entry.status.to_string().red().to_string(),
        };
        let tags_str = if entry.tags.is_empty() {
            String::new()
        } else {
            entry.tags.join(", ")
        };
        let mut preview = entry.content_preview.clone();
        if let Some(expires) = entry.expires_at {
            let now = chrono::Utc::now();
            if expires > now {
                let remaining = expires - now;
                let hours = remaining.num_hours();
                let mins = remaining.num_minutes() % 60;
                preview = format!("{preview} (expires in {hours}h {mins}m)");
            }
        }
        println!(
            "  {:<30} {:<10} {:<15} {}",
            entry.id, status_str, tags_str, preview
        );
    }

    println!("\n  {} message(s)", filtered.len());
    Ok(())
}
