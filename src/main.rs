mod commands;
mod config;
mod crypto;
mod display;
mod helpers;
mod index;
mod merge;
mod message;
mod storage;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "nts",
    about = "Note to Self — encrypted personal message queue"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize nts (generate keypair, create data directory)
    Init,
    /// Push a new message
    Push {
        /// Message content (reads from stdin if omitted)
        content: Option<String>,
        /// Tags for the message
        #[arg(long, short)]
        tag: Vec<String>,
        /// Time-to-live (e.g., 30m, 4h, 7d)
        #[arg(long)]
        ttl: Option<String>,
    },
    /// Show the latest unread message without marking it
    Peek,
    /// Show the latest unread message and mark it consumed
    Pop,
    /// List all messages
    List {
        /// Filter by tag
        #[arg(long)]
        tag: Option<String>,
        /// Filter by status (unread, read, consumed, expired)
        #[arg(long)]
        status: Option<String>,
    },
    /// Show a specific message by ID
    Show {
        /// Message ID
        id: String,
    },
    /// Mark a message as read
    Ack {
        /// Message ID
        id: String,
    },
    /// Delete a message permanently
    Delete {
        /// Message ID
        id: String,
    },
    /// Clean up expired messages
    Purge {
        /// Remove expired messages
        #[arg(long)]
        expired: bool,
    },
    /// Search messages by content
    Search {
        /// Search query
        query: String,
    },
}

fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Init => commands::init::run(),
        Commands::Push { content, tag, ttl } => commands::push::run(content, tag, ttl),
        Commands::Peek => commands::peek::run(),
        Commands::Pop => commands::pop::run(),
        Commands::List { tag, status } => commands::list::run(tag, status),
        Commands::Show { id } => commands::show::run(&id),
        Commands::Ack { id } => commands::ack::run(&id),
        Commands::Delete { id } => commands::delete::run(&id),
        Commands::Purge { expired } => commands::purge::run(expired),
        Commands::Search { query } => commands::search::run(&query),
    };

    if let Err(e) = result {
        eprintln!("Error: {e:#}");
        std::process::exit(1);
    }
}
