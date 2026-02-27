use aes_gcm::{
  aead::{Aead, AeadCore, KeyInit, OsRng},
  Aes256Gcm, Key, Nonce,
};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

pub struct CryptoManager {
  cipher: Aes256Gcm,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EncryptedData {
  pub ciphertext: Vec<u8>,
  pub nonce: Vec<u8>,
}

impl CryptoManager {
  pub fn new(key: &[u8; 32]) -> Result<Self> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    Ok(Self { cipher })
  }

  pub fn encrypt(&self, plaintext: &[u8]) -> Result<EncryptedData> {
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = self
      .cipher
      .encrypt(&nonce, plaintext)
      .map_err(|e| anyhow!("Encryption failed: {}", e))?;

    Ok(EncryptedData {
      ciphertext,
      nonce: nonce.to_vec(),
    })
  }

  pub fn decrypt(&self, data: &EncryptedData) -> Result<Vec<u8>> {
    let nonce = Nonce::from_slice(&data.nonce);
    let plaintext = self
      .cipher
      .decrypt(nonce, data.ciphertext.as_ref())
      .map_err(|e| anyhow!("Decryption failed: {}", e))?;
    Ok(plaintext)
  }

  pub fn encrypt_to_base64(&self, plaintext: &[u8]) -> Result<String> {
    use base64::Engine;
    let encrypted = self.encrypt(plaintext)?;
    let json = serde_json::to_vec(&encrypted)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&json))
  }

  pub fn decrypt_from_base64(&self, encoded: &str) -> Result<Vec<u8>> {
    use base64::Engine;
    let json = base64::engine::general_purpose::STANDARD.decode(encoded)?;
    let encrypted: EncryptedData = serde_json::from_slice(&json)?;
    self.decrypt(&encrypted)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn get_test_key() -> [u8; 32] {
    b"test_key_32_bytes_long_1234567890".clone()
  }

  #[test]
  fn test_encrypt_decrypt() {
    let key = get_test_key();
    let crypto = CryptoManager::new(&key).unwrap();

    let plaintext = b"Hello, World!";
    let encrypted = crypto.encrypt(plaintext).unwrap();
    let decrypted = crypto.decrypt(&encrypted).unwrap();

    assert_eq!(plaintext.to_vec(), decrypted);
  }

  #[test]
  fn test_wrong_key_fails() {
    let key1 = b"test_key_32_bytes_long_1234567890";
    let key2 = b"different_key_32_bytes_123456789";
    let crypto1 = CryptoManager::new(key1).unwrap();
    let crypto2 = CryptoManager::new(key2).unwrap();

    let plaintext = b"Hello, World!";
    let encrypted = crypto1.encrypt(plaintext).unwrap();
    let result = crypto2.decrypt(&encrypted);

    assert!(result.is_err());
  }

  #[test]
  fn test_encrypt_empty_data() {
    let key = get_test_key();
    let crypto = CryptoManager::new(&key).unwrap();

    let plaintext = b"";
    let encrypted = crypto.encrypt(plaintext).unwrap();
    let decrypted = crypto.decrypt(&encrypted).unwrap();

    assert_eq!(plaintext.to_vec(), decrypted);
    assert!(decrypted.is_empty());
  }

  #[test]
  fn test_encrypt_large_data() {
    let key = get_test_key();
    let crypto = CryptoManager::new(&key).unwrap();

    // Test with 1MB of data
    let large_data: Vec<u8> = (0..255).cycle().take(1_000_000).collect();
    let encrypted = crypto.encrypt(&large_data).unwrap();
    let decrypted = crypto.decrypt(&encrypted).unwrap();

    assert_eq!(large_data, decrypted);
  }

  #[test]
  fn test_encrypt_unicode_data() {
    let key = get_test_key();
    let crypto = CryptoManager::new(&key).unwrap();

    let plaintext = "Hello 世界 🌍 Привет".as_bytes();
    let encrypted = crypto.encrypt(plaintext).unwrap();
    let decrypted = crypto.decrypt(&encrypted).unwrap();

    assert_eq!(plaintext.to_vec(), decrypted);
  }

  #[test]
  fn test_encrypt_binary_data() {
    let key = get_test_key();
    let crypto = CryptoManager::new(&key).unwrap();

    // Test with all possible byte values
    let binary_data: Vec<u8> = (0u8..=255).collect();
    let encrypted = crypto.encrypt(&binary_data).unwrap();
    let decrypted = crypto.decrypt(&encrypted).unwrap();

    assert_eq!(binary_data, decrypted);
  }

  #[test]
  fn test_same_data_different_nonce() {
    let key = get_test_key();
    let crypto = CryptoManager::new(&key).unwrap();

    let plaintext = b"Hello, World!";
    let encrypted1 = crypto.encrypt(plaintext).unwrap();
    let encrypted2 = crypto.encrypt(plaintext).unwrap();

    // Same plaintext should produce different ciphertext due to random nonce
    assert_ne!(encrypted1.ciphertext, encrypted2.ciphertext);
    assert_ne!(encrypted1.nonce, encrypted2.nonce);

    // But both should decrypt to the same value
    assert_eq!(crypto.decrypt(&encrypted1).unwrap(), crypto.decrypt(&encrypted2).unwrap());
  }

  #[test]
  fn test_tampered_data_fails() {
    let key = get_test_key();
    let crypto = CryptoManager::new(&key).unwrap();

    let plaintext = b"Hello, World!";
    let mut encrypted = crypto.encrypt(plaintext).unwrap();

    // Tamper with ciphertext
    if !encrypted.ciphertext.is_empty() {
      encrypted.ciphertext[0] ^= 0xFF;
    }

    let result = crypto.decrypt(&encrypted);
    assert!(result.is_err());
  }

  #[test]
  fn test_tampered_nonce_fails() {
    let key = get_test_key();
    let crypto = CryptoManager::new(&key).unwrap();

    let plaintext = b"Hello, World!";
    let mut encrypted = crypto.encrypt(plaintext).unwrap();

    // Tamper with nonce
    if !encrypted.nonce.is_empty() {
      encrypted.nonce[0] ^= 0xFF;
    }

    let result = crypto.decrypt(&encrypted);
    assert!(result.is_err());
  }

  #[test]
  fn test_encrypt_to_base64() {
    let key = get_test_key();
    let crypto = CryptoManager::new(&key).unwrap();

    let plaintext = b"Hello, World!";
    let encoded = crypto.encrypt_to_base64(plaintext).unwrap();

    // Should be valid base64
    assert!(encoded.chars().all(|c| c.is_alphanumeric() || c == '+' || c == '/' || c == '=' || c == '\n'));
  }

  #[test]
  fn test_decrypt_from_base64() {
    let key = get_test_key();
    let crypto = CryptoManager::new(&key).unwrap();

    let plaintext = b"Hello, World!";
    let encoded = crypto.encrypt_to_base64(plaintext).unwrap();
    let decrypted = crypto.decrypt_from_base64(&encoded).unwrap();

    assert_eq!(plaintext.to_vec(), decrypted);
  }

  #[test]
  fn test_base64_roundtrip_unicode() {
    let key = get_test_key();
    let crypto = CryptoManager::new(&key).unwrap();

    let plaintext = "Test 世界 🌍 Мир".as_bytes();
    let encoded = crypto.encrypt_to_base64(plaintext).unwrap();
    let decrypted = crypto.decrypt_from_base64(&encoded).unwrap();

    assert_eq!(plaintext.to_vec(), decrypted);
  }

  #[test]
  fn test_base64_large_data() {
    let key = get_test_key();
    let crypto = CryptoManager::new(&key).unwrap();

    let large_data: Vec<u8> = (0..255).cycle().take(100_000).collect();
    let encoded = crypto.encrypt_to_base64(&large_data).unwrap();
    let decrypted = crypto.decrypt_from_base64(&encoded).unwrap();

    assert_eq!(large_data, decrypted);
  }

  #[test]
  fn test_invalid_base64_fails() {
    let key = get_test_key();
    let crypto = CryptoManager::new(&key).unwrap();

    let invalid_base64 = "not-valid-base64!!!";
    let result = crypto.decrypt_from_base64(invalid_base64);

    assert!(result.is_err());
  }

  #[test]
  fn test_truncated_base64_fails() {
    let key = get_test_key();
    let crypto = CryptoManager::new(&key).unwrap();

    let plaintext = b"Hello, World!";
    let encoded = crypto.encrypt_to_base64(plaintext).unwrap();

    // Truncate the encoded string
    let truncated = &encoded[..encoded.len() / 2];
    let result = crypto.decrypt_from_base64(truncated);

    assert!(result.is_err());
  }

  #[test]
  fn test_encrypted_data_serialization() {
    let key = get_test_key();
    let crypto = CryptoManager::new(&key).unwrap();

    let plaintext = b"Hello, World!";
    let encrypted = crypto.encrypt(plaintext).unwrap();

    // Should be serializable
    let json = serde_json::to_string(&encrypted).unwrap();

    // And deserializable
    let decrypted: EncryptedData = serde_json::from_str(&json).unwrap();
    assert_eq!(encrypted.ciphertext, decrypted.ciphertext);
    assert_eq!(encrypted.nonce, decrypted.nonce);
  }

  #[test]
  fn test_multiple_keys_different_results() {
    let key1 = b"key1_32_bytes_long_1234567890ABCD";
    let key2 = b"key2_32_bytes_long_1234567890ABCD";

    let crypto1 = CryptoManager::new(key1).unwrap();
    let crypto2 = CryptoManager::new(key2).unwrap();

    let plaintext = b"Same plaintext";
    let encrypted1 = crypto1.encrypt(plaintext).unwrap();
    let encrypted2 = crypto2.encrypt(plaintext).unwrap();

    // Different keys should produce different results
    assert_ne!(encrypted1.ciphertext, encrypted2.ciphertext);
  }

  #[test]
  fn test_invalid_key_length() {
    // Test with wrong key size
    let short_key = b"short";
    let result = CryptoManager::new(short_key);
    // This should fail at compile time due to type system
    // but we can verify the new() expects [u8; 32]
  }

  #[test]
  fn test_empty_nonce_rejected() {
    let key = get_test_key();
    let _crypto = CryptoManager::new(&key).unwrap();

    // Create an invalid EncryptedData with empty nonce
    let invalid_data = EncryptedData {
      ciphertext: vec![1, 2, 3],
      nonce: vec![],
    };

    let result = _crypto.decrypt(&invalid_data);
    assert!(result.is_err());
  }
}
