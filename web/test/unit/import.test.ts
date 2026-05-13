import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { Encrypter } from "age-encryption";
import {
  BundleValidationError,
  IDB_BEARER_KEY,
  IDB_DEVICE_CONFIG_KEY,
  IDB_IDENTITY_KEY,
  captureTokenFromHash,
  importBundle,
  parseBundleText,
  validateBundle,
  type DeviceConfig,
  type ExportBundle,
} from "../../src/core/import";
import { idbGet, idbWipeAll } from "../../src/core/idb";
import { unwrapIdentity, unwrapSecret, type WrappedIdentity } from "../../src/core/identity";

beforeEach(async () => {
  await idbWipeAll();
});

const VALID_IDENTITY =
  "AGE-SECRET-KEY-165DD2KMPNETXTLP8A7S7GUHDPFGXQR47UJFTKJXQ39KMWX09YJFQTT7WTE";
const VALID_RECIPIENT =
  "age125se5v8yqnpk20gvnflc9mcf4ncxt032e38qy8mf2q0wmtf2eayqqv0708";
const WORKER_URL = "https://nts.example.workers.dev";
const VALID_TOKEN = "nts_known_fixture_token_v1";

function validBundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    v: 1,
    identity: VALID_IDENTITY,
    recipient: VALID_RECIPIENT,
    config: {
      storage: {
        backend: "r2",
        path: "/home/user/.nts",
        r2: {
          bucket: "nts-test",
          endpoint: "https://example.r2.cloudflarestorage.com",
          access_key_id: "AKID",
          secret_access_key: "SECRET",
        },
        worker_base_url: WORKER_URL,
      },
      notify: {
        enabled: true,
        backend: "ntfy",
        ntfy: {
          server: "https://ntfy.sh",
          topic: "nts-import-test",
          token: "tk_test",
        },
      },
    },
    ...overrides,
  };
}

describe("captureTokenFromHash", () => {
  it("returns null when no token in hash", () => {
    const loc = { hash: "", pathname: "/import", search: "" };
    let scrubbed = false;
    const hist = {
      replaceState: () => {
        scrubbed = true;
      },
    };
    const out = captureTokenFromHash(loc, hist);
    expect(out.token).toBeNull();
    expect(out.scrubbed).toBe(false);
    expect(scrubbed).toBe(false);
  });

  it("captures a token=... fragment and scrubs to pathname + search", () => {
    const loc = {
      hash: "#token=nts_abc",
      pathname: "/import",
      search: "?ref=enrollment",
    };
    let scrubbedTo: string | null = null;
    const hist = {
      replaceState: (_: unknown, __: string, url: string) => {
        scrubbedTo = url;
      },
    };
    const out = captureTokenFromHash(loc, hist);
    expect(out.token).toBe("nts_abc");
    expect(out.scrubbed).toBe(true);
    expect(scrubbedTo).toBe("/import?ref=enrollment");
  });

  it("URI-decodes the token", () => {
    const loc = {
      hash: "#token=nts%5Fdash%2Bplus",
      pathname: "/",
      search: "",
    };
    const out = captureTokenFromHash(loc, { replaceState: () => {} });
    expect(out.token).toBe("nts_dash+plus");
  });

  it("ignores other fragments and finds token among them", () => {
    const loc = {
      hash: "#foo=bar&token=nts_xyz&other=1",
      pathname: "/",
      search: "",
    };
    const out = captureTokenFromHash(loc, { replaceState: () => {} });
    expect(out.token).toBe("nts_xyz");
  });
});

