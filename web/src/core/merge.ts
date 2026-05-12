// TypeScript port of src/merge.rs. Shape and semantics must stay byte-identical
// to the Rust side. See web/test/fixtures/merge/ for the shared fixture corpus
// that both implementations run against.
//
// Key invariant (locked in by src/merge.rs proptests and the regression test
// test_merge_is_not_commutative_for_unilateral_entries): `local` and `remote`
// are asymmetric roles. `pendingIds` and `pendingDeletes` come from the local
// device's sync_state and never travel with the remote index. Do not refactor
// toward a symmetric signature.

export type MessageStatus = "unread" | "read" | "consumed" | "expired";

export interface IndexEntry {
  id: string;
  created_at: string;
  tags: string[];
  ttl_seconds: number | null;
  expires_at: string | null;
  status: MessageStatus;
  content_preview: string;
}

export interface Index {
  version: number;
  messages: IndexEntry[];
}

const STATUS_ORDINAL: Record<MessageStatus, number> = {
  unread: 0,
  read: 1,
  consumed: 2,
  expired: 3,
};

export function maxStatus(a: MessageStatus, b: MessageStatus): MessageStatus {
  return STATUS_ORDINAL[a] >= STATUS_ORDINAL[b] ? a : b;
}

export function merge(
  local: Index,
  remote: Index,
  pendingIds: Set<string>,
  pendingDeletes: Set<string>,
): Index {
  const merged: IndexEntry[] = [];
  const seen = new Set<string>();
  const remoteById = new Map(remote.messages.map((e) => [e.id, e]));

  for (const entry of local.messages) {
    seen.add(entry.id);
    const remoteEntry = remoteById.get(entry.id);
    if (remoteEntry) {
      merged.push({ ...entry, status: maxStatus(entry.status, remoteEntry.status) });
    } else if (pendingIds.has(entry.id)) {
      merged.push({ ...entry });
    }
    // local-only + not pending: dropped (assumed deleted on another device)
  }

  for (const entry of remote.messages) {
    if (seen.has(entry.id)) continue;
    if (pendingDeletes.has(entry.id)) continue;
    merged.push({ ...entry });
  }

  return { version: local.version, messages: merged };
}
