import encode from "@jsquash/webp/encode.js";

self.onmessage = async (event: MessageEvent<{ pixels: ImageData; quality: number }>) => {
  try {
    const output = await encode(event.data.pixels, { quality: event.data.quality * 100 });
    self.postMessage(output, { transfer: [output] });
  } catch {
    self.postMessage(null);
  }
};
