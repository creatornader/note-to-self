// Paste-bundle import flow.
//
// Two payloads land in the PWA at enrollment time:
//   1. The export bundle from `nts export` (or `nts export --passphrase`),
//      which carries the age identity, recipient public key, and the user's
//      storage and notify config.
//   2. The bearer token for the Cloudflare Worker, which arrives either via
//      the enrollment URL fragment (#token=nts_...) or via manual paste.
//
// We wrap the identity AND the bearer token with the same device passphrase
// via wrapIdentity, persist them to IndexedDB, and store the public bits
// (recipient, worker_base_url, ntfy) as plain DeviceConfig in the same store.

import { Decrypter } from "age-encryption";
import { idbPut } from "./idb";
import { wrapIdentity, wrapSecret, type WrappedIdentity } from "./identity";

export interface R2Config {
  bucket: string;
  endpoint: string;
  access_key_id: string;
  secret_access_key: string;
}

export interface NtfyConfig {
  server: string;
  topic: string;
  token?: string | null;
  // The CLI may carry an env-var reference rather than the literal token.
  // The PWA cannot resolve env vars (it has no shell context), so it
  // ignores token_env at use time — but the field is preserved so it
  // round-trips on re-export from one CLI to another.
  token_env?: string | null;
}

export interface NotifyConfig {
  enabled: boolean;
  backend: string;
  ntfy: NtfyConfig | null;
}

export interface ExportBundle {
  v: 1;
  identity: string;
  recipient: string;
  config: {
    storage: {
      backend: string;
      path: string;
      r2: R2Config | null;
      worker_base_url?: string | null;
      // pwa_base_url is preserved for CLI-to-CLI restore but the PWA
      // does not consume it (the PWA already knows its own origin).
      pwa_base_url?: string | null;
    };
    notify?: NotifyConfig | null;
  };
}

export interface DeviceConfig {
  recipient: string;
  worker_base_url: string;
  ntfy: NtfyConfig | null;
  imported_at: string;
}

const AGE_ARMOR_HEADER = "-----BEGIN AGE ENCRYPTED FILE-----";
const AGE_ARMOR_FOOTER = "-----END AGE ENCRYPTED FILE-----";

