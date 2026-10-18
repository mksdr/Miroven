export function isLowSpecDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return (navigator.hardwareConcurrency ?? 8) <= 4 || memory <= 4;
}

export function prefersLowSpecMode(): boolean {
  try {
    const saved = localStorage.getItem("miroven:low_spec_mode");
    if (saved !== null) return saved === "true";
  } catch { /* Storage may be unavailable in restricted browser contexts. */ }
  return isLowSpecDevice();
}

export function performancePolicy(lowSpecMode: boolean) {
  return {
    decryptConcurrency: lowSpecMode ? 8 : 16,
    workSliceMs: lowSpecMode ? 8 : 16,
    scrollBehavior: lowSpecMode ? "instant" as const : "smooth" as const,
  };
}

function yieldToMainThread(): Promise<void> {
  if (typeof MessageChannel === "undefined") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  // Unlike nested zero-delay timers, posted messages do not incur a 4ms clamp.
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** Limit pending crypto work and periodically yield without changing result order. */
export async function mapWithBudget<T, U>(
  items: readonly T[],
  map: (item: T) => Promise<U>,
  options: { concurrency: number; workSliceMs: number; signal?: AbortSignal },
): Promise<U[]> {
  const { concurrency, workSliceMs, signal } = options;
  if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isFinite(workSliceMs) || workSliceMs < 0) {
    throw new RangeError("Invalid work budget");
  }
  const results: U[] = [];
  let sliceStart = performance.now();
  for (let offset = 0; offset < items.length; offset += concurrency) {
    signal?.throwIfAborted();
    // Await all in-flight work on failure as well; do not launch another batch.
    const batch = await Promise.allSettled(items.slice(offset, offset + concurrency).map(map));
    signal?.throwIfAborted();
    for (const result of batch) {
      if (result.status === "rejected") throw result.reason;
      results.push(result.value);
    }
    if (offset + concurrency < items.length && performance.now() - sliceStart >= workSliceMs) {
      await yieldToMainThread();
      sliceStart = performance.now();
    }
  }
  signal?.throwIfAborted();
  return results;
}
