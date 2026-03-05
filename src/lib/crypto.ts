import { randomBytes, createCipheriv, createDecipheriv, scrypt } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

async function getEncryptionKey(salt: Buffer): Promise<Buffer> {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("API_KEY_ENCRYPTION_SECRET environment variable is not set");
  }
  return scryptAsync(secret, salt, KEY_LENGTH) as Promise<Buffer>;
}

/**
 * Encrypt an API key using AES-256-GCM.
 * Returns a base64-encoded string containing salt + iv + tag + ciphertext.
 */
export async function encryptApiKey(plaintext: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await getEncryptionKey(salt);
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
export async function decryptApiKey(encoded: string): Promise<string> {
  const data = Buffer.from(encoded, "base64");

  const minLength = SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1;
  if (data.length < minLength) {
    throw new Error("Invalid encrypted data: buffer too short");
  }

  const salt = data.subarray(0, SALT_LENGTH);
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const key = await getEncryptionKey(salt);
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
