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

    /// Regression: locks in the asymmetry between `local` and `remote`.
    ///
    /// An early property test (`proptest_merge_is_commutative_when_no_pending`)
    /// assumed `merge(A, B, ∅, ∅) == merge(B, A, ∅, ∅)`. It doesn't, and
    /// shouldn't — `local`-only entries with no pending sync are treated as
    /// "deleted on another device" and dropped, while `remote`-only entries
    /// with no pending delete are treated as "new from another device" and
    /// kept. Swapping inputs flips both decisions.
    ///
    /// This test captures the minimal counterexample so anyone tempted to
    /// "fix" the asymmetry sees the intended semantics first.
    #[test]
    fn test_merge_is_not_commutative_for_unilateral_entries() {
        let local = Index::new();
        let mut remote = Index::new();
        remote.add_entry(entry("a", MessageStatus::Unread));

        let ab = merge(&local, &remote, &HashSet::new(), &HashSet::new());
        let ba = merge(&remote, &local, &HashSet::new(), &HashSet::new());

        // Remote-only, not pending-deleted: kept when remote is "remote".
        assert!(ab.find_by_id("a").is_some());
        // Same entry, now in "local" position with no pending sync: dropped.
        assert!(ba.find_by_id("a").is_none());
    }
}

#[cfg(test)]
mod fixture_corpus {
    //! Cross-language merge contract.
    //!
    //! Reads JSON fixtures from `web/test/fixtures/merge/` and asserts the
    //! production `merge` function produces the outputs each fixture's
    //! `expected_ids` and `expected_status_by_id` declare. The TypeScript
    //! port at `web/src/core/merge.ts` reads the SAME files and asserts the
    //! SAME outputs in `web/test/unit/merge.test.ts`. If a fixture passes on
    //! both sides, the two implementations agree on that scenario.
    use super::*;
    use serde::Deserialize;
    use std::collections::{HashMap, HashSet};
    use std::fs;
    use std::path::PathBuf;

    #[derive(Debug, Deserialize)]
    struct Fixture {
        name: String,
        local: Index,
        remote: Index,
        pending_ids: Vec<String>,
        pending_deletes: Vec<String>,
        expected_ids: Vec<String>,
        expected_status_by_id: HashMap<String, MessageStatus>,
    }

    fn fixtures_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("web/test/fixtures/merge")
    }

    #[test]
    fn rust_merge_matches_typescript_port_on_shared_fixtures() {
        let dir = fixtures_dir();
        let entries: Vec<_> = fs::read_dir(&dir)
            .unwrap_or_else(|e| panic!("read {}: {e}", dir.display()))
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .and_then(|x| x.to_str())
                    .is_some_and(|ext| ext == "json")
            })
            .collect();

        assert!(
            !entries.is_empty(),
            "no JSON fixtures found in {}",
            dir.display()
        );

        for entry in entries {
            let path = entry.path();
            let text = fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
            let fx: Fixture = serde_json::from_str(&text)
                .unwrap_or_else(|e| panic!("cannot parse {}: {e}", path.display()));

            let pending_ids: HashSet<String> = fx.pending_ids.iter().cloned().collect();
            let pending_deletes: HashSet<String> =
                fx.pending_deletes.iter().cloned().collect();

            let merged = merge(&fx.local, &fx.remote, &pending_ids, &pending_deletes);

            let actual_ids: HashSet<&str> =
                merged.messages.iter().map(|e| e.id.as_str()).collect();
            let expected_ids: HashSet<&str> =
                fx.expected_ids.iter().map(|s| s.as_str()).collect();

            assert_eq!(
                actual_ids, expected_ids,
                "fixture `{}`: id-set mismatch",
                fx.name
            );
            assert_eq!(
                merged.messages.len(),
                fx.expected_ids.len(),
                "fixture `{}`: duplicate or missing id",
                fx.name
            );
            for (id, expected_status) in &fx.expected_status_by_id {
                let actual = merged.find_by_id(id).unwrap_or_else(|| {
                    panic!("fixture `{}`: id `{id}` missing from merge output", fx.name)
                });
                assert_eq!(
                    &actual.status, expected_status,
                    "fixture `{}`: status mismatch for id `{id}`",
                    fx.name
                );
            }
        }
    }
}

