import type { EncryptedSyncEnvelope } from "../local-vault";
import { bufferToBase64 } from "../vault/codec";
import type { components } from "./api.types";

export function toBase64(value: ArrayBuffer): string {
  return bufferToBase64(value);
}
export function fromBase64(value: string): ArrayBuffer {
  const bytes = Uint8Array.from(atob(value), ch => ch.charCodeAt(0));
  if (toBase64(bytes.buffer) !== value) throw new Error("암호문 인코딩이 올바르지 않습니다.");
  return bytes.buffer;
}
export function encodeEnvelope(value: EncryptedSyncEnvelope): components["schemas"]["CipherEnvelope"] {
  return { ciphertext: toBase64(value.ciphertext), content_nonce: toBase64(value.contentNonce),
    wrapped_data_key: toBase64(value.wrappedDataKey), key_nonce: toBase64(value.keyNonce), crypto_version: 1 };
}
export function decodeEnvelope(value: components["schemas"]["CipherEnvelope"]): EncryptedSyncEnvelope {
  if (value.crypto_version !== 1) throw new Error("지원하지 않는 암호문 버전입니다.");
  const result = { ciphertext: fromBase64(value.ciphertext), contentNonce: fromBase64(value.content_nonce),
    wrappedDataKey: fromBase64(value.wrapped_data_key), keyNonce: fromBase64(value.key_nonce), cryptoVersion: 1 as const };
  if (result.contentNonce.byteLength !== 12 || result.keyNonce.byteLength !== 12 || result.wrappedDataKey.byteLength !== 48) {
    throw new Error("암호문 키 봉투가 올바르지 않습니다.");
  }
  return result;
}
