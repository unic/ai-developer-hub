import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

function getEncryptionKey(salt: Buffer): Buffer {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("API_KEY_ENCRYPTION_SECRET environment variable is not set");
  }
  return scryptSync(secret, salt, KEY_LENGTH);
}

/**
 * Encrypt an API key using AES-256-GCM.
 * Returns a base64-encoded string containing salt + iv + tag + ciphertext.
 */
export function encryptApiKey(plaintext: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = getEncryptionKey(salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Format: salt(32) + iv(16) + tag(16) + ciphertext
  const result = Buffer.concat([salt, iv, tag, encrypted]);
  return result.toString("base64");
}

/**
 * Decrypt an API key previously encrypted with encryptApiKey().
 */
export function decryptApiKey(encoded: string): string {
  const data = Buffer.from(encoded, "base64");

  const salt = data.subarray(0, SALT_LENGTH);
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const key = getEncryptionKey(salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/**
 * Mask an API key for display: first 4 chars + dots + last 4 chars.
 * If the key is too short, returns all dots.
 */
export function maskApiKey(plaintext: string): string {
  if (plaintext.length <= 8) {
    return "\u2022".repeat(plaintext.length);
  }
  return `${plaintext.slice(0, 4)}${"•".repeat(8)}${plaintext.slice(-4)}`;
}
