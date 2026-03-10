use super::load_context;
use crate::index::MessageStatus;
use crate::storage::Storage;
use anyhow::Result;
use colored::Colorize;

pub fn run(query: &str) -> Result<()> {
    let (store, mut index, identity, _recipient) = load_context()?;
    index.enforce_ttl();

    let query_lower = query.to_lowercase();
    let mut matches = vec![];

    for entry in &index.messages {
        if entry.status == MessageStatus::Expired {
            continue;
        }

        let blob_key = format!("messages/{}.age", entry.id);
        if let Ok(encrypted) = store.read_blob(&blob_key)
            && let Ok(decrypted) = crate::crypto::decrypt(&encrypted, &identity)
            && let Ok(msg) = serde_json::from_slice::<crate::message::Message>(&decrypted)
            && msg.content.to_lowercase().contains(&query_lower)
        {
            matches.push((entry.clone(), msg.content));
        }
    }

    if matches.is_empty() {
        println!("No messages matching \"{query}\".");
        return Ok(());
    }

    println!("{} match(es) for \"{}\":\n", matches.len(), query.bold());

    for (entry, content) in &matches {
        println!(
            "  {} [{}] {}",
            entry.id.dimmed(),
            entry.status,
            entry.created_at.format("%Y-%m-%d %H:%M")
        );
        // Highlight match in content
        let highlighted = content.replace(query, &format!("{}", query.bold().underline()));
        println!("  {highlighted}\n");
    }

    Ok(())
}
