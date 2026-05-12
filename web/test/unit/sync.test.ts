// Sync tests use a real age round-trip (encrypt with rage-recipient, decrypt
// with rage-identity) so the index ciphertext we hand the mock-HTTP layer is
// what the Worker would actually see. The wire shape is what matters — the
// mock returns whatever bytes the test wants the PWA to read.

import { beforeEach, describe, expect, it } from "vitest";
import { encrypt } from "../../src/core/crypto";
import type { HttpClient } from "../../src/core/http";
import {
  type Index,
  type IndexEntry,
  type MessageStatus,
} from "../../src/core/merge";
import {
  MAX_ETAG_RETRIES,
  emptySyncState,
  pull,
  pushIndex,
  type SyncState,
} from "../../src/core/sync";

const IDENTITY =
  "AGE-SECRET-KEY-165DD2KMPNETXTLP8A7S7GUHDPFGXQR47UJFTKJXQ39KMWX09YJFQTT7WTE";
const RECIPIENT =
  "age125se5v8yqnpk20gvnflc9mcf4ncxt032e38qy8mf2q0wmtf2eayqqv0708";

function entry(id: string, status: MessageStatus = "unread"): IndexEntry {
  return {
    id,
    created_at: "2026-01-01T00:00:00Z",
    tags: [],
    ttl_seconds: null,
    expires_at: null,
    status,
    content_preview: `msg ${id}`,
  };
}

function emptyIndex(): Index {
  return { version: 1, messages: [] };
}

async function encryptedIndex(index: Index): Promise<Uint8Array> {
  return encrypt(new TextEncoder().encode(JSON.stringify(index)), RECIPIENT);
}

interface MockHttpHistory {
  getIndex: { etag: string | null }[];
  putIndex: { ifMatch: string | null; ciphertext: Uint8Array }[];
}

function mockHttp(opts: {
  getResponses: Array<{ status: number; body?: Uint8Array; etag?: string | null }>;
  putResponses: Array<{ status: number; etag?: string | null }>;
  failGetWith?: Error;
  failPutWith?: Error;
}): { http: HttpClient; history: MockHttpHistory } {
  const history: MockHttpHistory = { getIndex: [], putIndex: [] };
  const gets = [...opts.getResponses];
  const puts = [...opts.putResponses];

  const http: HttpClient = {
    async getIndex(etag) {
      history.getIndex.push({ etag });
      if (opts.failGetWith) throw opts.failGetWith;
      const r = gets.shift();
      if (!r) throw new Error("mockHttp: getIndex called more times than expected");
      return {
        status: r.status,
        body: r.body ?? null,
        etag: r.etag ?? null,
      };
    },
    async putIndex(ciphertext, ifMatch) {
      history.putIndex.push({ ifMatch, ciphertext });
      if (opts.failPutWith) throw opts.failPutWith;
      const r = puts.shift();
      if (!r) throw new Error("mockHttp: putIndex called more times than expected");
      return { status: r.status, etag: r.etag ?? null };
    },
    async getMessage() {
      throw new Error("not used");
    },
    async putMessage() {
      throw new Error("not used");
    },
    async deleteMessage() {
      throw new Error("not used");
    },
  };
  return { http, history };
}

describe("pull", () => {
  let state: SyncState;
  beforeEach(() => {
    state = emptySyncState();
  });

  it("304 means cache hit: returns local unchanged, online=true", async () => {
    const { http } = mockHttp({
      getResponses: [{ status: 304 }],
      putResponses: [],
    });
    state.remoteEtag = "\"abc\"";
    const local = emptyIndex();
    local.messages.push(entry("a"));
    const r = await pull(local, state, IDENTITY, http);
    expect(r.online).toBe(true);
    expect(r.merged).toBe(local);
    expect(r.state).toBe(state);
  });

  it("404 means no remote yet: keep local, stamp lastSync, online=true", async () => {
    const { http } = mockHttp({
      getResponses: [{ status: 404 }],
      putResponses: [],
    });
    const r = await pull(emptyIndex(), state, IDENTITY, http);
    expect(r.online).toBe(true);
    expect(r.state.lastSync).toBeTruthy();
    expect(r.merged.messages).toEqual([]);
  });

  it("200 with ciphertext merges remote into local", async () => {
    const remote = emptyIndex();
    remote.messages.push(entry("b"));
    const body = await encryptedIndex(remote);

    const { http } = mockHttp({
      getResponses: [{ status: 200, body, etag: "\"e1\"" }],
      putResponses: [],
    });
    const local = emptyIndex();
    const r = await pull(local, state, IDENTITY, http);
    expect(r.online).toBe(true);
    expect(r.merged.messages.map((m) => m.id)).toEqual(["b"]);
    expect(r.state.remoteEtag).toBe("\"e1\"");
    expect(r.state.lastSync).toBeTruthy();
  });

  it("respects local/remote asymmetry: local-only without pending_id is dropped on pull", async () => {
    // Local has "x", remote has nothing. With empty pending_ids, the merge
    // semantics drop "x" — it would mean "remote deleted it while we were
    // offline." This mirrors src/merge.rs.
    const remote = emptyIndex();
    const body = await encryptedIndex(remote);
    const { http } = mockHttp({
      getResponses: [{ status: 200, body, etag: "\"e1\"" }],
      putResponses: [],
    });
    const local = emptyIndex();
    local.messages.push(entry("x"));
    const r = await pull(local, state, IDENTITY, http);
    expect(r.merged.messages.map((m) => m.id)).toEqual([]);
  });

  it("network error returns online=false and preserves state", async () => {
    const { http } = mockHttp({
      getResponses: [],
      putResponses: [],
      failGetWith: new Error("offline"),
    });
    const local = emptyIndex();
    local.messages.push(entry("c"));
    const r = await pull(local, state, IDENTITY, http);
    expect(r.online).toBe(false);
    expect(r.merged).toBe(local);
  });

  it("5xx surfaces as online=true with no merge", async () => {
    const { http } = mockHttp({
      getResponses: [{ status: 503 }],
      putResponses: [],
    });
    const local = emptyIndex();
    const r = await pull(local, state, IDENTITY, http);
    expect(r.online).toBe(true);
    expect(r.merged).toBe(local);
  });

  it("decrypt failure keeps local cache; reports online=true", async () => {
    const { http } = mockHttp({
      getResponses: [
        { status: 200, body: new Uint8Array([1, 2, 3, 4]), etag: "\"bad\"" },
      ],
      putResponses: [],
    });
    const local = emptyIndex();
    const r = await pull(local, state, IDENTITY, http);
    expect(r.online).toBe(true);
    expect(r.merged).toBe(local);
  });
});