// Strip the PEM-style age ASCII armor and return the binary payload.
// The age-encryption npm Decrypter accepts only binary input, so the PWA
// translates armor here. Whitespace inside the body is ignored (matches rage
// and age tooling conventions).
export function stripAgeArmor(armored: string): Uint8Array {
  const header = armored.indexOf(AGE_ARMOR_HEADER);
  const footer = armored.indexOf(AGE_ARMOR_FOOTER);
  if (header === -1 || footer === -1 || footer <= header) {
    throw new BundleValidationError(
      "bundleText",
      "age armor markers missing or malformed",
    );
  }
  const body = armored
    .slice(header + AGE_ARMOR_HEADER.length, footer)
    .replace(/\s+/g, "");
  const binary = atob(body);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
const TOKEN_HASH_PATTERN = /(?:^|[#&])token=([^&]+)/;

export interface CapturedToken {
  token: string | null;
  scrubbed: boolean;
}

// Capture an enrollment token from location.hash and immediately scrub it
// from browser history via history.replaceState. The scrub strips the entire
// hash to prevent the token from leaking via window.location, the back
// button, or being persisted by browser history sync features.
//
// Both loc and hist are injected for testability; production callers pass
// window.location and window.history.
export function captureTokenFromHash(
  loc: { hash: string; pathname: string; search: string },
  hist: { replaceState: (data: unknown, unused: string, url: string) => void },
): CapturedToken {
  const m = TOKEN_HASH_PATTERN.exec(loc.hash);
  if (!m) return { token: null, scrubbed: false };
  const token = decodeURIComponent(m[1]);
  const url = loc.pathname + loc.search;
  hist.replaceState(null, "", url);
  return { token, scrubbed: true };
}

export class BundleValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.field = field;
    this.name = "BundleValidationError";
  }
}

// Parse + validate. Throws BundleValidationError with a `field` pointer when
// the bundle is structurally wrong; throws generic Error for parse failures.
export function validateBundle(parsed: unknown): ExportBundle {
  if (typeof parsed !== "object" || parsed === null) {
    throw new BundleValidationError("root", "bundle must be a JSON object");
  }
  const o = parsed as Record<string, unknown>;
  if (o.v !== 1) {
    throw new BundleValidationError("v", `expected 1, got ${String(o.v)}`);
  }
  if (typeof o.identity !== "string" || !o.identity.startsWith("AGE-SECRET-KEY-")) {
    throw new BundleValidationError(
      "identity",
      "must be a string beginning with AGE-SECRET-KEY-",
    );
  }
  if (typeof o.recipient !== "string" || !o.recipient.startsWith("age1")) {
    throw new BundleValidationError(
      "recipient",
      "must be a string beginning with age1",
    );
  }
  const cfg = o.config as Record<string, unknown> | undefined;
  if (typeof cfg !== "object" || cfg === null) {
    throw new BundleValidationError("config", "missing or not an object");
  }
  const storage = cfg.storage as Record<string, unknown> | undefined;
  if (typeof storage !== "object" || storage === null) {
    throw new BundleValidationError("config.storage", "missing");
  }
  if (typeof storage.backend !== "string") {
    throw new BundleValidationError("config.storage.backend", "missing");
  }
  // r2 may be null when the CLI ran with the local backend; the PWA can still
  // import in that case but it will not be able to sync until r2 is populated.
  // worker_base_url is what the PWA actually needs; flag if missing.
  if (
    typeof storage.worker_base_url !== "string" ||
    storage.worker_base_url.length === 0
  ) {
    throw new BundleValidationError(
      "config.storage.worker_base_url",
      "missing; run `nts config set storage.worker_base_url https://...` on the CLI before export",
    );
  }
  return parsed as ExportBundle;
}

// Parse the raw paste content. If it begins with the age ASCII armor header,
// decrypt with the export passphrase first; otherwise parse as JSON directly.
export async function parseBundleText(
  text: string,
  exportPassphrase?: string,
): Promise<ExportBundle> {
  const trimmed = text.trimStart();
  if (trimmed.startsWith(AGE_ARMOR_HEADER)) {
    if (!exportPassphrase) {
      throw new BundleValidationError(
        "exportPassphrase",
        "bundle is passphrase-encrypted but no export passphrase was provided",
      );
    }
    const dec = new Decrypter();
    dec.addPassphrase(exportPassphrase);
    const ciphertextBytes = stripAgeArmor(trimmed);
    let plaintextBytes: Uint8Array;
    try {
      plaintextBytes = await dec.decrypt(ciphertextBytes, "uint8array");
    } catch (e) {
      throw new BundleValidationError(
        "exportPassphrase",
        `decrypt failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const json = new TextDecoder().decode(plaintextBytes);
    return validateBundle(parseJsonOrThrow(json));
  }
  return validateBundle(parseJsonOrThrow(trimmed));
}

function parseJsonOrThrow(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new BundleValidationError(
      "root",
      `not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export interface ImportInputs {
  bundleText: string;
  exportPassphrase?: string;
  devicePassphrase: string;
  bearerToken: string;
}

export interface ImportResult {
  bundle: ExportBundle;
  config: DeviceConfig;
  identityKey: string;
  bearerKey: string;
  configKey: string;
}

// IDB key constants exported so the unlock flow and tests share the same
// strings.
export const IDB_IDENTITY_KEY = "current";
export const IDB_BEARER_KEY = "bearer";
export const IDB_DEVICE_CONFIG_KEY = "config";

// Parse the bundle, wrap the secrets with the device passphrase, persist
// everything to IndexedDB. Returns the imported bundle and the public config
// so callers can hand them to the in-memory session.
export async function importBundle(inputs: ImportInputs): Promise<ImportResult> {
  if (!inputs.devicePassphrase) {
    throw new BundleValidationError("devicePassphrase", "must not be empty");
  }
  if (!inputs.bearerToken) {
    throw new BundleValidationError("bearerToken", "must not be empty");
  }

  const bundle = await parseBundleText(
    inputs.bundleText,
    inputs.exportPassphrase,
  );

  const wrappedIdentity: WrappedIdentity = await wrapIdentity(
    bundle.identity,
    bundle.recipient,
    inputs.devicePassphrase,
  );
  const wrappedBearer: WrappedIdentity = await wrapSecret(
    inputs.bearerToken,
    inputs.devicePassphrase,
  );

  const config: DeviceConfig = {
    recipient: bundle.recipient,
    worker_base_url: bundle.config.storage.worker_base_url ?? "",
    ntfy: bundle.config.notify?.ntfy ?? null,
    imported_at: new Date().toISOString(),
  };

  await idbPut("identity", IDB_IDENTITY_KEY, wrappedIdentity);
  await idbPut("identity", IDB_BEARER_KEY, wrappedBearer);
  await idbPut("identity", IDB_DEVICE_CONFIG_KEY, config);

  return {
    bundle,
    config,
    identityKey: IDB_IDENTITY_KEY,
    bearerKey: IDB_BEARER_KEY,
    configKey: IDB_DEVICE_CONFIG_KEY,
  };
}