describe("validateBundle", () => {
  it("accepts a fully-populated valid bundle", () => {
    expect(() => validateBundle(validBundle())).not.toThrow();
  });

  it("rejects non-object input", () => {
    expect(() => validateBundle(null)).toThrow(BundleValidationError);
    expect(() => validateBundle("string")).toThrow(BundleValidationError);
    expect(() => validateBundle(42)).toThrow(BundleValidationError);
  });

  it("rejects wrong schema version", () => {
    const b = { ...validBundle(), v: 2 };
    expect(() => validateBundle(b)).toThrow(/v: expected 1/);
  });

  it("rejects malformed identity", () => {
    const b = { ...validBundle(), identity: "not-an-age-secret" };
    expect(() => validateBundle(b)).toThrow(/identity:/);
  });

  it("rejects malformed recipient", () => {
    const b = { ...validBundle(), recipient: "not-age" };
    expect(() => validateBundle(b)).toThrow(/recipient:/);
  });

  it("rejects missing config.storage", () => {
    const b = { ...validBundle(), config: {} };
    expect(() => validateBundle(b)).toThrow(/config\.storage/);
  });

  it("rejects missing worker_base_url", () => {
    const b = validBundle();
    delete b.config.storage.worker_base_url;
    expect(() => validateBundle(b)).toThrow(/worker_base_url/);
  });

  it("rejects empty worker_base_url", () => {
    const b = validBundle();
    b.config.storage.worker_base_url = "";
    expect(() => validateBundle(b)).toThrow(/worker_base_url/);
  });

  it("tags errors with a field pointer", () => {
    const b = validBundle();
    delete b.config.storage.worker_base_url;
    try {
      validateBundle(b);
    } catch (e) {
      expect(e).toBeInstanceOf(BundleValidationError);
      expect((e as BundleValidationError).field).toBe(
        "config.storage.worker_base_url",
      );
    }
  });

  it("preserves optional CLI-side fields without rejecting", () => {
    // Forward-compat with CLI bundles that carry pwa_base_url and
    // notify.ntfy.token_env. The PWA does not consume these, but the
    // bundle must round-trip cleanly.
    const b = validBundle();
    b.config.storage.pwa_base_url = "https://nts-pwa.pages.dev";
    if (!b.config.notify) {
      b.config.notify = { enabled: true, backend: "ntfy", ntfy: null };
    }
    b.config.notify.ntfy = {
      server: "https://ntfy.sh",
      topic: "nts-test",
      token: null,
      token_env: "NTS_NTFY_TOKEN",
    };
    const parsed = validateBundle(b);
    expect(parsed.config.storage.pwa_base_url).toBe("https://nts-pwa.pages.dev");
    expect(parsed.config.notify?.ntfy?.token_env).toBe("NTS_NTFY_TOKEN");
  });
});

describe("parseBundleText", () => {
  it("parses plain JSON", async () => {
    const text = JSON.stringify(validBundle());
    const back = await parseBundleText(text);
    expect(back.identity).toBe(VALID_IDENTITY);
  });

  it("rejects malformed JSON", async () => {
    await expect(parseBundleText("{not valid")).rejects.toThrow(
      /root: not valid JSON/,
    );
  });

  it("decrypts a passphrase-armored bundle", async () => {
    const plain = JSON.stringify(validBundle());
    const enc = new Encrypter();
    enc.setPassphrase("export-secret");
    const ciphertext = await enc.encrypt(new TextEncoder().encode(plain));
    // The CLI emits armored output when called with --passphrase; the Encrypter
    // emits binary by default, but addPassphrase emits armored. Either way,
    // parseBundleText accepts armored input only — verify by armoring.
    const armoredCtor = new Encrypter();
    armoredCtor.setPassphrase("export-secret");
    const armored = armorAge(ciphertext);
    const back = await parseBundleText(armored, "export-secret");
    expect(back.identity).toBe(VALID_IDENTITY);
  });

  it("rejects armored bundle when no passphrase supplied", async () => {
    const plain = JSON.stringify(validBundle());
    const enc = new Encrypter();
    enc.setPassphrase("export-secret");
    const ciphertext = await enc.encrypt(new TextEncoder().encode(plain));
    const armored = armorAge(ciphertext);
    await expect(parseBundleText(armored)).rejects.toThrow(
      /exportPassphrase.*passphrase-encrypted/,
    );
  });

  it("rejects armored bundle with wrong passphrase", async () => {
    const plain = JSON.stringify(validBundle());
    const enc = new Encrypter();
    enc.setPassphrase("export-secret");
    const ciphertext = await enc.encrypt(new TextEncoder().encode(plain));
    const armored = armorAge(ciphertext);
    await expect(parseBundleText(armored, "wrong")).rejects.toThrow(
      /exportPassphrase.*decrypt failed/,
    );
  });
});

