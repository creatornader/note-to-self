use assert_cmd::Command;
use predicates::prelude::*;
use tempfile::TempDir;

fn nts(tmp: &TempDir) -> Command {
    let mut cmd = Command::cargo_bin("nts").unwrap();
    cmd.env("NTS_HOME", tmp.path());
    cmd
}

#[test]
fn test_init_creates_files() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    assert!(tmp.path().join("identity.txt").exists());
    assert!(tmp.path().join("recipients.txt").exists());
    assert!(tmp.path().join("config.toml").exists());
    assert!(tmp.path().join("messages").exists());
}

#[test]
fn test_init_twice_fails() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp)
        .arg("init")
        .assert()
        .failure()
        .stderr(predicate::str::contains("Already initialized"));
}

#[test]
fn test_push_without_init_fails() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp)
        .args(["push", "hello"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("nts init"));
}

#[test]
fn test_push_and_peek() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp)
        .args(["push", "hello world"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Pushed:"));
    nts(&tmp)
        .arg("peek")
        .assert()
        .success()
        .stdout(predicate::str::contains("hello world"));
}

#[test]
fn test_push_and_pop() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp).args(["push", "msg one"]).assert().success();
    nts(&tmp).args(["push", "msg two"]).assert().success();

    // Pop returns latest (msg two)
    nts(&tmp)
        .arg("pop")
        .assert()
        .success()
        .stdout(predicate::str::contains("msg two"));

    // Next peek returns msg one
    nts(&tmp)
        .arg("peek")
        .assert()
        .success()
        .stdout(predicate::str::contains("msg one"));
}

#[test]
fn test_list() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp)
        .args(["push", "tagged", "--tag", "work"])
        .assert()
        .success();
    nts(&tmp).args(["push", "untagged"]).assert().success();

    nts(&tmp)
        .arg("list")
        .assert()
        .success()
        .stdout(predicate::str::contains("tagged"))
        .stdout(predicate::str::contains("untagged"));

    nts(&tmp)
        .args(["list", "--tag", "work"])
        .assert()
        .success()
        .stdout(predicate::str::contains("tagged"))
        .stdout(predicate::str::contains("untagged").not());
}

#[test]
fn test_search() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp)
        .args(["push", "my secret api key"])
        .assert()
        .success();
    nts(&tmp)
        .args(["push", "meeting tomorrow"])
        .assert()
        .success();

    nts(&tmp)
        .args(["search", "api"])
        .assert()
        .success()
        .stdout(predicate::str::contains("api key"));

    nts(&tmp)
        .args(["search", "nonexistent"])
        .assert()
        .success()
        .stdout(predicate::str::contains("No messages matching"));
}

#[test]
fn test_delete() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    let output = nts(&tmp).args(["push", "delete me"]).output().unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let id = stdout.trim().strip_prefix("Pushed: ").unwrap();

    nts(&tmp)
        .args(["delete", id])
        .assert()
        .success()
        .stdout(predicate::str::contains("Deleted:"));

    nts(&tmp)
        .arg("list")
        .assert()
        .success()
        .stdout(predicate::str::contains("No messages"));
}

#[test]
fn test_encrypted_at_rest() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp)
        .args(["push", "super secret message"])
        .assert()
        .success();

    // Read raw index file — should NOT contain plaintext
    let index_bytes = std::fs::read(tmp.path().join("index.age")).unwrap();
    let index_str = String::from_utf8_lossy(&index_bytes);
    assert!(!index_str.contains("super secret"));

    // Read raw message file — should NOT contain plaintext
    let msg_dir = tmp.path().join("messages");
    for entry in std::fs::read_dir(&msg_dir).unwrap() {
        let entry = entry.unwrap();
        let bytes = std::fs::read(entry.path()).unwrap();
        let content = String::from_utf8_lossy(&bytes);
        assert!(!content.contains("super secret"));
    }
}

#[test]
fn test_config_set_and_get() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .args(["config", "set", "storage.backend", "r2"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Set storage.backend = r2"));

    nts(&tmp)
        .args(["config", "get", "storage.backend"])
        .assert()
        .success()
        .stdout(predicate::str::contains("r2"));
}

#[test]
fn test_status_local_backend() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .arg("status")
        .assert()
        .success()
        .stdout(predicate::str::contains("Backend: local"))
        .stdout(predicate::str::contains("Last sync: never"))
        .stdout(predicate::str::contains("Pending: none"));
}

#[test]
fn test_sync_without_r2_shows_instructions() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .arg("sync")
        .assert()
        .success()
        .stdout(predicate::str::contains("Sync is not enabled"));
}

