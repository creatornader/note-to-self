use age::secrecy::ExposeSecret;
use anyhow::{Context, Result};

pub struct KeyPair {
    pub identity: age::x25519::Identity,
    pub recipient: age::x25519::Recipient,
}

pub fn generate_keypair() -> KeyPair {
    let identity = age::x25519::Identity::generate();
    let recipient = identity.to_public();
    KeyPair {
        identity,
        recipient,
    }
}

pub fn encrypt(plaintext: &[u8], recipient: &age::x25519::Recipient) -> Result<Vec<u8>> {
    age::encrypt(recipient, plaintext).map_err(|e| anyhow::anyhow!("Encryption failed: {e}"))
}

pub fn decrypt(ciphertext: &[u8], identity: &age::x25519::Identity) -> Result<Vec<u8>> {
    age::decrypt(identity, ciphertext).context("Decryption failed — identity file may not match")
}

pub fn identity_to_string(identity: &age::x25519::Identity) -> String {
    identity.to_string().expose_secret().to_string()
}

pub fn recipient_to_string(recipient: &age::x25519::Recipient) -> String {
    recipient.to_string()
}

pub fn parse_identity(s: &str) -> Result<age::x25519::Identity> {
    s.parse()
        .map_err(|e| anyhow::anyhow!("Failed to parse identity: {e}"))
}

pub fn parse_recipient(s: &str) -> Result<age::x25519::Recipient> {
    s.parse()
        .map_err(|e| anyhow::anyhow!("Failed to parse recipient: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_keypair() {
        let kp = generate_keypair();
        let id_str = identity_to_string(&kp.identity);
        let rc_str = recipient_to_string(&kp.recipient);
        assert!(id_str.starts_with("AGE-SECRET-KEY-"));
        assert!(rc_str.starts_with("age1"));
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let kp = generate_keypair();
        let plaintext = b"hello, note to self!";
        let ciphertext = encrypt(plaintext, &kp.recipient).unwrap();
        assert_ne!(ciphertext, plaintext);
        let decrypted = decrypt(&ciphertext, &kp.identity).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_encrypt_decrypt_empty() {
        let kp = generate_keypair();
        let plaintext = b"";
        let ciphertext = encrypt(plaintext, &kp.recipient).unwrap();
        let decrypted = decrypt(&ciphertext, &kp.identity).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_encrypt_decrypt_large() {
        let kp = generate_keypair();
        let plaintext = vec![0x42u8; 100_000];
        let ciphertext = encrypt(&plaintext, &kp.recipient).unwrap();
        let decrypted = decrypt(&ciphertext, &kp.identity).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_wrong_key_fails() {
        let kp1 = generate_keypair();
        let kp2 = generate_keypair();
        let ciphertext = encrypt(b"secret", &kp1.recipient).unwrap();
        let result = decrypt(&ciphertext, &kp2.identity);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_identity_roundtrip() {
        let kp = generate_keypair();
        let s = identity_to_string(&kp.identity);
        let parsed = parse_identity(&s).unwrap();
        let ct = encrypt(b"test", &kp.recipient).unwrap();
        let pt = decrypt(&ct, &parsed).unwrap();
        assert_eq!(pt, b"test");
    }

    #[test]
    fn test_parse_recipient_roundtrip() {
        let kp = generate_keypair();
        let s = recipient_to_string(&kp.recipient);
        let parsed = parse_recipient(&s).unwrap();
        let ct = encrypt(b"test", &parsed).unwrap();
        let pt = decrypt(&ct, &kp.identity).unwrap();
        assert_eq!(pt, b"test");
    }
}
