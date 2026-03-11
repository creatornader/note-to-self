mod commands;
mod config;
mod crypto;
mod display;
mod helpers;
mod index;
mod merge;
mod message;
mod storage;
mod sync;
mod sync_state;

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
    /// Manage configuration
    #[command(subcommand)]
    Config(ConfigCommands),
    /// Export identity and config for device bootstrapping
    Export {
        /// Encrypt the bundle with a passphrase
        #[arg(long)]
        passphrase: bool,
    },
    /// Import identity and config from an export bundle
    Import {
        /// Path to the export bundle file
        file: String,
        /// Bundle is passphrase-encrypted
        #[arg(long)]
        passphrase: bool,
    },
    /// Show sync status
    Status,
    /// Force sync with R2
    Sync,
}

#[derive(Subcommand)]
enum ConfigCommands {
    /// Get a config value
    Get {
        /// Config key (e.g., storage.backend, storage.r2.bucket)
        key: String,
    },
    /// Set a config value
    Set {
        /// Config key
        key: String,
        /// Config value
        value: String,
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
        Commands::Config(cmd) => match cmd {
            ConfigCommands::Get { key } => commands::config_cmd::run_get(&key),
            ConfigCommands::Set { key, value } => commands::config_cmd::run_set(&key, &value),
        },
        Commands::Export { passphrase } => commands::export::run(passphrase),
        Commands::Import { file, passphrase } => commands::import::run(&file, passphrase),
        Commands::Status => commands::status::run(),
        Commands::Sync => commands::sync_cmd::run(),
    };

    if let Err(e) = result {
        eprintln!("Error: {e:#}");
        std::process::exit(1);
    }
}
