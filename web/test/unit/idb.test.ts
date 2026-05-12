// Inject fake-indexeddb into jsdom BEFORE importing idb.ts so the module's
// `indexedDB` global resolves to the in-memory implementation.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  STORES,
  idbClear,
  idbDel,
  idbGet,
  idbKeys,
  idbPut,
  idbWipeAll,
  type Store,
} from "../../src/core/idb";

beforeEach(async () => {
  await idbWipeAll();
});

afterEach(async () => {
  await idbWipeAll();
});

describe("idb: schema", () => {
  it("creates every declared store on open (idempotent across calls)", async () => {
    // Touch each store; if a store is missing, the transaction throws.
    for (const s of STORES) {
      await idbPut(s, "smoke", { ok: true });
      const back = await idbGet<{ ok: boolean }>(s, "smoke");
      expect(back?.ok).toBe(true);
    }
  });
});

describe("idb: get/put/del round-trips", () => {
  it("put then get returns the same value", async () => {
    await idbPut("identity", "current", { schema: 1, wrapped: "abc" });
    const back = await idbGet<{ schema: number; wrapped: string }>(
      "identity",
      "current",
    );
    expect(back).toEqual({ schema: 1, wrapped: "abc" });
  });

  it("get on a missing key returns undefined (not null, not throw)", async () => {
    const back = await idbGet("identity", "does-not-exist");
    expect(back).toBeUndefined();
  });

  it("put overwrites the previous value for the same key", async () => {
    await idbPut("identity", "current", { v: 1 });
    await idbPut("identity", "current", { v: 2 });
    const back = await idbGet<{ v: number }>("identity", "current");
    expect(back?.v).toBe(2);
  });

  it("del removes a stored key", async () => {
    await idbPut("identity", "current", { v: 1 });
    await idbDel("identity", "current");
    expect(await idbGet("identity", "current")).toBeUndefined();
  });

  it("del on a missing key is a no-op (does not throw)", async () => {
    await expect(idbDel("identity", "missing")).resolves.toBeUndefined();
  });
});

describe("idb: structured-clone safety", () => {
  it("round-trips Uint8Array byte-for-byte", async () => {
    const original = new Uint8Array([0, 1, 2, 250, 251, 255]);
    await idbPut("cache_messages", "blob", original);
    const back = await idbGet<Uint8Array>("cache_messages", "blob");
    expect([...(back as Uint8Array)]).toEqual([...original]);
  });

  it("round-trips nested objects with arrays and nulls", async () => {
    const value = {
      pendingIds: ["a", "b"],
      pendingDeletes: [],
      remoteEtag: null,
      lastSync: "2026-05-12T00:00:00Z",
    };
    await idbPut("sync_state", "current", value);
    expect(await idbGet("sync_state", "current")).toEqual(value);
  });
});

describe("idb: keys + clear + wipe", () => {
  it("idbKeys lists every key in a store", async () => {
    await idbPut("cache_messages", "msg-1", { id: "msg-1" });
    await idbPut("cache_messages", "msg-2", { id: "msg-2" });
    const keys = await idbKeys("cache_messages");
    expect(new Set(keys)).toEqual(new Set(["msg-1", "msg-2"]));
  });

  it("idbClear removes every entry from a single store but leaves others alone", async () => {
    await idbPut("identity", "current", { v: 1 });
    await idbPut("cache_index", "current", { v: 2 });
    await idbClear("identity");
    expect(await idbGet("identity", "current")).toBeUndefined();
    expect(await idbGet("cache_index", "current")).toEqual({ v: 2 });
  });

  it("idbWipeAll clears every store", async () => {
    for (const s of STORES) await idbPut(s as Store, "k", { v: 1 });
    await idbWipeAll();
    for (const s of STORES) {
      expect(await idbGet(s as Store, "k")).toBeUndefined();
    }
  });
});

describe("idb: isolation between stores", () => {
  it("the same key in different stores is independent", async () => {
    await idbPut("identity", "current", { kind: "identity" });
    await idbPut("sync_state", "current", { kind: "sync_state" });
    const a = await idbGet<{ kind: string }>("identity", "current");
    const b = await idbGet<{ kind: string }>("sync_state", "current");
    expect(a?.kind).toBe("identity");
    expect(b?.kind).toBe("sync_state");
  });
});
