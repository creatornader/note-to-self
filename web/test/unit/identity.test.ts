import { describe, expect, it } from "vitest";
import {
  unwrapIdentity,
  unwrapSecret,
  wrapIdentity,
  wrapSecret,
  type WrappedIdentity,
} from "../../src/core/identity";

const FIXTURE_IDENTITY =
  "AGE-SECRET-KEY-165DD2KMPNETXTLP8A7S7GUHDPFGXQR47UJFTKJXQ39KMWX09YJFQTT7WTE";
const FIXTURE_RECIPIENT =
  "age125se5v8yqnpk20gvnflc9mcf4ncxt032e38qy8mf2q0wmtf2eayqqv0708";

describe("wrapIdentity / unwrapIdentity", () => {
  it("round-trips with the correct passphrase", async () => {
    const w = await wrapIdentity(FIXTURE_IDENTITY, FIXTURE_RECIPIENT, "hunter2");
    expect(await unwrapIdentity(w, "hunter2")).toBe(FIXTURE_IDENTITY);
  });

  it("preserves the recipient public key in cleartext", async () => {
    const w = await wrapIdentity(FIXTURE_IDENTITY, FIXTURE_RECIPIENT, "hunter2");
    expect(w.recipient_public).toBe(FIXTURE_RECIPIENT);
  });

  it("emits schema 1 and an ISO-8601 created_at", async () => {
    const before = Date.now();
    const w = await wrapIdentity(FIXTURE_IDENTITY, FIXTURE_RECIPIENT, "hunter2");
    expect(w.schema).toBe(1);
    expect(new Date(w.created_at).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("rejects the wrong passphrase", async () => {
    const w = await wrapIdentity(FIXTURE_IDENTITY, FIXTURE_RECIPIENT, "hunter2");
    await expect(unwrapIdentity(w, "wrong")).rejects.toBeDefined();
  });

  it("uses a fresh salt, iv, and ciphertext on every wrap", async () => {
    const w1 = await wrapIdentity(FIXTURE_IDENTITY, FIXTURE_RECIPIENT, "hunter2");
    const w2 = await wrapIdentity(FIXTURE_IDENTITY, FIXTURE_RECIPIENT, "hunter2");
    expect(w1.salt).not.toBe(w2.salt);
    expect(w1.iv).not.toBe(w2.iv);
    expect(w1.wrapped).not.toBe(w2.wrapped);
  });

  it("salt is 16 bytes (b64 length 24 with padding) and iv is 12 bytes (16)", async () => {
    const w = await wrapIdentity(FIXTURE_IDENTITY, FIXTURE_RECIPIENT, "hunter2");
    expect(atob(w.salt).length).toBe(16);
    expect(atob(w.iv).length).toBe(12);
  });

  it("rejects an unknown schema version", async () => {
    const w = (await wrapIdentity(
      FIXTURE_IDENTITY,
      FIXTURE_RECIPIENT,
      "hunter2",
    )) as unknown as { schema: number; salt: string; iv: string; wrapped: string; recipient_public: string; created_at: string };
    const tampered = { ...w, schema: 2 } as unknown as WrappedIdentity;
    await expect(unwrapIdentity(tampered, "hunter2")).rejects.toThrow(
      /Unsupported wrapped-identity schema/,
    );
  });

  it("AES-GCM rejects a tampered ciphertext byte", async () => {
    const w = await wrapIdentity(FIXTURE_IDENTITY, FIXTURE_RECIPIENT, "hunter2");
    const bytes = Array.from(atob(w.wrapped), (c) => c.charCodeAt(0));
    bytes[0] = bytes[0] ^ 0x01;
    const tamperedWrapped = btoa(String.fromCharCode(...bytes));
    const tampered: WrappedIdentity = { ...w, wrapped: tamperedWrapped };
    await expect(unwrapIdentity(tampered, "hunter2")).rejects.toBeDefined();
  });

  it("survives JSON round-trip (IndexedDB structured-clone substitute)", async () => {
    const w = await wrapIdentity(FIXTURE_IDENTITY, FIXTURE_RECIPIENT, "hunter2");
    const back: WrappedIdentity = JSON.parse(JSON.stringify(w));
    expect(await unwrapIdentity(back, "hunter2")).toBe(FIXTURE_IDENTITY);
  });

  it("handles multi-byte UTF-8 passphrases", async () => {
    const passphrase = "🔐 пароль — 密码";
    const w = await wrapIdentity(FIXTURE_IDENTITY, FIXTURE_RECIPIENT, passphrase);
    expect(await unwrapIdentity(w, passphrase)).toBe(FIXTURE_IDENTITY);
    await expect(unwrapIdentity(w, "🔐 пароль — wrong")).rejects.toBeDefined();
  });
});

describe("wrapSecret / unwrapSecret (token wrapping)", () => {
  it("round-trips a bearer token", async () => {
    const token = "nts_known_fixture_token_v1";
    const w = await wrapSecret(token, "hunter2");
    expect(await unwrapSecret(w, "hunter2")).toBe(token);
  });

  it("stores an empty recipient_public for token-only wraps", async () => {
    const w = await wrapSecret("nts_abc", "hunter2");
    expect(w.recipient_public).toBe("");
  });
});
