pub mod ack;
pub mod delete;
pub mod init;
pub mod list;
pub mod peek;
pub mod pop;
pub mod purge;
pub mod push;
pub mod search;
pub mod show;

use crate::crypto;
use crate::index::Index;
use crate::storage::Storage;
use crate::storage::local::LocalStorage;
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

pub fn load_context() -> Result<(
    LocalStorage,
    Index,
    age::x25519::Identity,
    age::x25519::Recipient,
)> {
    let data_dir = get_data_dir()?;
    let identity_path = data_dir.join("identity.txt");
    let recipients_path = data_dir.join("recipients.txt");

    if !identity_path.exists() {
        anyhow::bail!("Not initialized. Run `nts init` first.");
    }

    let identity_str =
        std::fs::read_to_string(&identity_path).context("Failed to read identity file")?;
    let identity = crypto::parse_identity(identity_str.trim())?;

    let recipient_str =
        std::fs::read_to_string(&recipients_path).context("Failed to read recipients file")?;
    let recipient = crypto::parse_recipient(recipient_str.trim())?;

    let store = LocalStorage::new(&data_dir)?;

    let index = if store.blob_exists("index.age") {
        let encrypted = store.read_blob("index.age")?;
        let decrypted = crypto::decrypt(&encrypted, &identity)?;
        serde_json::from_slice(&decrypted).context("Failed to parse index")?
    } else {
        Index::new()
    };

    Ok((store, index, identity, recipient))
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
