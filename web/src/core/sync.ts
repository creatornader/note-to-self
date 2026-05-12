// TypeScript port of src/sync.rs.
//
// Mirrors the Rust sync semantics: pull merges the remote index with the local
// index using the same merge algorithm; pushIndex retries up to
// MAX_ETAG_RETRIES on 412 by re-pulling, re-merging, and re-encrypting.
//
// Like the Rust sync layer, this module treats the merge function's local /
// remote roles as asymmetric. See src/merge.rs and the deferred CRDT decision
// in docs/architecture.md.

import { decrypt, encrypt } from "./crypto";
import { merge, type Index } from "./merge";
import type { HttpClient } from "./http";

export const MAX_ETAG_RETRIES = 3;

export interface SyncState {
  pendingIds: string[];
  pendingDeletes: string[];
  remoteEtag: string | null;
  lastSync: string | null;
}

export function emptySyncState(): SyncState {
  return {
    pendingIds: [],
    pendingDeletes: [],
    remoteEtag: null,
    lastSync: null,
  };
}

export interface PullResult {
  merged: Index;
  state: SyncState;
  online: boolean;
}

// Pull the remote index, decrypt it, merge it with the local index. Returns
// the merged index and an updated sync state with the latest remote etag.
export async function pull(
  local: Index,
  state: SyncState,
  identity: string,
  http: HttpClient,
): Promise<PullResult> {
  let r;
  try {
    r = await http.getIndex(state.remoteEtag);
  } catch {
    return { merged: local, state, online: false };
  }

  // 304 means the remote etag matches our cached one; the local cache is
  // still authoritative.
  if (r.status === 304) {
    return { merged: local, state, online: true };
  }
  // 404 means no remote index yet (first sync from this device). We are
  // online but there's nothing to pull.
  if (r.status === 404) {
    return {
      merged: local,
      state: { ...state, lastSync: new Date().toISOString() },
      online: true,
    };
  }
  if (r.status >= 500) {
    return { merged: local, state, online: true };
  }
  if (!r.body || r.status !== 200) {
    return { merged: local, state, online: false };
  }

  let remote: Index;
  try {
    const plaintext = await decrypt(r.body, identity);
    remote = JSON.parse(new TextDecoder().decode(plaintext)) as Index;
  } catch {
    return { merged: local, state, online: true };
  }

  const merged = merge(
    local,
    remote,
    new Set(state.pendingIds),
    new Set(state.pendingDeletes),
  );

  return {
    merged,
    state: {
      ...state,
      remoteEtag: r.etag,
      lastSync: new Date().toISOString(),
    },
    online: true,
  };
}

export interface PushResult {
  ok: boolean;
  state: SyncState;
  index: Index;
}

// Push the encrypted index to the worker. On 412 (ETag precondition failed),
// pull the latest remote index, re-merge, and retry. Mirrors the Rust
// `push_index` retry loop at src/sync.rs MAX_ETAG_RETRIES.
export async function pushIndex(
  index: Index,
  state: SyncState,
  identity: string,
  recipient: string,
  http: HttpClient,
): Promise<PushResult> {
  let current = index;
  let s = state;

  for (let attempt = 0; attempt < MAX_ETAG_RETRIES; attempt++) {
    const ciphertext = await encrypt(
      new TextEncoder().encode(JSON.stringify(current)),
      recipient,
    );

    let r;
    try {
      r = await http.putIndex(ciphertext, s.remoteEtag);
    } catch {
      return { ok: false, state: s, index: current };
    }

    if (r.status === 200) {
      // pushIndex does NOT clear pendingIds/pendingDeletes. Those track blob
      // uploads and deletes that have not yet been confirmed; they get cleared
      // by the retry sweep in syncNow as each blob round-trips successfully.
      // This mirrors src/sync.rs::push_index, which leaves pending_* alone.
      return {
        ok: true,
        state: {
          ...s,
          remoteEtag: r.etag,
          lastSync: new Date().toISOString(),
        },
        index: current,
      };
    }

    if (r.status === 412) {
      // Stale etag. Re-pull, re-merge, retry.
      const repulled = await pull(current, s, identity, http);
      current = repulled.merged;
      s = repulled.state;
      continue;
    }

    return { ok: false, state: s, index: current };
  }

  return { ok: false, state: s, index: current };
}
