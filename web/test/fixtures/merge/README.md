# Merge fixtures

A corpus of JSON fixtures shared between the Rust merge (`src/merge.rs`) and
the TypeScript merge (`web/src/core/merge.ts`). Both implementations run the
same inputs and must produce the same outputs.

## Schema

```jsonc
{
  "name": "human-readable label",
  "local": { "version": 1, "messages": [/* IndexEntry */] },
  "remote": { "version": 1, "messages": [/* IndexEntry */] },
  "pending_ids": ["..."],
  "pending_deletes": ["..."],
  "expected_ids": ["..."],
  "expected_status_by_id": { "id": "unread|read|consumed|expired" }
}
```

`expected_ids` is compared as a set (order-agnostic): the merge function
preserves a meaningful order but the contract here is identity coverage, not
ordering. `expected_status_by_id` covers every id in `expected_ids`.

`IndexEntry` matches `src/index.rs`:

```jsonc
{
  "id": "string",
  "created_at": "RFC3339 string",
  "tags": ["string"],
  "ttl_seconds": null | number,
  "expires_at": null | "RFC3339 string",
  "status": "unread | read | consumed | expired",
  "content_preview": "string"
}
```

## Coverage

Each fixture mirrors a unit test in `src/merge.rs`. The 1:1 mapping makes it
easy to keep coverage in sync: when a Rust test is added, add the equivalent
fixture; when a fixture is added, the Rust test asserting it lives in
`tests/merge_fixtures.rs`.

| Fixture | Rust test |
|---------|-----------|
| `01_empty.json` | `test_merge_empty_indexes` |
| `02_both_present_takes_later_status.json` | `test_merge_both_present_takes_later_status` |
| `03_remote_only_added_locally.json` | `test_merge_remote_only_added_locally` |
| `04_remote_only_pending_delete_skipped.json` | `test_merge_remote_only_but_pending_delete_skipped` |
| `05_local_only_pending_kept.json` | `test_merge_local_only_pending_kept` |
| `06_local_only_not_pending_removed.json` | `test_merge_local_only_not_pending_removed` |
| `07_union_of_disjoint.json` | `test_merge_union_of_disjoint` |
| `08_status_never_moves_backward.json` | `test_merge_status_never_moves_backward` |