#[cfg(test)]
mod proptests {
    //! Property-based tests for the merge algorithm.
    //!
    //! These tests verify the correctness invariants of `merge` across
    //! randomized two-device interleavings. The case count is controlled
    //! by the `PROPTEST_CASES` environment variable (default: 256).
    //! Run `PROPTEST_CASES=10000 cargo test merge` to exercise at scale.
    use super::*;
    use chrono::{TimeZone, Utc};
    use proptest::collection::{hash_set, vec};
    use proptest::prelude::*;

    /// Build an `IndexEntry` from a (id, status_ordinal) pair.
    ///
    /// `created_at` is derived deterministically from the id so two devices
    /// generating the "same" entry produce byte-identical metadata. Only the
    /// status differs between devices, which mirrors the M2 immutability rule
    /// ("status is the only mutable field").
    fn make_entry(id: &str, status: MessageStatus) -> IndexEntry {
        let hash = id.bytes().map(|b| b as i64).sum::<i64>();
        IndexEntry {
            id: id.to_string(),
            created_at: Utc.timestamp_opt(1_700_000_000 + hash, 0).unwrap(),
            tags: vec![],
            ttl_seconds: None,
            expires_at: None,
            status,
            content_preview: format!("msg {id}"),
        }
    }

    fn status_from_ordinal(o: u8) -> MessageStatus {
        match o % 4 {
            0 => MessageStatus::Unread,
            1 => MessageStatus::Read,
            2 => MessageStatus::Consumed,
            _ => MessageStatus::Expired,
        }
    }

    /// A device's view of a single id: presence flag + status.
    type View = (bool, u8);

    /// A randomized two-device scenario:
    ///   - `ids`: a unique id pool (0..=50 ids).
    ///   - `local_views`, `remote_views`: per-id presence + status on each side.
    ///   - `pending_ids`, `pending_deletes`: subsets of `ids` (modelled as
    ///     index sets to avoid string-aliasing during generation).
    #[derive(Debug, Clone)]
    struct Scenario {
        ids: Vec<String>,
        local_views: Vec<View>,
        remote_views: Vec<View>,
        pending_idx: Vec<usize>,
        pending_del_idx: Vec<usize>,
    }

    impl Scenario {
        fn local(&self) -> Index {
            let mut idx = Index::new();
            for (i, (present, status)) in self.local_views.iter().enumerate() {
                if *present {
                    idx.add_entry(make_entry(&self.ids[i], status_from_ordinal(*status)));
                }
            }
            idx
        }

        fn remote(&self) -> Index {
            let mut idx = Index::new();
            for (i, (present, status)) in self.remote_views.iter().enumerate() {
                if *present {
                    idx.add_entry(make_entry(&self.ids[i], status_from_ordinal(*status)));
                }
            }
            idx
        }

        fn pending_ids(&self) -> HashSet<String> {
            self.pending_idx
                .iter()
                .map(|&i| self.ids[i].clone())
                .collect()
        }

        fn pending_deletes(&self) -> HashSet<String> {
            self.pending_del_idx
                .iter()
                .map(|&i| self.ids[i].clone())
                .collect()
        }
    }

    /// Generate up to 50 unique ids, then assign each one a local view, a
    /// remote view, and (independently) a pending-ids / pending-deletes flag.
    fn scenario_strategy() -> impl Strategy<Value = Scenario> {
        hash_set("[a-z][a-z0-9]{0,5}", 0..50)
            .prop_flat_map(|set| {
                let ids: Vec<String> = set.into_iter().collect();
                let n = ids.len();
                let view = (any::<bool>(), 0u8..4);
                let local = vec(view.clone(), n..=n);
                let remote = vec(view, n..=n);
                let pending = if n == 0 {
                    vec(0..1usize, 0..=0).boxed()
                } else {
                    vec(0..n, 0..=n).boxed()
                };
                let pending_del = if n == 0 {
                    vec(0..1usize, 0..=0).boxed()
                } else {
                    vec(0..n, 0..=n).boxed()
                };
                (Just(ids), local, remote, pending, pending_del)
            })
            .prop_map(
                |(ids, local_views, remote_views, pending_idx, pending_del_idx)| Scenario {
                    ids,
                    local_views,
                    remote_views,
                    pending_idx,
                    pending_del_idx,
                },
            )
    }

    /// Helper: collect (id -> status) pairs from a merged index.
    fn to_map(idx: &Index) -> std::collections::BTreeMap<String, MessageStatus> {
        idx.messages
            .iter()
            .map(|e| (e.id.clone(), e.status))
            .collect()
    }

