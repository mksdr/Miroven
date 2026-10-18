import type {
  EncryptedSyncEnvelope,
  SerializedSyncEnvelope,
  VaultEnvelope,
} from "./types";

export function equalBuffer(left: ArrayBuffer, right: ArrayBuffer): boolean {
  if (left.byteLength !== right.byteLength) return false;
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  return leftBytes.every((value, index) => value === rightBytes[index]);
}

export function sameVaultEnvelope(left: VaultEnvelope, right: VaultEnvelope): boolean {
  return (
    left.cryptoVersion === right.cryptoVersion &&
    left.keyVersion === right.keyVersion &&
    left.recoveryFormat === right.recoveryFormat &&
    equalBuffer(left.wrappedVaultKey, right.wrappedVaultKey) &&
    equalBuffer(left.wrappingNonce, right.wrappingNonce) &&
    equalBuffer(left.recoverySalt, right.recoverySalt)
  );
}

export function toArrayBuffer(value: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) {
    return value.buffer as ArrayBuffer;
  }
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

export function bufferToBase64(value: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBuffer(value: unknown, label: string): ArrayBuffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new Error(`${label} 형식이 올바르지 않습니다.`);
  }
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  } catch {
    throw new Error(`${label} 형식이 올바르지 않습니다.`);
  }
}

export function expectBufferLength(
  value: ArrayBuffer,
  expectedLength: number,
  label: string,
): ArrayBuffer {
  if (value.byteLength !== expectedLength) {
    throw new Error(`${label} 길이가 올바르지 않습니다.`);
  }
  return value;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} 형식이 올바르지 않습니다.`);
  }
  return value;
}

export function expectNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} 형식이 올바르지 않습니다.`);
  }
  return Number(value);
}

export function expectPositiveInteger(value: unknown, label: string): number {
  const parsed = expectNonNegativeInteger(value, label);
  if (parsed < 1) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  return parsed;
}

export function serializeSyncEnvelope(
  envelope: EncryptedSyncEnvelope,
): SerializedSyncEnvelope {
  return {
    ciphertext: bufferToBase64(envelope.ciphertext),
    contentNonce: bufferToBase64(envelope.contentNonce),
    wrappedDataKey: bufferToBase64(envelope.wrappedDataKey),
    keyNonce: bufferToBase64(envelope.keyNonce),
    cryptoVersion: 1,
  };
}

export function deserializeSyncEnvelope(
  value: unknown,
  label: string,
): EncryptedSyncEnvelope {
  if (!isObject(value) || value.cryptoVersion !== 1) {
    throw new Error(`${label} 버전을 지원하지 않습니다.`);
  }
  const ciphertext = base64ToBuffer(value.ciphertext, `${label} 암호문`);
  if (ciphertext.byteLength < 17) throw new Error(`${label} 암호문이 너무 짧습니다.`);
  return {
    ciphertext,
    contentNonce: expectBufferLength(
      base64ToBuffer(value.contentNonce, `${label} nonce`),
      12,
      `${label} nonce`,
    ),
    wrappedDataKey: expectBufferLength(
      base64ToBuffer(value.wrappedDataKey, `${label} 데이터 키`),
      48,
      `${label} 데이터 키`,
    ),
    keyNonce: expectBufferLength(
      base64ToBuffer(value.keyNonce, `${label} 키 nonce`),
      12,
      `${label} 키 nonce`,
    ),
    cryptoVersion: 1,
  };
}
