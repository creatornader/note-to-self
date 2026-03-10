use crate::index::IndexEntry;
use colored::Colorize;

pub fn print_message_detail(entry: &IndexEntry, content: &str) {
    println!(
        "{}",
        "─── Note to Self ───────────────────────────────".dimmed()
    );
    println!("  {}: {}", "ID".bold(), entry.id);
    if !entry.tags.is_empty() {
        println!("  {}: {}", "Tags".bold(), entry.tags.join(", "));
    }
    println!("  {}: {}", "Status".bold(), entry.status);
    println!(
        "  {}: {}",
        "Created".bold(),
        entry.created_at.format("%Y-%m-%d %H:%M:%S %Z")
    );
    if let Some(expires) = entry.expires_at {
        let now = chrono::Utc::now();
        if expires > now {
            let remaining = expires - now;
            let hours = remaining.num_hours();
            let mins = remaining.num_minutes() % 60;
            println!("  {}: in {}h {}m", "Expires".bold(), hours, mins);
        } else {
            println!("  {}: {}", "Expired".bold(), "yes".red());
        }
    }
    println!();
    println!("  {content}");
    println!(
        "{}",
        "────────────────────────────────────────────────".dimmed()
    );
}
