import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

export type EncryptedSecret = {
  encryptedClientSecret: string;
  secretAuthTag: string;
  secretIv: string;
};

function getEncryptionKey() {
  const rawKey = process.env.OIDC_SECRET_ENCRYPTION_KEY?.trim();

  if (!rawKey) {
    throw new Error("OIDC_SECRET_ENCRYPTION_KEY is required for OIDC secret encryption.");
  }

  const base64Key = Buffer.from(rawKey, "base64");
  if (base64Key.length === 32) {
    return base64Key;
  }

  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, "hex");
  }

  const utf8Key = Buffer.from(rawKey, "utf8");
  if (utf8Key.length === 32) {
    return utf8Key;
  }

  throw new Error(
    "OIDC_SECRET_ENCRYPTION_KEY must decode to 32 bytes. Use a 32-byte base64, hex, or raw value."
  );
}

export function encryptOidcClientSecret(clientSecret: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(clientSecret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedClientSecret: encrypted.toString("base64"),
    secretAuthTag: authTag.toString("base64"),
    secretIv: iv.toString("base64")
  };
}

export function decryptStoredOidcClientSecret(input: EncryptedSecret) {
  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(input.secretIv, "base64"));
  decipher.setAuthTag(Buffer.from(input.secretAuthTag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(input.encryptedClientSecret, "base64")),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}
