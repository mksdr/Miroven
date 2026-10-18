import { assertImageDimensions, JournalImageError } from "./image";

export async function checkHeifDimensions(file: Blob): Promise<void> {
  // Inspect ispe properties before the HEIF worker allocates RGBA pixels.
  // Read a bounded meta box, never the compressed mdat payload.
  let checked = 0;
  const scan = (view: DataView, start: number, end: number, depth: number) => {
    if (depth > 4) throw new JournalImageError("decode");
    let offset = start;
    while (offset < end) {
      if (offset + 8 > end) throw new JournalImageError("decode");
      const size = view.getUint32(offset);
      const type = String.fromCharCode(...new Uint8Array(view.buffer, offset + 4, 4));
      if (size < 8 || offset + size > end) throw new JournalImageError("decode");
      if (type === "ispe") {
        if (size < 20) throw new JournalImageError("decode");
        assertImageDimensions(view.getUint32(offset + 12), view.getUint32(offset + 16));
        checked++;
      } else if (type === "iprp" || type === "ipco") {
        scan(view, offset + 8, offset + size, depth + 1);
      }
      offset += size;
    }
  };
  for (let offset = 0, boxes = 0; offset + 8 <= file.size && boxes < 256; boxes++) {
    const bytes = await file.slice(offset, offset + 16).arrayBuffer();
    const header = new DataView(bytes);
    const type = String.fromCharCode(...new Uint8Array(bytes, 4, 4));
    let size = header.getUint32(0);
    let headerSize = 8;
    if (size === 1) {
      if (bytes.byteLength < 16) throw new JournalImageError("decode");
      size = Number(header.getBigUint64(8));
      headerSize = 16;
    } else if (size === 0) size = file.size - offset;
    if (!Number.isSafeInteger(size) || size < headerSize || offset + size > file.size) throw new JournalImageError("decode");
    if (type === "meta") {
      if (size < headerSize + 4 || size > 2 * 1024 * 1024) throw new JournalImageError("decode");
      const meta = await file.slice(offset, offset + size).arrayBuffer();
      scan(new DataView(meta), headerSize + 4, size, 0);
      if (!checked) throw new JournalImageError("decode");
      return;
    }
    offset += size;
  }
  throw new JournalImageError("decode");
}