#[test]
fn test_export_and_import_plaintext() {
    let tmp_src = TempDir::new().unwrap();
    nts(&tmp_src).arg("init").assert().success();
    nts(&tmp_src)
        .args(["push", "test message"])
        .assert()
        .success();

    // Export
    let output = nts(&tmp_src).arg("export").output().unwrap();
    assert!(output.status.success());

    let bundle_path = tmp_src.path().join("bundle.json");
    std::fs::write(&bundle_path, &output.stdout).unwrap();

    // Import to a new location
    let tmp_dst = TempDir::new().unwrap();
    nts(&tmp_dst)
        .args(["import", bundle_path.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("Imported successfully"));

    // Verify identity was imported
    assert!(tmp_dst.path().join("identity.txt").exists());
    assert!(tmp_dst.path().join("recipients.txt").exists());
    assert!(tmp_dst.path().join("config.toml").exists());
}

#[test]
fn test_export_bundle_includes_notify_block() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .args(["config", "set", "notify.enabled", "true"])
        .assert()
        .success();
    nts(&tmp)
        .args(["config", "set", "notify.ntfy.server", "https://ntfy.sh"])
        .assert()
        .success();
    nts(&tmp)
        .args(["config", "set", "notify.ntfy.topic", "nts-paste-bundle-test"])
        .assert()
        .success();
    nts(&tmp)
        .args(["config", "set", "notify.ntfy.token", "tk_pastebundle"])
        .assert()
        .success();

    let output = nts(&tmp).arg("export").output().unwrap();
    assert!(output.status.success());

    let bundle: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("export emits valid JSON");
    let notify = &bundle["config"]["notify"];
    assert!(notify.is_object(), "bundle.config.notify should be present");
    assert_eq!(notify["enabled"], serde_json::Value::Bool(true));
    assert_eq!(notify["backend"], serde_json::Value::String("ntfy".to_string()));
    assert_eq!(
        notify["ntfy"]["server"],
        serde_json::Value::String("https://ntfy.sh".to_string())
    );
    assert_eq!(
        notify["ntfy"]["topic"],
        serde_json::Value::String("nts-paste-bundle-test".to_string())
    );
    assert_eq!(
        notify["ntfy"]["token"],
        serde_json::Value::String("tk_pastebundle".to_string())
    );
}

#[test]
fn test_notify_setup_creates_config() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .args(["notify", "setup"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Notification topic: nts-"))
        .stdout(predicate::str::contains("Subscribe to topic:"));

    // Verify config was written
    let config_content = std::fs::read_to_string(tmp.path().join("config.toml")).unwrap();
    assert!(config_content.contains("[notify]"));
    assert!(config_content.contains("enabled = true"));
    assert!(config_content.contains("nts-"));
}

#[test]
fn test_notify_setup_idempotent() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    // First setup
    nts(&tmp)
        .args(["notify", "setup"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Notification topic:"));

    // Second setup should warn
    nts(&tmp)
        .args(["notify", "setup"])
        .assert()
        .success()
        .stdout(predicate::str::contains("already configured"));
}

#[test]
fn test_push_with_quiet_flag() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .args(["push", "test message", "--quiet"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Pushed:"));
}

#[test]
fn test_push_with_priority_flag() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .args(["push", "urgent message", "--priority", "high"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Pushed:"));
}

#[test]
fn test_config_get_set_notify() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .args(["config", "set", "notify.ntfy.topic", "my-custom-topic"])
        .assert()
        .success();

    nts(&tmp)
        .args(["config", "get", "notify.ntfy.topic"])
        .assert()
        .success()
        .stdout(predicate::str::contains("my-custom-topic"));
}

#[test]
fn test_config_get_notify_token_masked() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .args(["config", "set", "notify.ntfy.token", "tk_longsecrettoken123"])
        .assert()
        .success();

    nts(&tmp)
        .args(["config", "get", "notify.ntfy.token"])
        .assert()
        .success()
        .stdout(predicate::str::contains("tk_l...n123"));
}

#[test]
fn test_import_fails_if_already_initialized() {
    let tmp_src = TempDir::new().unwrap();
    nts(&tmp_src).arg("init").assert().success();

    let output = nts(&tmp_src).arg("export").output().unwrap();
    let bundle_path = tmp_src.path().join("bundle.json");
    std::fs::write(&bundle_path, &output.stdout).unwrap();

    // Try to import into the same (already initialized) directory
    nts(&tmp_src)
        .args(["import", bundle_path.to_str().unwrap()])
        .assert()
        .failure()
        .stderr(predicate::str::contains("Already initialized"));
}

#[test]
fn test_device_add_creates_entry() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();

    nts(&tmp)
        .args(["device", "add", "phone"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Device added: phone"))
        .stdout(predicate::str::contains("nts_"));

    assert!(tmp.path().join("devices.json").exists());
}

#[test]
fn test_device_add_duplicate_fails() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp).args(["device", "add", "phone"]).assert().success();
    nts(&tmp)
        .args(["device", "add", "phone"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("already exists"));
}

#[test]
fn test_device_list_empty_then_populated() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp)
        .args(["device", "list"])
        .assert()
        .success()
        .stdout(predicate::str::contains("No devices registered."));
    nts(&tmp).args(["device", "add", "phone"]).assert().success();
    nts(&tmp)
        .args(["device", "list"])
        .assert()
        .success()
        .stdout(predicate::str::contains("phone"));
}

#[test]
fn test_device_revoke_removes_entry() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp).args(["device", "add", "phone"]).assert().success();
    nts(&tmp)
        .args(["device", "revoke", "phone"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Revoked: phone"));
    nts(&tmp)
        .args(["device", "list"])
        .assert()
        .success()
        .stdout(predicate::str::contains("No devices registered."));
}

#[test]
fn test_device_revoke_unknown_fails() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp)
        .args(["device", "revoke", "ghost"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("not found"));
}

#[test]
fn test_device_add_uses_worker_base_url_when_set() {
    let tmp = TempDir::new().unwrap();
    nts(&tmp).arg("init").assert().success();
    nts(&tmp)
        .args([
            "config",
            "set",
            "storage.worker_base_url",
            "https://nts.example.workers.dev",
        ])
        .assert()
        .success();
    nts(&tmp)
        .args(["device", "add", "phone"])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "https://nts.example.workers.dev/#token=nts_",
        ));
}
