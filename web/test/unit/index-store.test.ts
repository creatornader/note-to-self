import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decrypt } from "../../src/core/crypto";
import type { HttpClient } from "../../src/core/http";
import { idbGet, idbWipeAll } from "../../src/core/idb";
import {
  __resetSessionForTests,
  clearSessionPersistence,
  deleteMessage,
  index,
  isUnlocked,
  lock,
  markRead,
  pushNew,
  recipient,
  setUnlocked,
  syncNow,
  syncState,
} from "../../src/core/index-store";

const IDENTITY =
  "AGE-SECRET-KEY-165DD2KMPNETXTLP8A7S7GUHDPFGXQR47UJFTKJXQ39KMWX09YJFQTT7WTE";
const RECIPIENT =
  "age125se5v8yqnpk20gvnflc9mcf4ncxt032e38qy8mf2q0wmtf2eayqqv0708";

interface MockState {
  putIndex: { ciphertext: Uint8Array; ifMatch: string | null }[];
  putMessage: { id: string; ciphertext: Uint8Array }[];
  deletes: string[];
}

function happyMockHttp(): { http: HttpClient; state: MockState } {
  const state: MockState = {
    putIndex: [],
    putMessage: [],
    deletes: [],
  };
  let currentEtag: string | null = null;
  let etagCounter = 0;

  const http: HttpClient = {
    async getIndex() {
      // On every pull we look fresh: same etag we last wrote (the PWA will
      // call this from syncNow but the test does not require remote merging).
      return { status: 404, body: null, etag: null };
    },
    async putIndex(ciphertext, ifMatch) {
      state.putIndex.push({ ciphertext, ifMatch });
      etagCounter++;
      currentEtag = `"e${etagCounter}"`;
      return { status: 200, etag: currentEtag };
    },
    async putMessage(id, ciphertext) {
      state.putMessage.push({ id, ciphertext });
      return { status: 200 };
    },
    async deleteMessage(id) {
      state.deletes.push(id);
      return { status: 204 };
    },
    async getMessage() {
      return { status: 404, body: null };
    },
  };
  return { http, state };
}

beforeEach(async () => {
  __resetSessionForTests();
  await idbWipeAll();
});

afterEach(async () => {
  __resetSessionForTests();
  await idbWipeAll();
});

describe("session lock/unlock", () => {
  it("starts locked", () => {
    expect(isUnlocked()).toBe(false);
  });

  it("setUnlocked populates identity/recipient/worker", async () => {
    const { http } = happyMockHttp();
    await setUnlocked({ identity: IDENTITY, recipient: RECIPIENT, http });
    expect(isUnlocked()).toBe(true);
    expect(recipient.value).toBe(RECIPIENT);
  });

  it("lock drops in-memory secrets but keeps the cached index", async () => {
    const { http } = happyMockHttp();
    await setUnlocked({ identity: IDENTITY, recipient: RECIPIENT, http });
    await pushNew({ content: "hello" });
    const beforeLockCount = index.value.messages.length;
    lock();
    expect(isUnlocked()).toBe(false);
    // Cache ciphertext should still exist
    const cached = await idbGet<Uint8Array>("cache_index", "current");
    expect(cached).toBeDefined();
    // Re-unlock and verify the cached index restores
    await setUnlocked({ identity: IDENTITY, recipient: RECIPIENT, http });
    expect(index.value.messages.length).toBe(beforeLockCount);
  });
});

describe("pushNew", () => {
  it("appends an unread entry, uploads ciphertext, pushes index", async () => {
    const { http, state } = happyMockHttp();
    await setUnlocked({ identity: IDENTITY, recipient: RECIPIENT, http });
    const id = await pushNew({ content: "hello world", tags: ["a"] });

    expect(id).toMatch(/^\d+_[0-9a-f]{8}$/);
    expect(index.value.messages.length).toBe(1);
    const entry = index.value.messages[0];
    expect(entry.status).toBe("unread");
    expect(entry.tags).toEqual(["a"]);
    expect(entry.content_preview).toBe("hello world");

    expect(state.putMessage.length).toBe(1);
    expect(state.putMessage[0].id).toBe(id);
    expect(state.putIndex.length).toBe(1);
  });

  it("queues the id in pendingIds when the message PUT fails", async () => {
    const { state } = happyMockHttp();
    const http: HttpClient = {
      async getIndex() {
        return { status: 404, body: null, etag: null };
      },
      async putIndex(ciphertext, ifMatch) {
        state.putIndex.push({ ciphertext, ifMatch });
        return { status: 200, etag: "\"e1\"" };
      },
      async putMessage(id) {
        // Force a 5xx on the message upload so pendingIds is populated.
        state.putMessage.push({ id, ciphertext: new Uint8Array() });
        return { status: 503 };
      },
      async deleteMessage() {
        return { status: 204 };
      },
      async getMessage() {
        return { status: 404, body: null };
      },
    };
    await setUnlocked({ identity: IDENTITY, recipient: RECIPIENT, http });
    const id = await pushNew({ content: "queued" });
    expect(syncState.value.pendingIds).toContain(id);
  });

  it("ttl_seconds populates expires_at", async () => {
    const { http } = happyMockHttp();
    await setUnlocked({ identity: IDENTITY, recipient: RECIPIENT, http });
    const id = await pushNew({ content: "ephemeral", ttl_seconds: 600 });
    const entry = index.value.messages.find((m) => m.id === id);
    expect(entry?.expires_at).toBeTruthy();
    expect(entry?.ttl_seconds).toBe(600);
  });

  it("persists encrypted index to IDB cache after every push", async () => {
    const { http } = happyMockHttp();
    await setUnlocked({ identity: IDENTITY, recipient: RECIPIENT, http });
    await pushNew({ content: "round-trip" });

    const cached = (await idbGet<Uint8Array>(
      "cache_index",
      "current",
    )) as Uint8Array;
    expect(cached).toBeDefined();

    // Round-trip: decrypt the cached blob with the identity, parse, compare.
    const plain = JSON.parse(
      new TextDecoder().decode(await decrypt(cached, IDENTITY)),
    );
    expect(plain.messages.length).toBe(1);
    expect(plain.messages[0].content_preview).toBe("round-trip");
  });

  it("throws when called locked", async () => {
    await expect(pushNew({ content: "locked" })).rejects.toThrow(/locked/);
  });
});

