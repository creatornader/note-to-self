use crate::commands::get_data_dir;
use crate::config::Config;
use age::armor::{ArmoredWriter, Format};
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

    let identity_str = crate::commands::load_identity_string(&identity_path)?;
    let recipient_str =
        std::fs::read_to_string(&recipients_path).context("Failed to read recipient")?;

    let config = if config_path.exists() {
        Config::load(&config_path)?
    } else {
        Config::default_with_path(&data_dir)
    };

    let bundle_config = if passphrase {
        let mut sanitized = config.clone();
        sanitized.storage.r2 = None;
        sanitized
    } else {
        config
    };

    let bundle = ExportBundle {
        v: 1,
        identity: identity_str.trim().to_string(),
        recipient: recipient_str.trim().to_string(),
        config: bundle_config,
    };

    let json = serde_json::to_string_pretty(&bundle)?;

    if passphrase {
        let (pass, pass_confirm) = if std::io::IsTerminal::is_terminal(&std::io::stdin()) {
            let p = rpassword::prompt_password("Export passphrase: ")?;
            let c = rpassword::prompt_password("Confirm passphrase: ")?;
            (p, c)
        } else {
            // Piped input: read two lines (passphrase + confirmation) from stdin.
            // This lets scripts and tests feed the passphrase non-interactively.
            use std::io::BufRead;
            let stdin = std::io::stdin();
            let mut lines = stdin.lock().lines();
            let p = lines
                .next()
                .transpose()?
                .ok_or_else(|| anyhow::anyhow!("Expected passphrase on stdin"))?;
            let c = lines
                .next()
                .transpose()?
                .ok_or_else(|| anyhow::anyhow!("Expected passphrase confirmation on stdin"))?;
            (p, c)
        };
        if pass != pass_confirm {
            anyhow::bail!("Passphrases do not match.");
        }

        // Emit ASCII-armored output so the bundle can be copy-pasted into the
        // PWA's import flow without binary-to-text encoding gymnastics.
        let encryptor = age::Encryptor::with_user_passphrase(
            age::secrecy::SecretString::from(pass),
        );
        let mut armored = Vec::new();
        let armor_writer = ArmoredWriter::wrap_output(&mut armored, Format::AsciiArmor)
            .map_err(|e| anyhow::anyhow!("Failed to start armor: {e}"))?;
        let mut writer = encryptor
            .wrap_output(armor_writer)
            .map_err(|e| anyhow::anyhow!("Failed to start encryptor: {e}"))?;
        writer.write_all(json.as_bytes())?;
        writer
            .finish()
            .and_then(|inner| inner.finish())
            .map_err(|e| anyhow::anyhow!("Failed to finalize bundle: {e}"))?;

        std::io::stdout().write_all(&armored)?;
    } else {
        println!("{json}");
    }

    eprintln!("Export complete. Transfer this file securely to your other device.");
    Ok(())
}
