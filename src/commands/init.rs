use super::get_data_dir;
use crate::config::Config;
use crate::crypto;
use anyhow::{Context, Result};
use std::fs;
use std::os::unix::fs::PermissionsExt;

pub fn run() -> Result<()> {
    let data_dir = get_data_dir()?;
    let identity_path = data_dir.join("identity.txt");

    if identity_path.exists() {
        anyhow::bail!(
            "Already initialized at {}. Delete the directory to re-initialize.",
            data_dir.display()
        );
    }

    // Create directories
    fs::create_dir_all(data_dir.join("messages")).context("Failed to create data directory")?;

    // Generate keypair
    let keypair = crypto::generate_keypair();

    // Write identity (private key) with 0600 permissions
    let identity_str = crypto::identity_to_string(&keypair.identity);
    fs::write(&identity_path, format!("{identity_str}\n"))?;
    fs::set_permissions(&identity_path, fs::Permissions::from_mode(0o600))?;

    // Write recipient (public key)
    let recipient_str = crypto::recipient_to_string(&keypair.recipient);
    fs::write(
        data_dir.join("recipients.txt"),
        format!("{recipient_str}\n"),
    )?;

    // Write default config
    let config = Config::default_with_path(&data_dir);
    config.save(&data_dir.join("config.toml"))?;

    println!("Initialized Note to Self at {}", data_dir.display());
    println!("Public key: {recipient_str}");
    println!("\nStart sending notes: nts push \"hello, future me\"");

    Ok(())
}
