use crate::index::{Index, IndexEntry, MessageStatus};
use std::collections::HashSet;

pub fn merge(
    local: &Index,
    remote: &Index,
    pending_ids: &HashSet<String>,
    pending_deletes: &HashSet<String>,
) -> Index {
    let mut merged = Index::new();
    let mut seen: HashSet<&str> = HashSet::new();

    // Process all local entries
    for entry in &local.messages {
        seen.insert(&entry.id);

        if let Some(remote_entry) = remote.find_by_id(&entry.id) {
            // Both present: take the one with the later status
            let winner_status = entry.status.max_status(remote_entry.status);
            let mut winner = entry.clone();
            winner.status = winner_status;
            merged.add_entry(winner);
        } else if pending_ids.contains(&entry.id) {
            // Local only + pending sync: keep it
            merged.add_entry(entry.clone());
        }
        // Local only + not pending: removed on another device, drop it
    }

    // Process remote-only entries
    for entry in &remote.messages {
        if seen.contains(entry.id.as_str()) {
            continue;
        }

        if pending_deletes.contains(&entry.id) {
            // Deleted locally, don't re-add
            continue;
        }

        // New from remote: add to local
        merged.add_entry(entry.clone());
    }

    merged
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn entry(id: &str, status: MessageStatus) -> IndexEntry {
        IndexEntry {
            id: id.to_string(),
            created_at: Utc::now(),
            tags: vec![],
            ttl_seconds: None,
            expires_at: None,
            status,
            content_preview: format!("msg {id}"),
        }
    }

    #[test]
    fn test_merge_both_present_takes_later_status() {
        let mut local = Index::new();
        local.add_entry(entry("a", MessageStatus::Unread));

        let mut remote = Index::new();
        remote.add_entry(entry("a", MessageStatus::Read));

        let merged = merge(&local, &remote, &HashSet::new(), &HashSet::new());
        assert_eq!(merged.find_by_id("a").unwrap().status, MessageStatus::Read);
    }

    #[test]
    fn test_merge_remote_only_added_locally() {
        let local = Index::new();
        let mut remote = Index::new();
        remote.add_entry(entry("b", MessageStatus::Unread));

        let merged = merge(&local, &remote, &HashSet::new(), &HashSet::new());
        assert!(merged.find_by_id("b").is_some());
    }

    #[test]
    fn test_merge_remote_only_but_pending_delete_skipped() {
        let local = Index::new();
        let mut remote = Index::new();
        remote.add_entry(entry("c", MessageStatus::Unread));

        let pending_deletes: HashSet<String> = ["c".to_string()].into();
        let merged = merge(&local, &remote, &HashSet::new(), &pending_deletes);
        assert!(merged.find_by_id("c").is_none());
    }

    #[test]
    fn test_merge_local_only_pending_kept() {
        let mut local = Index::new();
        local.add_entry(entry("d", MessageStatus::Unread));

        let remote = Index::new();
        let pending_ids: HashSet<String> = ["d".to_string()].into();

        let merged = merge(&local, &remote, &pending_ids, &HashSet::new());
        assert!(merged.find_by_id("d").is_some());
    }

    #[test]
    fn test_merge_local_only_not_pending_removed() {
        let mut local = Index::new();
        local.add_entry(entry("e", MessageStatus::Unread));

        let remote = Index::new();

        let merged = merge(&local, &remote, &HashSet::new(), &HashSet::new());
        assert!(merged.find_by_id("e").is_none());
    }

    #[test]
    fn test_merge_union_of_disjoint() {
        let mut local = Index::new();
        local.add_entry(entry("x", MessageStatus::Unread));

        let mut remote = Index::new();
        remote.add_entry(entry("y", MessageStatus::Unread));

        let pending_ids: HashSet<String> = ["x".to_string()].into();
        let merged = merge(&local, &remote, &pending_ids, &HashSet::new());

        assert!(merged.find_by_id("x").is_some());
        assert!(merged.find_by_id("y").is_some());
        assert_eq!(merged.messages.len(), 2);
    }

    #[test]
    fn test_merge_empty_indexes() {
        let merged = merge(
            &Index::new(),
            &Index::new(),
            &HashSet::new(),
            &HashSet::new(),
        );
        assert!(merged.messages.is_empty());
    }

    #[test]
    fn test_merge_status_never_moves_backward() {
        let mut local = Index::new();
        local.add_entry(entry("f", MessageStatus::Consumed));

        let mut remote = Index::new();
        remote.add_entry(entry("f", MessageStatus::Unread));

        let merged = merge(&local, &remote, &HashSet::new(), &HashSet::new());
        assert_eq!(
            merged.find_by_id("f").unwrap().status,
            MessageStatus::Consumed
        );
    }
}