describe("importBundle (end-to-end)", () => {
  it("persists wrapped identity, wrapped bearer, and plaintext config to IDB", async () => {
    const result = await importBundle({
      bundleText: JSON.stringify(validBundle()),
      devicePassphrase: "device-pass",
      bearerToken: VALID_TOKEN,
    });

    expect(result.bundle.identity).toBe(VALID_IDENTITY);
    expect(result.config.recipient).toBe(VALID_RECIPIENT);
    expect(result.config.worker_base_url).toBe(WORKER_URL);
    expect(result.config.ntfy?.topic).toBe("nts-import-test");

    const persistedIdentity = await idbGet<WrappedIdentity>(
      "identity",
      IDB_IDENTITY_KEY,
    );
    const persistedBearer = await idbGet<WrappedIdentity>(
      "identity",
      IDB_BEARER_KEY,
    );
    const persistedConfig = await idbGet<DeviceConfig>(
      "identity",
      IDB_DEVICE_CONFIG_KEY,
    );

    expect(persistedIdentity).toBeDefined();
    expect(persistedBearer).toBeDefined();
    expect(persistedConfig?.worker_base_url).toBe(WORKER_URL);
  });

  it("wraps identity and bearer with the same device passphrase", async () => {
    await importBundle({
      bundleText: JSON.stringify(validBundle()),
      devicePassphrase: "device-pass",
      bearerToken: VALID_TOKEN,
    });

    const persistedIdentity = (await idbGet<WrappedIdentity>(
      "identity",
      IDB_IDENTITY_KEY,
    )) as WrappedIdentity;
    const persistedBearer = (await idbGet<WrappedIdentity>(
      "identity",
      IDB_BEARER_KEY,
    )) as WrappedIdentity;

    expect(await unwrapIdentity(persistedIdentity, "device-pass")).toBe(
      VALID_IDENTITY,
    );
    expect(await unwrapSecret(persistedBearer, "device-pass")).toBe(VALID_TOKEN);
  });

  it("rejects empty device passphrase", async () => {
    await expect(
      importBundle({
        bundleText: JSON.stringify(validBundle()),
        devicePassphrase: "",
        bearerToken: VALID_TOKEN,
      }),
    ).rejects.toThrow(/devicePassphrase/);
  });

  it("rejects empty bearer token", async () => {
    await expect(
      importBundle({
        bundleText: JSON.stringify(validBundle()),
        devicePassphrase: "device-pass",
        bearerToken: "",
      }),
    ).rejects.toThrow(/bearerToken/);
  });

  it("persists null ntfy when bundle has no notify config", async () => {
    const b = validBundle();
    b.config.notify = null;
    await importBundle({
      bundleText: JSON.stringify(b),
      devicePassphrase: "device-pass",
      bearerToken: VALID_TOKEN,
    });
    const cfg = await idbGet<DeviceConfig>("identity", IDB_DEVICE_CONFIG_KEY);
    expect(cfg?.ntfy).toBeNull();
  });

  it("overwrites a previous import on re-run", async () => {
    await importBundle({
      bundleText: JSON.stringify(validBundle()),
      devicePassphrase: "pass1",
      bearerToken: "nts_old",
    });
    await importBundle({
      bundleText: JSON.stringify(validBundle()),
      devicePassphrase: "pass2",
      bearerToken: "nts_new",
    });
    const bearer = (await idbGet<WrappedIdentity>(
      "identity",
      IDB_BEARER_KEY,
    )) as WrappedIdentity;
    expect(await unwrapSecret(bearer, "pass2")).toBe("nts_new");
    await expect(unwrapSecret(bearer, "pass1")).rejects.toBeDefined();
  });
});

// age-encryption emits binary ciphertext by default. The CLI's `--passphrase`
// flag produces armored output. We armor the binary here to mimic CLI output.
function armorAge(binary: Uint8Array): string {
  const b64 = btoaUint8(binary);
  const lines: string[] = ["-----BEGIN AGE ENCRYPTED FILE-----"];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.slice(i, i + 64));
  }
  lines.push("-----END AGE ENCRYPTED FILE-----", "");
  return lines.join("\n");
}

function btoaUint8(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
