use crate::commands::get_data_dir;
use crate::config::Config;
use crate::sync_state::SyncState;
use anyhow::Result;

pub fn run() -> Result<()> {
    let data_dir = get_data_dir()?;
    let config_path = data_dir.join("config.toml");

    let config = if config_path.exists() {
        Config::load(&config_path)?
    } else {
        Config::default_with_path(&data_dir)
    };

    let sync_state = SyncState::load(&data_dir)?;

    println!("Backend: {}", config.storage.backend);

    if config.storage.backend == "r2" {
        if let Some(r2) = &config.storage.r2 {
            println!("Bucket: {}", r2.bucket);
            println!("Endpoint: {}", r2.endpoint);
        } else {
            println!("R2: not configured");
        }
    }

    match sync_state.last_sync {
        Some(ts) => println!("Last sync: {}", ts.format("%Y-%m-%d %H:%M:%S UTC")),
        None => println!("Last sync: never"),
    }

    let pending_count = sync_state.pending_ids.len() + sync_state.pending_deletes.len();
    if pending_count > 0 {
        println!(
            "Pending: {} push(es), {} delete(s)",
            sync_state.pending_ids.len(),
            sync_state.pending_deletes.len()
        );
    } else {
        println!("Pending: none");
    }

    Ok(())
}
