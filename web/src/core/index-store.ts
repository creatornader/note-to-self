// Session state for the PWA: signals that components subscribe to, plus
// helpers that mutate them, encrypt outbound payloads, talk to the Worker,
// and persist sync_state + the encrypted index snapshot to IndexedDB.
//
// State is module-level so route components can import the signals directly
// without prop-drilling or context wiring. Tests reset via __resetSessionForTests.

import { signal } from "@preact/signals";
import { decrypt, encrypt } from "./crypto";
import type { HttpClient } from "./http";
import { idbDel, idbGet, idbPut } from "./idb";
import {
  type Index,
  type IndexEntry,
  type MessageStatus,
  maxStatus,
} from "./merge";
import {
  emptySyncState,
  pull,
  pushIndex,
  type SyncState,
} from "./sync";

const SYNC_STATE_KEY = "current";
const INDEX_CACHE_KEY = "current";

export const identity = signal<string | null>(null);
export const recipient = signal<string | null>(null);
export const index = signal<Index>({ version: 1, messages: [] });
export const syncState = signal<SyncState>(emptySyncState());
export const worker = signal<HttpClient | null>(null);
export const online = signal<boolean>(false);

export function isUnlocked(): boolean {
  return identity.value !== null && recipient.value !== null;
}

export interface UnlockedDeps {
  identity: string;
  recipient: string;
  http: HttpClient;
}

// Move the session into the "unlocked" state. Loads the cached encrypted
// index (if any) and the persisted sync_state from IndexedDB. Callers should
// follow up with `syncNow()` to refresh against the Worker.
export async function setUnlocked(deps: UnlockedDeps): Promise<void> {
  identity.value = deps.identity;
  recipient.value = deps.recipient;
  worker.value = deps.http;

  const persistedState = await idbGet<SyncState>("sync_state", SYNC_STATE_KEY);
  syncState.value = persistedState ?? emptySyncState();

  const cachedIndex = await idbGet<Uint8Array>("cache_index", INDEX_CACHE_KEY);
  if (cachedIndex) {
    try {
      const plaintext = await decrypt(cachedIndex, deps.identity);
      index.value = JSON.parse(new TextDecoder().decode(plaintext)) as Index;
    } catch {
      // Cached ciphertext is stale or wrong identity; fall back to empty.
      index.value = { version: 1, messages: [] };
    }
  } else {
    index.value = { version: 1, messages: [] };
  }
}

// Drop in-memory secrets. The encrypted cache stays put so the next unlock can
// resume offline state.
export function lock(): void {
  identity.value = null;
  recipient.value = null;
  worker.value = null;
}

// Push everything to the Worker we have not yet synced; pull the latest remote
// index; merge in. Persists the merged index ciphertext and the updated
// sync_state to IndexedDB on every call.
//
// Order: pull -> retry pending blob uploads -> retry pending blob deletes ->
// pushIndex. The blob retries clear pending_* as each succeeds, so the
// subsequent pushIndex reflects the latest local view.
export async function syncNow(): Promise<void> {
  const id = requireIdentity();
  const rcp = requireRecipient();
  const http = requireWorker();

  const pulled = await pull(index.value, syncState.value, id, http);
  index.value = pulled.merged;
  syncState.value = pulled.state;
  online.value = pulled.online;

  await persistIndex(rcp);
  await persistSyncState();

  if (!pulled.online) return;

  await retryPendingUploads(http);
  await retryPendingDeletes(http);

  const pushed = await pushIndex(
    index.value,
    syncState.value,
    id,
    rcp,
    http,
  );
  index.value = pushed.index;
  syncState.value = pushed.state;
  await persistIndex(rcp);
  await persistSyncState();
}

async function retryPendingUploads(http: HttpClient): Promise<void> {
  if (syncState.value.pendingIds.length === 0) return;
  const stillPending: string[] = [];
  for (const id of syncState.value.pendingIds) {
    const blob = await idbGet<Uint8Array>("cache_messages", id);
    if (!blob) {
      // Plaintext is gone; assume the blob was a phantom and drop it.
      continue;
    }
    try {
      const r = await http.putMessage(id, blob);
      if (!(r.status >= 200 && r.status < 300)) stillPending.push(id);
    } catch {
      stillPending.push(id);
    }
  }
  syncState.value = { ...syncState.value, pendingIds: stillPending };
}

async function retryPendingDeletes(http: HttpClient): Promise<void> {
  if (syncState.value.pendingDeletes.length === 0) return;
  const stillPending: string[] = [];
  for (const id of syncState.value.pendingDeletes) {
    try {
      const r = await http.deleteMessage(id);
      if (r.status >= 200 && r.status < 300) {
        await idbDel("cache_messages", id);
      } else {
        stillPending.push(id);
      }
    } catch {
      stillPending.push(id);
    }
  }
  syncState.value = { ...syncState.value, pendingDeletes: stillPending };
}

export interface PushNewArgs {
  content: string;
  tags?: string[];
  ttl_seconds?: number | null;
}

