use crate::config::{Config, NtfyConfig};

/// ntfy priority levels (1-5)
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Priority {
    Low,
    Default,
    High,
    Urgent,
}

impl Priority {
    /// Parse from CLI flag value
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "low" => Some(Self::Low),
            "default" => Some(Self::Default),
            "high" => Some(Self::High),
            "urgent" => Some(Self::Urgent),
            _ => None,
        }
    }

    /// Map to ntfy numeric priority
    pub fn to_ntfy_priority(self) -> u8 {
        match self {
            Self::Low => 2,
            Self::Default => 3,
            Self::High => 4,
            Self::Urgent => 5,
        }
    }
}

/// Build the notification body. Never includes message content. The
/// "new note · tag1, tag2 · expires in 4h" shape is mirrored verbatim by
/// the PWA's buildBody so notifications look identical regardless of
/// which client published.
pub fn build_body(tags: &[String], ttl: &Option<String>) -> String {
    let mut parts: Vec<String> = vec!["new note".to_string()];
    if !tags.is_empty() {
        parts.push(tags.join(", "));
    }
    if let Some(ttl_str) = ttl {
        parts.push(format!("expires in {ttl_str}"));
    }
    parts.join(" · ")
}

/// Send a notification via ntfy. Fire-and-forget: prints warnings on failure, never errors.
pub fn send(
    config: &Config,
    message_id: &str,
    tags: &[String],
    ttl: &Option<String>,
    priority: Option<Priority>,
) {
    let ntfy = match config.notify.as_ref().and_then(|n| {
        if n.enabled {
            n.ntfy.as_ref()
        } else {
            None
        }
    }) {
        Some(ntfy) => ntfy,
        None => return, // Notifications not configured or disabled
    };

    // Skip if topic is empty or whitespace
    if ntfy.topic.trim().is_empty() {
        return;
    }

    // Click target: when pwa_base_url is set, tapping the notification on a
    // device deep-links into the message view. Without pwa_base_url the
    // notification is informational only.
    let click = config
        .storage
        .pwa_base_url
        .as_deref()
        .map(|base| format!("{}/m/{}", base.trim_end_matches('/'), message_id));

    if let Err(msg) = send_request(ntfy, click.as_deref(), tags, ttl, priority) {
        eprintln!("Note pushed. {msg}");
    }
}

fn send_request(
    ntfy: &NtfyConfig,
    click: Option<&str>,
    tags: &[String],
    ttl: &Option<String>,
    priority: Option<Priority>,
) -> Result<(), String> {
    let url = format!("{}/{}", ntfy.server.trim_end_matches('/'), ntfy.topic);
    let body = build_body(tags, ttl);
    let prio = priority.unwrap_or(Priority::Default).to_ntfy_priority().to_string();

    let mut req = ureq::post(&url)
        .set("X-Title", "Note to Self")
        .set("X-Priority", &prio)
        .timeout(std::time::Duration::from_secs(5));

    if let Some(click_url) = click {
        req = req.set("X-Click", click_url);
    }

    if let Some(token) = ntfy.resolve_token() {
        req = req.set("Authorization", &format!("Bearer {token}"));
    }

    match req.send_string(&body) {
        Ok(_) => Ok(()),
        Err(ureq::Error::Status(status, _)) => {
            match status {
                401 | 403 => Err("Notification auth failed — check `nts config set notify.ntfy.token`.".to_string()),
                429 => Err("ntfy rate limit reached — notification skipped. Consider self-hosting.".to_string()),
                _ => Err(format!("Notification failed (HTTP {status}).")),
            }
        }
        Err(_) => Err("Notification failed: connection error.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_priority_from_str() {
        assert_eq!(Priority::from_str("low"), Some(Priority::Low));
        assert_eq!(Priority::from_str("default"), Some(Priority::Default));
        assert_eq!(Priority::from_str("high"), Some(Priority::High));
        assert_eq!(Priority::from_str("urgent"), Some(Priority::Urgent));
        assert_eq!(Priority::from_str("invalid"), None);
    }

    #[test]
    fn test_priority_to_ntfy() {
        assert_eq!(Priority::Low.to_ntfy_priority(), 2);
        assert_eq!(Priority::Default.to_ntfy_priority(), 3);
        assert_eq!(Priority::High.to_ntfy_priority(), 4);
        assert_eq!(Priority::Urgent.to_ntfy_priority(), 5);
    }

    #[test]
    fn test_build_body_plain() {
        let body = build_body(&[], &None);
        assert_eq!(body, "new note");
    }

    #[test]
    fn test_build_body_with_tags() {
        let body = build_body(&["work".to_string(), "urgent".to_string()], &None);
        assert_eq!(body, "new note · work, urgent");
    }

    #[test]
    fn test_build_body_with_ttl() {
        let body = build_body(&[], &Some("4h".to_string()));
        assert_eq!(body, "new note · expires in 4h");
    }

    #[test]
    fn test_build_body_with_tags_and_ttl() {
        let body = build_body(&["work".to_string()], &Some("30m".to_string()));
        assert_eq!(body, "new note · work · expires in 30m");
    }
}
