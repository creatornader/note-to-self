// Passphrase-wrapped age identity for browser storage.
//
// The age identity is the long-lived secret that can decrypt every blob the
// PWA pulls from R2. We never persist it in cleartext. Instead, on import we
// derive an AES-GCM key from a user-supplied passphrase via PBKDF2-SHA-256
// (200,000 iterations, 128-bit salt), wrap the identity string, and persist
// only the wrapped form plus the wrapping parameters.
//
// The same primitive is reused for the bearer token (enrollment URL token):
// `wrapIdentity` is generic over its string payload. The recipient public key
// stays in cleartext because it is not a secret.

const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

// Cast Uint8Array values to BufferSource at the WebCrypto API boundary.
// TypeScript 5.7's `Uint8Array<ArrayBufferLike>` does not satisfy `BufferSource`
// (it widened the buffer parameter to include SharedArrayBuffer). The runtime
// behaviour is unchanged; only the type widened.
function bs(u: Uint8Array): BufferSource {
  return u as BufferSource;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    bs(new TextEncoder().encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: bs(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface WrappedIdentity {
  schema: 1;
  salt: string;
  iv: string;
  wrapped: string;
  recipient_public: string;
  created_at: string;
}

export async function wrapIdentity(
  identity: string,
  recipient: string,
  passphrase: string,
): Promise<WrappedIdentity> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: bs(iv) },
      key,
      bs(new TextEncoder().encode(identity)),
    ),
  );
  return {
    schema: 1,
    salt: b64(salt),
    iv: b64(iv),
    wrapped: b64(ct),
    recipient_public: recipient,
    created_at: new Date().toISOString(),
  };
}

export async function unwrapIdentity(
  w: WrappedIdentity,
  passphrase: string,
): Promise<string> {
  if (w.schema !== 1) {
    throw new Error(`Unsupported wrapped-identity schema: ${w.schema}`);
  }
  const key = await deriveKey(passphrase, unb64(w.salt));
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bs(unb64(w.iv)) },
    key,
    bs(unb64(w.wrapped)),
  );
  return new TextDecoder().decode(pt);
}

// Wrap any opaque string secret (bearer tokens, etc.) using the same primitive.
// Re-exported so the import flow can wrap the device bearer token with the
// same passphrase as the identity.
export async function wrapSecret(
  secret: string,
  passphrase: string,
): Promise<WrappedIdentity> {
  return wrapIdentity(secret, "", passphrase);
}

export async function unwrapSecret(
  w: WrappedIdentity,
  passphrase: string,
): Promise<string> {
  return unwrapIdentity(w, passphrase);
}

function b64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function unb64(s: string): Uint8Array {
  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
