/**
 * Server-side crypto helpers: AES-256-GCM for attachment blobs and integration
 * feed tokens (decided in DECISIONS I4), plus HMAC-SHA256 for signed download
 * URLs. Keys come from env; never import this from client code.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

function key(): Buffer {
  const value = process.env.ENCRYPTION_KEY;
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error("ENCRYPTION_KEY must be a 32-byte hex string (64 chars).");
  }
  return Buffer.from(value, "hex");
}

function signingSecret(): Buffer {
  const value = process.env.SIGNING_SECRET;
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error("SIGNING_SECRET must be a 32-byte hex string (64 chars).");
  }
  return Buffer.from(value, "hex");
}

/** Encrypts bytes. Output layout: [iv(12) | authTag(16) | ciphertext]. */
export function encryptBytes(plain: Buffer): Buffer {
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

/** Decrypts a payload produced by encryptBytes. Throws on tampering. */
export function decryptBytes(payload: Buffer): Buffer {
  const iv = payload.subarray(0, GCM_IV_BYTES);
  const tag = payload.subarray(GCM_IV_BYTES, GCM_IV_BYTES + GCM_TAG_BYTES);
  const ciphertext = payload.subarray(GCM_IV_BYTES + GCM_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Base64 encrypt/decrypt for small payloads stored in JSON columns. */
export function encryptString(value: string): string {
  return encryptBytes(Buffer.from(value, "utf8")).toString("base64");
}

export function decryptString(payload: string): string {
  return decryptBytes(Buffer.from(payload, "base64")).toString("utf8");
}

/**
 * HMAC-SHA256 signature for a resource id + expiry (signed download links).
 */
export function signToken(resourceId: string, expires: number): string {
  return createHmac("sha256", signingSecret())
    .update(`${resourceId}:${expires}`)
    .digest("hex");
}

export function verifyToken(resourceId: string, expires: number, signature: string): boolean {
  if (!Number.isInteger(expires) || expires <= Date.now()) return false;
  const expected = signToken(resourceId, expires);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
