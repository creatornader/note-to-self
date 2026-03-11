use crate::commands::get_data_dir;
use crate::config::Config;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::io::Write;

#[derive(Serialize, Deserialize)]
pub struct ExportBundle {
    pub v: u32,
    pub identity: String,
    pub recipient: String,
    pub config: Config,
}

pub fn run(passphrase: bool) -> Result<()> {
    let data_dir = get_data_dir()?;
    let identity_path = data_dir.join("identity.txt");
    let recipients_path = data_dir.join("recipients.txt");
    let config_path = data_dir.join("config.toml");

    if !identity_path.exists() {
        anyhow::bail!("Not initialized. Run `nts init` first.");
    }

    let identity_str =
        std::fs::read_to_string(&identity_path).context("Failed to read identity")?;
    let recipient_str =
        std::fs::read_to_string(&recipients_path).context("Failed to read recipient")?;

    let config = if config_path.exists() {
        Config::load(&config_path)?
    } else {
        Config::default_with_path(&data_dir)
    };

    let bundle = ExportBundle {
        v: 1,
        identity: identity_str.trim().to_string(),
        recipient: recipient_str.trim().to_string(),
        config,
    };

    let json = serde_json::to_string_pretty(&bundle)?;

    if passphrase {
        let pass = rpassword::prompt_password("Export passphrase: ")?;
        let pass_confirm = rpassword::prompt_password("Confirm passphrase: ")?;
        if pass != pass_confirm {
            anyhow::bail!("Passphrases do not match.");
        }

        let scrypt_recipient =
            age::scrypt::Recipient::new(age::secrecy::SecretString::from(pass));
        let encrypted = age::encrypt(&scrypt_recipient, json.as_bytes())
            .map_err(|e| anyhow::anyhow!("Failed to encrypt bundle: {e}"))?;

        std::io::stdout().write_all(&encrypted)?;
    } else {
        println!("{json}");
    }

    eprintln!("Export complete. Transfer this file securely to your other device.");
    Ok(())
}
