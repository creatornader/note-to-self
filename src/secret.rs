// Resolve secret values from a named env var first, falling back to an
// inline plaintext value. The shell-init pattern in ~/.zshenv seeds the
// env var from 1Password; this module is intentionally dumb so the Rust
// side never shells out to `op` and never touches Touch ID prompts.
//
// See docs/architecture.md (ADR: env-var-resolved secrets) for rationale.

use anyhow::{anyhow, Result};

pub fn resolve(env_name: Option<&str>, inline_value: Option<&str>, label: &str) -> Result<String> {
    if let Some(name) = env_name.filter(|n| !n.is_empty()) {
        match std::env::var(name) {
            Ok(v) if !v.is_empty() => return Ok(v),
            Ok(_) => {
                return Err(anyhow!(
                    "Env var {name} is set but empty (referenced by {label}). \
                     Check the shell-init seeding in ~/.zshenv or unset {name} \
                     to fall back to inline config."
                ));
            }
            Err(_) => {
                if let Some(v) = inline_value.filter(|s| !s.is_empty()) {
                    return Ok(v.to_string());
                }
                return Err(anyhow!(
                    "Secret {label} unresolved: env var {name} is not set and no inline \
                     value is configured. Restart your shell or `source ~/.zshenv` to \
                     populate {name}, or run `nts config set {label} <value>` for inline."
                ));
            }
        }
    }
    inline_value
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            anyhow!(
                "Secret {label} unresolved: neither an env-var reference nor an inline \
                 value is configured. Set one via `nts config set {label}_env NTS_*` or \
                 `nts config set {label} <value>`."
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Rust 1.85 made env::set_var/remove_var unsafe because mutating the
    // process env from multiple threads is racy. Cargo runs tests in
    // parallel, so we serialize all env mutations here through one Mutex.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn unique_env(name: &str) -> String {
        format!("NTS_TEST_{name}_{}", std::process::id())
    }

    // SAFETY: every call site holds ENV_LOCK for the duration of the
    // set/read/remove sequence, so no other thread is mutating env during
    // the unsafe call.
    fn set(name: &str, value: &str) {
        unsafe { std::env::set_var(name, value) };
    }
    fn unset(name: &str) {
        unsafe { std::env::remove_var(name) };
    }

    #[test]
    fn resolves_from_env_when_set() {
        let _g = ENV_LOCK.lock().unwrap();
        let n = unique_env("ENV_HIT");
        set(&n, "from-env");
        let got = resolve(Some(&n), Some("from-inline"), "test").unwrap();
        assert_eq!(got, "from-env");
        unset(&n);
    }

    #[test]
    fn falls_back_to_inline_when_env_unset() {
        let _g = ENV_LOCK.lock().unwrap();
        let n = unique_env("ENV_MISS");
        unset(&n);
        let got = resolve(Some(&n), Some("from-inline"), "test").unwrap();
        assert_eq!(got, "from-inline");
    }

    #[test]
    fn errors_when_env_set_but_empty() {
        let _g = ENV_LOCK.lock().unwrap();
        let n = unique_env("ENV_EMPTY");
        set(&n, "");
        let err = resolve(Some(&n), Some("from-inline"), "test").unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("set but empty"), "got: {msg}");
        unset(&n);
    }

    #[test]
    fn errors_when_neither_env_nor_inline_resolves() {
        let _g = ENV_LOCK.lock().unwrap();
        let n = unique_env("ENV_GHOST");
        unset(&n);
        let err = resolve(Some(&n), None, "test.label").unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("test.label"), "got: {msg}");
    }

    #[test]
    fn uses_inline_when_no_env_name_provided() {
        let got = resolve(None, Some("plain-inline"), "test").unwrap();
        assert_eq!(got, "plain-inline");
    }

    #[test]
    fn errors_when_no_env_name_and_no_inline() {
        let err = resolve(None, None, "test.both-empty").unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("test.both-empty"), "got: {msg}");
    }

    #[test]
    fn empty_env_name_is_treated_as_unset() {
        let got = resolve(Some(""), Some("inline-only"), "test").unwrap();
        assert_eq!(got, "inline-only");
    }
}
