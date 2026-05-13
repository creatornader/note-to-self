use crate::commands::get_data_dir;
use crate::config::{Config, NotifyConfig, NtfyConfig};
use anyhow::Result;
use rand::Rng;

pub fn run_setup() -> Result<()> {
    let data_dir = get_data_dir()?;
    let config_path = data_dir.join("config.toml");

    let mut config = if config_path.exists() {
        Config::load(&config_path)?
    } else {
        Config::default_with_path(&data_dir)
    };

    // Check if already configured
    if let Some(notify) = &config.notify {
        if let Some(ntfy) = &notify.ntfy {
            if !ntfy.topic.is_empty() {
                println!("Notifications already configured (topic: {}).", ntfy.topic);
                println!("Use `nts config set notify.ntfy.<key> <value>` to change settings.");
                return Ok(());
            }
        }
    }

    // Generate random topic name
    let mut rng = rand::rng();
    let suffix: u32 = rng.random_range(0..0xFFFFFFFF);
    let topic = format!("nts-{suffix:08x}");

    // Save config
    config.notify = Some(NotifyConfig {
        enabled: true,
        backend: "ntfy".to_string(),
        ntfy: Some(NtfyConfig {
            server: "https://ntfy.sh".to_string(),
            topic: topic.clone(),
            token: None,
            token_env: None,
        }),
    });
    config.save(&config_path)?;

    println!("Notification topic: {topic}");
    println!();
    println!("Setup:");
    println!("  1. Install the ntfy app on your phone (ntfy.sh)");
    println!("  2. Subscribe to topic: {topic}");
    println!("  3. That's it! You'll get notified on every `nts push`");
    println!();

    // Send test notification
    let ntfy = config.notify.as_ref().unwrap().ntfy.as_ref().unwrap();
    let url = format!("{}/{}", ntfy.server.trim_end_matches('/'), ntfy.topic);
    match ureq::post(&url)
        .set("X-Title", "Note to Self")
        .set("X-Priority", "3")
        .timeout(std::time::Duration::from_secs(5))
        .send_string("nts connected!")
    {
        Ok(_) => println!("Test notification sent! Check your phone."),
        Err(_) => println!("Could not send test notification — check your internet connection."),
    }

    println!();
    println!("To add an access token for a private topic:");
    println!("  nts config set notify.ntfy.token tk_...");
    println!();
    println!("To disable notifications:");
    println!("  nts config set notify.enabled false");

    Ok(())
}
