import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decrypt, decryptText, encrypt, encryptText } from "../../src/core/crypto";

// Vitest runs tests with `process.cwd()` at the workspace root (web/), so
// fixtures resolve relative to that. Avoids `import.meta.url` which jsdom
// rewrites to an http: scheme that `fileURLToPath` cannot decode.
const FIX = resolve(process.cwd(), "test/fixtures/ciphertext");

function readIdentity(): { identity: string; recipient: string } {
  const file = readFileSync(resolve(FIX, "sample.identity"), "utf-8");
  const identity = file
    .split("\n")
    .find((l) => l.startsWith("AGE-SECRET-KEY"))!;
  const recipient = file
    .split("\n")
    .find((l) => l.startsWith("# public key:"))!
    .replace("# public key: ", "")
    .trim();
  return { identity, recipient };
}

describe("crypto round-trip vs rage", () => {
  it("decrypts a rage-produced ciphertext", async () => {
    const ciphertext = new Uint8Array(readFileSync(resolve(FIX, "sample.age")));
    const expected = readFileSync(resolve(FIX, "sample.plaintext.txt"), "utf-8");
    const { identity } = readIdentity();

    const plaintext = await decrypt(ciphertext, identity);
    expect(new TextDecoder().decode(plaintext)).toBe(expected);
  });

  it("decryptText helper matches the plaintext fixture", async () => {
    const ciphertext = new Uint8Array(readFileSync(resolve(FIX, "sample.age")));
    const expected = readFileSync(resolve(FIX, "sample.plaintext.txt"), "utf-8");
    const { identity } = readIdentity();

    expect(await decryptText(ciphertext, identity)).toBe(expected);
  });

  it("encrypts and decrypts within JS round-trip", async () => {
    const { identity, recipient } = readIdentity();
    const original = new TextEncoder().encode("hello world");

    const ciphertext = await encrypt(original, recipient);
    const back = await decrypt(ciphertext, identity);
    expect([...back]).toEqual([...original]);
  });

  it("encryptText + decryptText round-trip preserves multi-byte input", async () => {
    const { identity, recipient } = readIdentity();
    const original = "hello — 你好 — 🌊";

    const ciphertext = await encryptText(original, recipient);
    expect(await decryptText(ciphertext, identity)).toBe(original);
  });

  it("decrypt with the wrong identity rejects", async () => {
    const ciphertext = new Uint8Array(readFileSync(resolve(FIX, "sample.age")));
    const wrong = "AGE-SECRET-KEY-1QYZ7ZTQYTRQXPCG7VQXQZQGGAXG7H93EWZSUFGT8FGYNYZS0PQXSZRSDFD";

    await expect(decrypt(ciphertext, wrong)).rejects.toThrow();
  });
});
