use crate::commands::get_data_dir;
use crate::config::Config;
use anyhow::Result;

// Whether a key holds an actual secret value (mask) or a pointer to one
// (don't mask). Keys ending in `_env` are env-var names, not secrets.
fn should_mask(key: &str) -> bool {
    if key.ends_with("_env") {
        return false;
    }
    key.contains("secret") || key.contains("key") || key.contains("token")
}

pub fn run_get(key: &str) -> Result<()> {
    let data_dir = get_data_dir()?;
    let config_path = data_dir.join("config.toml");

    let config = if config_path.exists() {
        Config::load(&config_path)?
    } else {
        Config::default_with_path(&data_dir)
    };

    if should_mask(key) {
        if config.get(key).is_some() {
            println!("{key} = [set]");
            return Ok(());
        }
        eprintln!("Unknown config key: {key}");
        std::process::exit(1);
    }

    match config.get(key) {
        Some(value) => println!("{key} = {value}"),
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

    if should_mask(key) {
        println!("Set {key} = [set]");
    } else {
        println!("Set {key}");
    }

    Ok(())
}