describe("markRead", () => {
  it("transitions status forward and pushes the new index", async () => {
    const { http, state } = happyMockHttp();
    await setUnlocked({ identity: IDENTITY, recipient: RECIPIENT, http });
    const id = await pushNew({ content: "hello" });
    const putsBefore = state.putIndex.length;

    await markRead(id);
    expect(index.value.messages[0].status).toBe("read");
    expect(state.putIndex.length).toBe(putsBefore + 1);
  });

  it("never moves status backward (max_status semantics)", async () => {
    const { http } = happyMockHttp();
    await setUnlocked({ identity: IDENTITY, recipient: RECIPIENT, http });
    const id = await pushNew({ content: "hello" });

    // Manually bump to consumed in-place to simulate prior progression.
    index.value = {
      ...index.value,
      messages: index.value.messages.map((m) =>
        m.id === id ? { ...m, status: "consumed" } : m,
      ),
    };
    await markRead(id);
    expect(index.value.messages[0].status).toBe("consumed");
  });

  it("no-ops on a missing id", async () => {
    const { http, state } = happyMockHttp();
    await setUnlocked({ identity: IDENTITY, recipient: RECIPIENT, http });
    await pushNew({ content: "hello" });
    const before = state.putIndex.length;
    await markRead("not-an-id");
    expect(state.putIndex.length).toBe(before);
  });
});

describe("deleteMessage", () => {
  it("removes from index, sends DELETE, pushes new index", async () => {
    const { http, state } = happyMockHttp();
    await setUnlocked({ identity: IDENTITY, recipient: RECIPIENT, http });
    const id = await pushNew({ content: "delete me" });
    const putsBefore = state.putIndex.length;

    await deleteMessage(id);
    expect(index.value.messages.length).toBe(0);
    expect(state.deletes).toContain(id);
    expect(state.putIndex.length).toBe(putsBefore + 1);
  });

  it("queues pendingDeletes when DELETE fails", async () => {
    const { http: happy } = happyMockHttp();
    await setUnlocked({ identity: IDENTITY, recipient: RECIPIENT, http: happy });
    const id = await pushNew({ content: "queue me" });

    // Swap in a sad HTTP that fails the DELETE.
    const sad: HttpClient = {
      async getIndex() {
        return { status: 404, body: null, etag: null };
      },
      async putIndex() {
        return { status: 200, etag: "\"x\"" };
      },
      async putMessage() {
        return { status: 200 };
      },
      async deleteMessage() {
        return { status: 503 };
      },
      async getMessage() {
        return { status: 404, body: null };
      },
    };
    // Manually swap the worker by re-unlocking with the new http.
    lock();
    await setUnlocked({ identity: IDENTITY, recipient: RECIPIENT, http: sad });
    // Re-inject the prior message so deleteMessage has something to remove.
    index.value = {
      version: 1,
      messages: [
        {
          id,
          created_at: "2026-01-01T00:00:00Z",
          tags: [],
          ttl_seconds: null,
          expires_at: null,
          status: "unread",
          content_preview: "queue me",
        },
      ],
    };
    await deleteMessage(id);
    expect(syncState.value.pendingDeletes).toContain(id);
  });

  it("no-ops on a missing id", async () => {
    const { http, state } = happyMockHttp();
    await setUnlocked({ identity: IDENTITY, recipient: RECIPIENT, http });
    await deleteMessage("not-an-id");
    expect(state.deletes.length).toBe(0);
    expect(state.putIndex.length).toBe(0);
  });
});

describe("syncNow", () => {
  it("calls pull then push and stamps lastSync", async () => {
    const { http, state } = happyMockHttp();
    await setUnlocked({ identity: IDENTITY, recipient: RECIPIENT, http });
    expect(syncState.value.lastSync).toBeNull();

    await syncNow();
    expect(syncState.value.lastSync).toBeTruthy();
    // 404 path means no remote yet; pushIndex still runs on the empty index.
    expect(state.putIndex.length).toBeGreaterThanOrEqual(1);
  });
});

describe("clearSessionPersistence", () => {
  it("removes cached index and sync_state from IDB", async () => {
    const { http } = happyMockHttp();
    await setUnlocked({ identity: IDENTITY, recipient: RECIPIENT, http });
    await pushNew({ content: "wipe me" });

    expect(await idbGet("cache_index", "current")).toBeDefined();
    await clearSessionPersistence();
    expect(await idbGet("cache_index", "current")).toBeUndefined();
    expect(await idbGet("sync_state", "current")).toBeUndefined();
  });
});
