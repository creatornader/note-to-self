use crate::commands::get_data_dir;
use crate::config::Config;
use anyhow::Result;

pub fn run_get(key: &str) -> Result<()> {
    let data_dir = get_data_dir()?;
    let config_path = data_dir.join("config.toml");

    let config = if config_path.exists() {
        Config::load(&config_path)?
    } else {
        Config::default_with_path(&data_dir)
    };

    match config.get(key) {
        Some(value) => {
            let display = if key.contains("secret") || key.contains("key") || key.contains("token") {
                Config::mask_secret(&value)
            } else {
                value
            };
            println!("{key} = {display}");
        }
        None => {
            eprintln!("Unknown config key: {key}");
            std::process::exit(1);
        }
    }

    Ok(())
}

pub fn run_set(key: &str, value: &str) -> Result<()> {
    let data_dir = get_data_dir()?;
    let config_path = data_dir.join("config.toml");

    let mut config = if config_path.exists() {
        Config::load(&config_path)?
    } else {
        Config::default_with_path(&data_dir)
    };

    config.set(key, value)?;
    config.save(&config_path)?;

    let display = if key.contains("secret") || key.contains("key") || key.contains("token") {
        Config::mask_secret(value)
    } else {
        value.to_string()
    };
    println!("Set {key} = {display}");

    Ok(())
}