// Encrypt and upload a new message. Returns the new id. The message blob
// upload is best-effort: if it fails, the id is queued in pendingIds so the
// next syncNow can retry.
export async function pushNew(args: PushNewArgs): Promise<string> {
  const id = requireIdentity();
  const rcp = requireRecipient();
  const http = requireWorker();

  const messageId = generateId();
  const tags = args.tags ?? [];
  const ttl = args.ttl_seconds ?? null;
  const createdAt = new Date().toISOString();
  const expiresAt =
    ttl !== null && ttl > 0
      ? new Date(Date.now() + ttl * 1000).toISOString()
      : null;

  const messageBlob = await encrypt(
    new TextEncoder().encode(
      JSON.stringify({
        id: messageId,
        content: args.content,
        tags,
        created_at: createdAt,
      }),
    ),
    rcp,
  );

  // Cache the encrypted blob locally so syncNow can retry on failure without
  // re-encrypting (which would require the plaintext we are about to drop).
  await idbPut("cache_messages", messageId, messageBlob);

  let bytesPushed = false;
  try {
    const putResult = await http.putMessage(messageId, messageBlob);
    bytesPushed = putResult.status >= 200 && putResult.status < 300;
  } catch {
    bytesPushed = false;
  }

  const entry: IndexEntry = {
    id: messageId,
    created_at: createdAt,
    tags,
    ttl_seconds: ttl,
    expires_at: expiresAt,
    status: "unread",
    content_preview: args.content.slice(0, 80),
  };

  index.value = {
    ...index.value,
    messages: [...index.value.messages, entry],
  };

  if (!bytesPushed) {
    syncState.value = {
      ...syncState.value,
      pendingIds: addUnique(syncState.value.pendingIds, messageId),
    };
  }

  const pushed = await pushIndex(
    index.value,
    syncState.value,
    id,
    rcp,
    http,
  );
  index.value = pushed.index;
  syncState.value = pushed.state;

  await persistIndex(rcp);
  await persistSyncState();

  return messageId;
}

export async function markRead(id: string): Promise<void> {
  await transitionStatus(id, "read");
}

export async function markConsumed(id: string): Promise<void> {
  await transitionStatus(id, "consumed");
}

async function transitionStatus(id: string, next: MessageStatus): Promise<void> {
  const ident = requireIdentity();
  const rcp = requireRecipient();
  const http = requireWorker();

  const updated = index.value.messages.map((m) =>
    m.id === id ? { ...m, status: maxStatus(m.status, next) } : m,
  );
  if (updated.every((m, i) => m === index.value.messages[i])) {
    return;
  }
  index.value = { ...index.value, messages: updated };

  const pushed = await pushIndex(
    index.value,
    syncState.value,
    ident,
    rcp,
    http,
  );
  index.value = pushed.index;
  syncState.value = pushed.state;

  await persistIndex(rcp);
  await persistSyncState();
}

export async function deleteMessage(id: string): Promise<void> {
  const ident = requireIdentity();
  const rcp = requireRecipient();
  const http = requireWorker();

  const before = index.value.messages.length;
  index.value = {
    ...index.value,
    messages: index.value.messages.filter((m) => m.id !== id),
  };
  if (index.value.messages.length === before) {
    return;
  }

  let bytesDeleted = false;
  try {
    const r = await http.deleteMessage(id);
    bytesDeleted = r.status >= 200 && r.status < 300;
  } catch {
    bytesDeleted = false;
  }

  if (bytesDeleted) {
    // Drop the local ciphertext cache too. retryPendingDeletes does this
    // for queued deletes, but the immediate-success path was orphaning
    // cache_messages entries indefinitely.
    await idbDel("cache_messages", id);
  } else {
    // Queue for retry on next sync. The encrypted blob remains on R2
    // until the queued delete lands; that is acceptable since the index
    // already no longer references it.
    syncState.value = {
      ...syncState.value,
      pendingDeletes: addUnique(syncState.value.pendingDeletes, id),
    };
  }

  const pushed = await pushIndex(
    index.value,
    syncState.value,
    ident,
    rcp,
    http,
  );
  index.value = pushed.index;
  syncState.value = pushed.state;

  await persistIndex(rcp);
  await persistSyncState();
}

async function persistIndex(rcp: string): Promise<void> {
  const ciphertext = await encrypt(
    new TextEncoder().encode(JSON.stringify(index.value)),
    rcp,
  );
  await idbPut("cache_index", INDEX_CACHE_KEY, ciphertext);
}

async function persistSyncState(): Promise<void> {
  await idbPut("sync_state", SYNC_STATE_KEY, syncState.value);
}

function generateId(): string {
  const ts = Date.now();
  const rand = new Uint8Array(4);
  crypto.getRandomValues(rand);
  const hex = [...rand].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${ts}_${hex}`;
}

function addUnique(arr: string[], v: string): string[] {
  return arr.includes(v) ? arr : [...arr, v];
}

function requireIdentity(): string {
  const v = identity.value;
  if (!v) throw new Error("session locked: identity missing");
  return v;
}

function requireRecipient(): string {
  const v = recipient.value;
  if (!v) throw new Error("session locked: recipient missing");
  return v;
}

function requireWorker(): HttpClient {
  const v = worker.value;
  if (!v) throw new Error("session locked: worker http client missing");
  return v;
}

// Test-only reset. Drops every in-memory signal back to defaults. Does NOT
// clear IDB — callers do that explicitly to control the scenario.
export function __resetSessionForTests(): void {
  identity.value = null;
  recipient.value = null;
  worker.value = null;
  index.value = { version: 1, messages: [] };
  syncState.value = emptySyncState();
  online.value = false;
}

export async function clearSessionPersistence(): Promise<void> {
  await idbDel("sync_state", SYNC_STATE_KEY);
  await idbDel("cache_index", INDEX_CACHE_KEY);
}
