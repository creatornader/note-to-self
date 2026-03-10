use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageStatus {
    Unread,
    Read,
    Consumed,
    Expired,
}

impl std::fmt::Display for MessageStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unread => write!(f, "unread"),
            Self::Read => write!(f, "read"),
            Self::Consumed => write!(f, "consumed"),
            Self::Expired => write!(f, "expired"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexEntry {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub tags: Vec<String>,
    pub ttl_seconds: Option<u64>,
    pub expires_at: Option<DateTime<Utc>>,
    pub status: MessageStatus,
    pub content_preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Index {
    pub version: u32,
    pub messages: Vec<IndexEntry>,
}

impl Index {
    pub fn new() -> Self {
        Self {
            version: 1,
            messages: Vec::new(),
        }
    }

    pub fn add_entry(&mut self, entry: IndexEntry) {
        self.messages.push(entry);
    }

    pub fn find_by_id(&self, id: &str) -> Option<&IndexEntry> {
        self.messages.iter().find(|e| e.id == id)
    }

    pub fn find_by_id_mut(&mut self, id: &str) -> Option<&mut IndexEntry> {
        self.messages.iter_mut().find(|e| e.id == id)
    }

    pub fn latest_unread(&self) -> Option<&IndexEntry> {
        self.messages
            .iter()
            .rev()
            .find(|e| e.status == MessageStatus::Unread)
    }

    pub fn enforce_ttl(&mut self) {
        let now = Utc::now();
        for entry in &mut self.messages {
            if let Some(expires_at) = entry.expires_at
                && now >= expires_at
                && entry.status != MessageStatus::Expired
            {
                entry.status = MessageStatus::Expired;
            }
        }
    }

    pub fn remove_by_id(&mut self, id: &str) -> bool {
        let len_before = self.messages.len();
        self.messages.retain(|e| e.id != id);
        self.messages.len() < len_before
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn make_entry(id: &str, status: MessageStatus) -> IndexEntry {
        IndexEntry {
            id: id.to_string(),
            created_at: Utc::now(),
            tags: vec![],
            ttl_seconds: None,
            expires_at: None,
            status,
            content_preview: format!("preview {id}"),
        }
    }

    #[test]
    fn test_new_index() {
        let idx = Index::new();
        assert_eq!(idx.version, 1);
        assert!(idx.messages.is_empty());
    }

    #[test]
    fn test_add_and_find() {
        let mut idx = Index::new();
        idx.add_entry(make_entry("abc", MessageStatus::Unread));
        assert!(idx.find_by_id("abc").is_some());
        assert!(idx.find_by_id("xyz").is_none());
    }

    #[test]
    fn test_latest_unread() {
        let mut idx = Index::new();
        idx.add_entry(make_entry("1", MessageStatus::Unread));
        idx.add_entry(make_entry("2", MessageStatus::Read));
        idx.add_entry(make_entry("3", MessageStatus::Unread));
        assert_eq!(idx.latest_unread().unwrap().id, "3");
    }

    #[test]
    fn test_latest_unread_none() {
        let mut idx = Index::new();
        idx.add_entry(make_entry("1", MessageStatus::Read));
        assert!(idx.latest_unread().is_none());
    }

    #[test]
    fn test_enforce_ttl() {
        let mut idx = Index::new();
        let mut entry = make_entry("1", MessageStatus::Unread);
        entry.expires_at = Some(Utc::now() - Duration::seconds(10));
        idx.add_entry(entry);
        idx.enforce_ttl();
        assert_eq!(idx.find_by_id("1").unwrap().status, MessageStatus::Expired);
    }

    #[test]
    fn test_enforce_ttl_not_expired() {
        let mut idx = Index::new();
        let mut entry = make_entry("1", MessageStatus::Unread);
        entry.expires_at = Some(Utc::now() + Duration::seconds(3600));
        idx.add_entry(entry);
        idx.enforce_ttl();
        assert_eq!(idx.find_by_id("1").unwrap().status, MessageStatus::Unread);
    }

    #[test]
    fn test_remove_by_id() {
        let mut idx = Index::new();
        idx.add_entry(make_entry("1", MessageStatus::Unread));
        idx.add_entry(make_entry("2", MessageStatus::Unread));
        assert!(idx.remove_by_id("1"));
        assert_eq!(idx.messages.len(), 1);
        assert!(!idx.remove_by_id("nonexistent"));
    }

    #[test]
    fn test_serialization_roundtrip() {
        let mut idx = Index::new();
        idx.add_entry(make_entry("1", MessageStatus::Unread));
        let json = serde_json::to_string(&idx).unwrap();
        let deserialized: Index = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.messages.len(), 1);
        assert_eq!(deserialized.messages[0].id, "1");
    }
}
