import { Decrypter, Encrypter } from "age-encryption";

export async function encrypt(
  plaintext: Uint8Array,
  recipient: string,
): Promise<Uint8Array> {
  const enc = new Encrypter();
  enc.addRecipient(recipient);
  return await enc.encrypt(plaintext);
}

export async function decrypt(
  ciphertext: Uint8Array,
  identity: string,
): Promise<Uint8Array> {
  const dec = new Decrypter();
  dec.addIdentity(identity);
  return await dec.decrypt(ciphertext, "uint8array");
}

export async function encryptText(
  plaintext: string,
  recipient: string,
): Promise<Uint8Array> {
  return await encrypt(new TextEncoder().encode(plaintext), recipient);
}

export async function decryptText(
  ciphertext: Uint8Array,
  identity: string,
): Promise<string> {
  return new TextDecoder("utf-8").decode(await decrypt(ciphertext, identity));
}
