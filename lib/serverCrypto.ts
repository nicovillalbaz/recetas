import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type EncryptedPayload = {
  cipherTextB64: string;
  ivB64: string;
  tagB64: string;
};

export function base64UrlEncode(value: Buffer | string) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");

  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );

  return Buffer.from(padded, "base64");
}

export function signHmac(value: string) {
  return base64UrlEncode(
    createHmac("sha256", getSessionSecret()).update(value).digest(),
  );
}

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
}

export function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createRandomToken(bytes = 32) {
  return base64UrlEncode(randomBytes(bytes));
}

export function encryptText(value: string): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const cipherText = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    cipherTextB64: cipherText.toString("base64"),
    ivB64: iv.toString("base64"),
    tagB64: tag.toString("base64"),
  };
}

export function decryptText(payload: EncryptedPayload) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(payload.ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.tagB64, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(payload.cipherTextB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function getSessionSecret() {
  const secret =
    process.env.APP_SESSION_SECRET?.trim() ||
    process.env.GHL_APP_SHARED_SECRET?.trim();

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV !== "production") {
    return "dev-only-recetas-duran-session-secret";
  }

  throw new Error("Configura APP_SESSION_SECRET en EasyPanel.");
}

function getEncryptionKey() {
  const raw = process.env.APP_ENCRYPTION_KEY?.trim();

  if (raw) {
    const base64 = Buffer.from(raw, "base64");

    if (base64.length === 32) {
      return base64;
    }

    const hex = Buffer.from(raw, "hex");

    if (hex.length === 32) {
      return hex;
    }
  }

  if (process.env.NODE_ENV !== "production") {
    return createHash("sha256")
      .update("dev-only-recetas-duran-encryption-key")
      .digest();
  }

  throw new Error("Configura APP_ENCRYPTION_KEY en EasyPanel.");
}
