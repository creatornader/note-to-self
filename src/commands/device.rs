use crate::device::{self, DeviceEntry};
use crate::sync;
use anyhow::Result;
use chrono::Utc;

pub fn run_add(name: String) -> Result<()> {
    let ctx = super::load_context()?;
    let mut list = device::load(&ctx.store)?;

    if list.devices.iter().any(|d| d.name == name) {
        anyhow::bail!("Device {name} already exists. Revoke it first or use a different name.");
    }

    let (token, token_hash) = device::mint_token();
    list.devices.push(DeviceEntry {
        name: name.clone(),
        token_hash,
        created_at: Utc::now(),
    });
    device::save(&ctx.store, &list)?;

    if sync::is_sync_enabled(&ctx.config) {
        let bytes = serde_json::to_vec_pretty(&list)?;
        if !sync::push_blob(device::DEVICES_BLOB_KEY, &bytes, &ctx.config).unwrap_or(false) {
            eprintln!(
                "Warning: devices.json saved locally but not yet uploaded. Run `nts sync` when online."
            );
        }
    }

    println!("Device added: {name}");
    println!();
    match ctx.config.storage.pwa_base_url.as_deref() {
        Some(base) => {
            println!("Open this URL on the device:");
            println!("  {base}/#token={token}");
            println!();
            println!("Or paste the token directly when prompted:");
            println!("  {token}");
        }
        None => {
            println!("Paste this token into the PWA's import page:");
            println!("  {token}");
            println!();
            println!("Set storage.pwa_base_url to get a one-click enrollment URL:");
            println!("  nts config set storage.pwa_base_url https://YOUR-PWA.pages.dev");
        }
    }
    println!();
    println!("Revoke with: nts device revoke {name}");
    Ok(())
}

pub fn run_list() -> Result<()> {
    let ctx = super::load_context()?;
    let list = device::load(&ctx.store)?;

    if list.devices.is_empty() {
        println!("No devices registered.");
        return Ok(());
    }

    println!("{:<20} {:<22} {}", "NAME", "CREATED", "TOKEN HASH (first 16)");
    for d in &list.devices {
        let short = &d.token_hash[..16];
        println!(
            "{:<20} {:<22} {short}",
            d.name,
            d.created_at.format("%Y-%m-%d %H:%M:%S")
        );
    }
    Ok(())
}

pub fn run_revoke(name: String) -> Result<()> {
    let ctx = super::load_context()?;
    let mut list = device::load(&ctx.store)?;

    let before = list.devices.len();
    list.devices.retain(|d| d.name != name);
    if list.devices.len() == before {
        anyhow::bail!("Device {name} not found.");
    }
    device::save(&ctx.store, &list)?;

    if sync::is_sync_enabled(&ctx.config) {
        let bytes = serde_json::to_vec_pretty(&list)?;
        let _ = sync::push_blob(device::DEVICES_BLOB_KEY, &bytes, &ctx.config);
    }

    println!("Revoked: {name}. Worker will stop accepting the token within 60 seconds.");
    Ok(())
}
