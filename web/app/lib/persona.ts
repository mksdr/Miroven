// A singleton document carried by the existing opaque encrypted-entry transport.
// Keep this UUID stable across devices; it is never a journal entry.
export const PERSONA_DOCUMENT_ID = "00000000-0000-4000-8000-000000000001";
export type Persona = { name: string; bio: string; handle: string; avatar: string | null };
export const DEFAULT_PERSONA: Persona = { name: "", bio: "", handle: "private", avatar: null };

export function validatePersona(value: unknown): asserts value is Persona {
  if (!value || typeof value !== "object") throw new Error("Invalid persona");
  const p = value as Persona;
  if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 30 ||
      typeof p.bio !== "string" || p.bio.length > 160 ||
      typeof p.handle !== "string" || !/^[a-zA-Z0-9_]{3,20}$/.test(p.handle)) throw new Error("Invalid persona fields");
  if (p.avatar !== null) {
    if (typeof p.avatar !== "string" || p.avatar.length > 60000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(p.avatar)) throw new Error("Invalid avatar");
    const bytes = Uint8Array.from(atob(p.avatar.split(",")[1]), c => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    if (bytes.length < 33 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a ||
        view.getUint32(12) !== 0x49484452 || view.getUint32(16) < 1 || view.getUint32(16) > 100 ||
        view.getUint32(20) < 1 || view.getUint32(20) > 100) throw new Error("Avatar must be at most 100 × 100px");
  }
}

export function validatePersonaDocument(entry: { id: string; text: string; image?: unknown; images?: unknown; pinnedAt?: unknown; quotedEntryId?: unknown }) {
  if (entry.quotedEntryId === PERSONA_DOCUMENT_ID) throw new Error("Cannot quote a persona");
  if (entry.id !== PERSONA_DOCUMENT_ID) return;
  if (entry.image || entry.images || entry.pinnedAt || entry.quotedEntryId) throw new Error("Invalid persona document");
  validatePersona(JSON.parse(entry.text));
}

export async function processPersonaAvatar(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error("Choose a PNG, JPEG or WebP image under 20 MB");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 100 / bitmap.width, 100 / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing unavailable");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const avatar = canvas.toDataURL("image/png");
    validatePersona({ name: "Me", bio: "", handle: "private", avatar });
    return avatar;
  } finally { bitmap.close(); }
}
