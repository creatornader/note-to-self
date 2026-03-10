use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub v: u32,
    pub id: String,
    pub content: String,
    pub content_type: String,
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub device: String,
}

impl Message {
    pub fn new(id: String, content: String, tags: Vec<String>) -> Self {
        Self {
            v: 1,
            id,
            content,
            content_type: "text/plain".to_string(),
            tags,
            created_at: Utc::now(),
            device: "cli".to_string(),
        }
    }

    pub fn preview(&self, max_len: usize) -> String {
        if self.content.len() <= max_len {
            self.content.clone()
        } else {
            format!("{}...", &self.content[..max_len])
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_new() {
        let msg = Message::new(
            "123_abc".to_string(),
            "hello world".to_string(),
            vec!["work".to_string()],
        );
        assert_eq!(msg.v, 1);
        assert_eq!(msg.content, "hello world");
        assert_eq!(msg.tags, vec!["work"]);
        assert_eq!(msg.content_type, "text/plain");
        assert_eq!(msg.device, "cli");
    }

    #[test]
    fn test_message_serialization_roundtrip() {
        let msg = Message::new("123_abc".to_string(), "test content".to_string(), vec![]);
        let json = serde_json::to_string(&msg).unwrap();
        let deserialized: Message = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.content, "test content");
        assert_eq!(deserialized.id, "123_abc");
    }

    #[test]
    fn test_preview_short() {
        let msg = Message::new("1".to_string(), "short".to_string(), vec![]);
        assert_eq!(msg.preview(50), "short");
    }

    #[test]
    fn test_preview_truncated() {
        let msg = Message::new("1".to_string(), "a".repeat(100), vec![]);
        let preview = msg.preview(20);
        assert!(preview.ends_with("..."));
        assert_eq!(preview.len(), 23); // 20 chars + "..."
    }
}
