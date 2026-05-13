pub mod ack;
pub mod config_cmd;
pub mod delete;
pub mod device;
pub mod export;
pub mod import;
pub mod init;
pub mod list;
pub mod notify_cmd;
pub mod peek;
pub mod pop;
pub mod purge;
pub mod push;
pub mod search;
pub mod show;
pub mod status;
pub mod sync_cmd;

use crate::config::Config;
use crate::crypto;
use crate::index::Index;
use crate::storage::local::LocalStorage;
use crate::storage::Storage;
use crate::sync;
use crate::sync_state::SyncState;
use anyhow::{Context, Result};
use std::path::PathBuf;

pub fn get_data_dir() -> Result<PathBuf> {
    if let Ok(home) = std::env::var("NTS_HOME") {
        return Ok(PathBuf::from(home));
    }
    let dirs = directories::ProjectDirs::from("", "", "nts")
        .context("Could not determine data directory")?;
    Ok(dirs.data_dir().to_path_buf())
}

pub struct AppContext {
    pub store: LocalStorage,
    pub index: Index,
    pub identity: age::x25519::Identity,
    pub recipient: age::x25519::Recipient,
    pub config: Config,
    pub sync_state: SyncState,
    pub data_dir: PathBuf,
}

pub fn load_context() -> Result<AppContext> {
    let data_dir = get_data_dir()?;
    let identity_path = data_dir.join("identity.txt");
    let recipients_path = data_dir.join("recipients.txt");
    let config_path = data_dir.join("config.toml");

    let identity_str = load_identity_string(&identity_path)?;
    let identity = crypto::parse_identity(identity_str.trim())?;

    let recipient_str =
        std::fs::read_to_string(&recipients_path).context("Failed to read recipients file")?;
    let recipient = crypto::parse_recipient(recipient_str.trim())?;

    let store = LocalStorage::new(&data_dir)?;

    let config = if config_path.exists() {
        Config::load(&config_path)?
    } else {
        Config::default_with_path(&data_dir)
    };

    let sync_state = SyncState::load(&data_dir)?;

    let mut index = if store.blob_exists("index.age") {
        let encrypted = store.read_blob("index.age")?;
        let decrypted = crypto::decrypt(&encrypted, &identity)?;
        serde_json::from_slice(&decrypted).context("Failed to parse index")?
    } else {
        Index::new()
    };

    // If sync is enabled, pull and merge
    let sync_state = if sync::is_sync_enabled(&config) {
        let pull_result = sync::pull(&index, &config, &sync_state, &identity);
        index = pull_result.merged_index;

        // Save merged index locally
        let _ = save_index(&store, &index, &recipient);
        let _ = pull_result.sync_state.save(&data_dir);

        pull_result.sync_state
    } else {
        sync_state
    };

    Ok(AppContext {
        store,
        index,
        identity,
        recipient,
        config,
        sync_state,
        data_dir,
    })
}

// Load the age secret identity string. Resolution order:
//   1. NTS_AGE_IDENTITY env var — shell-init typically seeds this from 1P
//   2. identity.txt on disk — legacy plaintext path, still the default
// The env-var path lets users delete the on-disk file after seeding 1P
// without losing the ability to run `nts push` etc.
pub fn load_identity_string(identity_path: &std::path::Path) -> Result<String> {
    // Sandboxed installs (NTS_HOME set explicitly) ALWAYS read identity.txt
    // from that home, never from NTS_AGE_IDENTITY. The env var is meant for
    // the primary install seeded via shell init from 1Password; pointing
    // NTS_HOME at a different directory is a strong signal that the user
    // wants an isolated identity for that install. Without this guard, a
    // developer running `NTS_HOME=/tmp/other nts init` would create a new
    // identity file but then every subsequent command would silently
    // encrypt with the real shell-env identity, causing key reuse across
    // nominally-distinct installs.
    let is_sandboxed_install = std::env::var("NTS_HOME").is_ok();

    if !is_sandboxed_install {
        if let Ok(env_val) = std::env::var("NTS_AGE_IDENTITY") {
            if !env_val.is_empty() {
                return Ok(env_val);
            }
        }
    }
    if !identity_path.exists() {
        if is_sandboxed_install {
            anyhow::bail!(
                "Not initialized at {}. Run `nts init` first.",
                identity_path.parent().unwrap_or(identity_path).display()
            );
        }
        anyhow::bail!(
            "Not initialized. Either run `nts init` first or set NTS_AGE_IDENTITY \
             in your shell environment (see docs/architecture.md for the 1Password \
             seeding pattern)."
        );
    }
    std::fs::read_to_string(identity_path).context("Failed to read identity file")
}

pub fn save_index(
    store: &dyn Storage,
    index: &Index,
    recipient: &age::x25519::Recipient,
) -> Result<()> {
    let json = serde_json::to_string_pretty(index)?;
    let encrypted = crypto::encrypt(json.as_bytes(), recipient)?;
    store.write_blob("index.age", &encrypted)
}

/// After mutating the index, save locally and push to R2 if sync is enabled.
pub fn save_and_sync(ctx: &mut AppContext) -> Result<()> {
    save_index(&ctx.store, &ctx.index, &ctx.recipient)?;

    if sync::is_sync_enabled(&ctx.config) {
        sync::push_index(
            &ctx.index,
            &ctx.config,
            &mut ctx.sync_state,
            &ctx.identity,
            &ctx.recipient,
        )?;
        ctx.sync_state.save(&ctx.data_dir)?;
    }

    Ok(())
}