    proptest! {
        /// Invariant 1 (convergence on shared ids): for any id that appears
        /// in BOTH inputs, the merged status is the same regardless of which
        /// side is `local` vs `remote`. This is the actual symmetry the
        /// merge algorithm provides: status reconciliation via
        /// `MessageStatus::max_status` is commutative.
        ///
        /// Note: full `merge(A, B, ...) == merge(B, A, ...)` does NOT hold,
        /// and that's intentional. `local` and `remote` are asymmetric roles
        /// in this merge: `pending_ids` and `pending_deletes` are *local*
        /// device state, so swapping inputs changes semantics. The
        /// system-level convergence guarantee is captured at the sync
        /// layer (see `src/sync.rs` and the M2 spec), not here. See the
        /// regression test `regression_commutativity_does_not_hold_for_unilateral_entries`
        /// below for the minimal example.
        #[test]
        fn proptest_merge_converges_on_shared_ids(scenario in scenario_strategy()) {
            let local = scenario.local();
            let remote = scenario.remote();
            let empty: HashSet<String> = HashSet::new();

            let ab = merge(&local, &remote, &empty, &empty);
            let ba = merge(&remote, &local, &empty, &empty);

            // Any id that appears in BOTH inputs must agree on status,
            // regardless of merge direction.
            for entry in &local.messages {
                if remote.find_by_id(&entry.id).is_some() {
                    let ab_status = ab.find_by_id(&entry.id).map(|e| e.status);
                    let ba_status = ba.find_by_id(&entry.id).map(|e| e.status);
                    prop_assert_eq!(ab_status, ba_status);
                    prop_assert!(ab_status.is_some());
                }
            }
        }

        /// Invariant 2 (idempotence): re-merging the result against the same
        /// remote yields the same set of ids and statuses. Tested with empty
        /// pending state — the steady state right after a successful sync,
        /// when there is nothing pending locally.
        #[test]
        fn proptest_merge_is_idempotent(scenario in scenario_strategy()) {
            let local = scenario.local();
            let remote = scenario.remote();
            let empty: HashSet<String> = HashSet::new();

            let once = merge(&local, &remote, &empty, &empty);
            let twice = merge(&once, &remote, &empty, &empty);

            prop_assert_eq!(to_map(&once), to_map(&twice));
        }

        /// Invariant 3 (status monotonicity): for any id present in both
        /// inputs, the merged status is >= both input statuses by the
        /// `MessageStatus::ordinal` ordering.
        #[test]
        fn proptest_merge_status_is_monotonic(scenario in scenario_strategy()) {
            let local = scenario.local();
            let remote = scenario.remote();
            let pending_ids = scenario.pending_ids();
            let pending_deletes = scenario.pending_deletes();

            let merged = merge(&local, &remote, &pending_ids, &pending_deletes);

            for entry in &merged.messages {
                let l = local.find_by_id(&entry.id);
                let r = remote.find_by_id(&entry.id);
                if let (Some(l), Some(r)) = (l, r) {
                    prop_assert!(entry.status.ordinal() >= l.status.ordinal());
                    prop_assert!(entry.status.ordinal() >= r.status.ordinal());
                }
            }
        }

        /// Invariant 4 (no spontaneous resurrection): if an id is in
        /// `pending_deletes` AND only appears in remote, it must not appear
        /// in the merged output. (If it also appears locally, that's a
        /// distinct case — the caller normally wouldn't add an id to both
        /// `pending_deletes` and the local index, but the merge still has to
        /// be safe.)
        #[test]
        fn proptest_no_spontaneous_resurrection(scenario in scenario_strategy()) {
            let local = scenario.local();
            let remote = scenario.remote();
            let pending_ids = scenario.pending_ids();
            let pending_deletes = scenario.pending_deletes();

            let merged = merge(&local, &remote, &pending_ids, &pending_deletes);

            for id in &pending_deletes {
                let in_local = local.find_by_id(id).is_some();
                let in_remote = remote.find_by_id(id).is_some();
                if in_remote && !in_local {
                    prop_assert!(
                        merged.find_by_id(id).is_none(),
                        "id {id} is pending-deleted and remote-only, must not appear in merge"
                    );
                }
            }
        }

        /// Invariant 5 (no spontaneous loss): if an id is in `pending_ids`
        /// AND only appears local, it must appear in the merged output.
        /// This is the "I pushed offline, haven't synced yet" case.
        #[test]
        fn proptest_no_spontaneous_loss(scenario in scenario_strategy()) {
            let local = scenario.local();
            let remote = scenario.remote();
            let pending_ids = scenario.pending_ids();
            let pending_deletes = scenario.pending_deletes();

            let merged = merge(&local, &remote, &pending_ids, &pending_deletes);

            for id in &pending_ids {
                let in_local = local.find_by_id(id).is_some();
                let in_remote = remote.find_by_id(id).is_some();
                if in_local && !in_remote {
                    prop_assert!(
                        merged.find_by_id(id).is_some(),
                        "id {id} is pending-sync and local-only, must appear in merge"
                    );
                }
            }
        }

        /// Invariant 6 (no duplicates): every id appears at most once in the
        /// merged output. The merge function relies on its inputs having
        /// unique ids (which the rest of the system upholds via id
        /// generation); this property locks that contract in.
        #[test]
        fn proptest_merge_has_no_duplicate_ids(scenario in scenario_strategy()) {
            let local = scenario.local();
            let remote = scenario.remote();
            let pending_ids = scenario.pending_ids();
            let pending_deletes = scenario.pending_deletes();

            let merged = merge(&local, &remote, &pending_ids, &pending_deletes);

            let mut seen: HashSet<&str> = HashSet::new();
            for entry in &merged.messages {
                prop_assert!(
                    seen.insert(entry.id.as_str()),
                    "duplicate id {} in merged output",
                    entry.id
                );
            }
        }

        /// Invariant 7 (closed universe): every id in the merged output came
        /// from either local or remote. The merge function never invents ids.
        #[test]
        fn proptest_merge_invents_no_ids(scenario in scenario_strategy()) {
            let local = scenario.local();
            let remote = scenario.remote();
            let pending_ids = scenario.pending_ids();
            let pending_deletes = scenario.pending_deletes();

            let merged = merge(&local, &remote, &pending_ids, &pending_deletes);

            let universe: HashSet<&str> = local
                .messages
                .iter()
                .chain(remote.messages.iter())
                .map(|e| e.id.as_str())
                .collect();

            for entry in &merged.messages {
                prop_assert!(
                    universe.contains(entry.id.as_str()),
                    "merged contained id {} not in either input",
                    entry.id
                );
            }
        }

        /// Bonus invariant: local-only entries that are NOT in `pending_ids`
        /// must be dropped from the merged output. This is the "remote
        /// deleted it while we were offline" semantics — local state should
        /// converge to remote when there's no local intent to keep it.
        #[test]
        fn proptest_local_only_non_pending_is_dropped(scenario in scenario_strategy()) {
            let local = scenario.local();
            let remote = scenario.remote();
            let pending_ids = scenario.pending_ids();
            let pending_deletes = scenario.pending_deletes();

            let merged = merge(&local, &remote, &pending_ids, &pending_deletes);

            for entry in &local.messages {
                let in_remote = remote.find_by_id(&entry.id).is_some();
                let is_pending = pending_ids.contains(&entry.id);
                if !in_remote && !is_pending {
                    prop_assert!(
                        merged.find_by_id(&entry.id).is_none(),
                        "id {} is local-only and not pending, should be dropped",
                        entry.id
                    );
                }
            }
        }

        /// Bonus invariant: remote-only entries that are NOT in
        /// `pending_deletes` must appear in the merged output. This is the
        /// "the other device added a new message" case.
        #[test]
        fn proptest_remote_only_non_pending_delete_is_kept(
            scenario in scenario_strategy()
        ) {
            let local = scenario.local();
            let remote = scenario.remote();
            let pending_ids = scenario.pending_ids();
            let pending_deletes = scenario.pending_deletes();

            let merged = merge(&local, &remote, &pending_ids, &pending_deletes);

            for entry in &remote.messages {
                let in_local = local.find_by_id(&entry.id).is_some();
                let is_pending_del = pending_deletes.contains(&entry.id);
                if !in_local && !is_pending_del {
                    prop_assert!(
                        merged.find_by_id(&entry.id).is_some(),
                        "id {} is remote-only and not pending-deleted, should be kept",
                        entry.id
                    );
                }
            }
        }
    }
}
