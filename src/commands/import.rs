use crate::commands::export::ExportBundle;
use crate::commands::get_data_dir;
use crate::crypto;
use anyhow::{Context, Result};
use std::fs;
use std::os::unix::fs::PermissionsExt;

pub fn run(file: &str, passphrase: bool) -> Result<()> {
    let data_dir = get_data_dir()?;

    if data_dir.join("identity.txt").exists() {
        anyhow::bail!(
            "Already initialized at {}. Delete the data directory first to import.",
            data_dir.display()
        );
    }

    let file_bytes =
        fs::read(file).with_context(|| format!("Failed to read import file: {file}"))?;

    let json_str = if passphrase {
        let pass = rpassword::prompt_password("Import passphrase: ")?;

        let identity = age::scrypt::Identity::new(age::secrecy::SecretString::from(pass));
        let decrypted = age::decrypt(&identity, &file_bytes)
            .map_err(|e| anyhow::anyhow!("Failed to decrypt bundle (wrong passphrase?): {e}"))?;
        String::from_utf8(decrypted).context("Bundle is not valid UTF-8")?
    } else {
        String::from_utf8(file_bytes).context("Bundle is not valid UTF-8")?
    };

    let bundle: ExportBundle =
        serde_json::from_str(&json_str).context("Failed to parse export bundle")?;

    if bundle.v != 1 {
        anyhow::bail!("Unsupported bundle version: {}", bundle.v);
    }

    // Validate the keys parse correctly
    crypto::parse_identity(&bundle.identity)?;
    crypto::parse_recipient(&bundle.recipient)?;

    // Create data directory
    fs::create_dir_all(&data_dir)?;
    fs::create_dir_all(data_dir.join("messages"))?;

    // Write identity with restricted permissions
    let identity_path = data_dir.join("identity.txt");
    fs::write(&identity_path, &bundle.identity)?;
    fs::set_permissions(&identity_path, fs::Permissions::from_mode(0o600))?;

    // Write recipient
    fs::write(data_dir.join("recipients.txt"), &bundle.recipient)?;

    // Write config
    bundle.config.save(&data_dir.join("config.toml"))?;

    println!("Imported successfully to {}", data_dir.display());
    println!("Run `nts sync` to pull messages from R2.");

    Ok(())
}