describe("pushIndex", () => {
  let state: SyncState;
  beforeEach(() => {
    state = emptySyncState();
  });

  it("first push (no etag) sends If-None-Match: *, stamps state, clears pending", async () => {
    const { http, history } = mockHttp({
      getResponses: [],
      putResponses: [{ status: 200, etag: "\"e1\"" }],
    });
    state.pendingIds = ["a", "b"];
    state.pendingDeletes = ["c"];
    const local = emptyIndex();
    local.messages.push(entry("a"));
    const r = await pushIndex(local, state, IDENTITY, RECIPIENT, http);
    expect(r.ok).toBe(true);
    expect(r.state.remoteEtag).toBe("\"e1\"");
    expect(r.state.pendingIds).toEqual([]);
    expect(r.state.pendingDeletes).toEqual([]);
    expect(r.state.lastSync).toBeTruthy();
    expect(history.putIndex.length).toBe(1);
    expect(history.putIndex[0].ifMatch).toBeNull();
  });

  it("subsequent push sends If-Match with the known etag", async () => {
    const { http, history } = mockHttp({
      getResponses: [],
      putResponses: [{ status: 200, etag: "\"e2\"" }],
    });
    state.remoteEtag = "\"e1\"";
    const r = await pushIndex(emptyIndex(), state, IDENTITY, RECIPIENT, http);
    expect(r.ok).toBe(true);
    expect(history.putIndex[0].ifMatch).toBe("\"e1\"");
    expect(r.state.remoteEtag).toBe("\"e2\"");
  });

  it("412 triggers pull + re-merge + retry, eventually succeeds", async () => {
    const remote = emptyIndex();
    remote.messages.push(entry("from-other-device"));
    const body = await encryptedIndex(remote);

    const { http, history } = mockHttp({
      getResponses: [{ status: 200, body, etag: "\"e2\"" }],
      putResponses: [
        { status: 412 },
        { status: 200, etag: "\"e3\"" },
      ],
    });
    state.remoteEtag = "\"e1\"";
    const local = emptyIndex();
    local.messages.push(entry("local-pending"));
    state.pendingIds = ["local-pending"];

    const r = await pushIndex(local, state, IDENTITY, RECIPIENT, http);
    expect(r.ok).toBe(true);
    expect(r.state.remoteEtag).toBe("\"e3\"");
    expect(history.putIndex.length).toBe(2);
    // Second PUT used the etag returned by the intervening pull.
    expect(history.putIndex[1].ifMatch).toBe("\"e2\"");
    // The merged index that got pushed includes both ids.
    expect(r.index.messages.map((m) => m.id).sort()).toEqual([
      "from-other-device",
      "local-pending",
    ]);
  });

  it("persistent 412 fails after MAX_ETAG_RETRIES", async () => {
    const remote = emptyIndex();
    const body = await encryptedIndex(remote);

    const { http, history } = mockHttp({
      getResponses: Array.from({ length: MAX_ETAG_RETRIES }, () => ({
        status: 200 as const,
        body,
        etag: "\"never-good\"",
      })),
      putResponses: Array.from({ length: MAX_ETAG_RETRIES }, () => ({
        status: 412 as const,
      })),
    });
    const r = await pushIndex(emptyIndex(), state, IDENTITY, RECIPIENT, http);
    expect(r.ok).toBe(false);
    expect(history.putIndex.length).toBe(MAX_ETAG_RETRIES);
  });

  it("non-retryable error (e.g. 403) returns ok=false without retry", async () => {
    const { http, history } = mockHttp({
      getResponses: [],
      putResponses: [{ status: 403 }],
    });
    const r = await pushIndex(emptyIndex(), state, IDENTITY, RECIPIENT, http);
    expect(r.ok).toBe(false);
    expect(history.putIndex.length).toBe(1);
  });

  it("network error returns ok=false and preserves state", async () => {
    const { http } = mockHttp({
      getResponses: [],
      putResponses: [],
      failPutWith: new Error("offline"),
    });
    state.remoteEtag = "\"e1\"";
    const r = await pushIndex(emptyIndex(), state, IDENTITY, RECIPIENT, http);
    expect(r.ok).toBe(false);
    expect(r.state.remoteEtag).toBe("\"e1\"");
  });
});
