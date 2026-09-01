import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

function getKey(): Buffer {
  const key = Buffer.from(env.ENCRYPTION_KEY, "hex");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY debe ser 32 bytes en hex (64 caracteres) para AES-256-GCM");
  }
  return key;
}

/** Cifra un token de proveedor. Salida: `iv:ciphertext:authTag`, todo en base64. */
export function encryptToken(plainText: string): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, ciphertext, authTag].map((part) => part.toString("base64")).join(":");
}

/** Descifra un valor producido por `encryptToken`. Nunca loguear el resultado. */
export function decryptToken(encrypted: string): string {
  const [ivB64, ciphertextB64, authTagB64] = encrypted.split(":");
  if (!ivB64 || !ciphertextB64 || !authTagB64) {
    throw new Error("Formato de token cifrado inválido — se esperaba iv:ciphertext:authTag");
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
