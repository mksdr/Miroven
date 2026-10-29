import { base64ToBuffer, bufferToBase64, isObject, toArrayBuffer } from "./codec";
import { VAULT_FORMAT_CONTRACT } from "./contracts";

const encoder = new TextEncoder();
const integrityError = () => new Error("백업 파일의 무결성을 확인하지 못했습니다.");

// Sort object keys recursively; preserve array order and JSON's value encoding.
// The complete manifest is authenticated before parsing/normalizing its fields.
function manifestBytes(manifest: Record<string, unknown>): ArrayBuffer {
  const canonical = JSON.stringify(manifest, (_key, value: unknown) =>
    isObject(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]))
      : value,
  );
  return toArrayBuffer(encoder.encode(canonical));
}

async function authenticationKey(vaultKey: CryptoKey, salt: ArrayBuffer): Promise<CryptoKey> {
  const rawKey = await crypto.subtle.exportKey("raw", vaultKey);
  try {
    const material = await crypto.subtle.importKey("raw", rawKey, "HKDF", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt,
        info: toArrayBuffer(encoder.encode(VAULT_FORMAT_CONTRACT.backupAuthenticationInfo)),
      },
      material,
      { name: "HMAC", hash: "SHA-256", length: 256 },
      false,
      ["sign", "verify"],
    );
  } finally {
    new Uint8Array(rawKey).fill(0);
  }
}

export async function authenticateBackup(
  vaultKey: CryptoKey,
  salt: ArrayBuffer,
  manifest: Record<string, unknown>,
): Promise<{ algorithm: "hmac-sha256"; tag: string }> {
  const key = await authenticationKey(vaultKey, salt);
  const tag = await crypto.subtle.sign("HMAC", key, manifestBytes(manifest));
  return { algorithm: "hmac-sha256", tag: bufferToBase64(tag) };
}

export async function verifyBackupAuthentication(
  vaultKey: CryptoKey,
  salt: ArrayBuffer,
  backup: Record<string, unknown>,
): Promise<void> {
  const { authentication, ...manifest } = backup;
  if (!isObject(authentication) || authentication.algorithm !== "hmac-sha256"
    || typeof authentication.tag !== "string" || authentication.tag.length !== 44) {
    throw integrityError();
  }
  let tag: ArrayBuffer;
  try {
    tag = base64ToBuffer(authentication.tag, "백업 인증 태그");
  } catch {
    throw integrityError();
  }
  if (tag.byteLength !== 32 || bufferToBase64(tag) !== authentication.tag) throw integrityError();
  const key = await authenticationKey(vaultKey, salt);
  if (!await crypto.subtle.verify("HMAC", key, tag, manifestBytes(manifest))) throw integrityError();
}
