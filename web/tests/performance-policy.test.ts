import { afterEach, describe, expect, it, vi } from "vitest";
import { mapWithBudget, prefersLowSpecMode } from "../app/lib/performance-policy";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("bounded background work", () => {
  it("caps pending work, preserves order, and lets timers run between batches", async () => {
    let active = 0, peak = 0;
    const completed: number[] = [];
    let timerRan = false;
    setTimeout(() => { timerRan = true; }, 0);
    const result = await mapWithBudget([0, 1, 2, 3, 4], async (value) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, value % 2 ? 0 : 3));
      completed.push(value); active--;
      return value * 2;
    }, { concurrency: 2, workSliceMs: 0 });
    expect(peak).toBe(2);
    expect(timerRan).toBe(true);
    expect(completed).toHaveLength(5);
    expect(result).toEqual([0, 2, 4, 6, 8]);
  });

  it("stops scheduling and discards the result when cancelled mid-batch", async () => {
    const controller = new AbortController();
    const visited: number[] = [];
    await expect(mapWithBudget([0, 1, 2, 3], async (value) => {
      visited.push(value);
      controller.abort();
      return value;
    }, { concurrency: 2, workSliceMs: 8, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(visited).toEqual([0, 1]);
  });

  it("drains in-flight work on failure without starting a later batch", async () => {
    let drained = false;
    const map = vi.fn(async (value: number) => {
      if (value === 0) throw new Error("corrupt record");
      await new Promise((resolve) => setTimeout(resolve, 5)); drained = true;
      return value;
    });
    await expect(mapWithBudget([0, 1, 2], map, { concurrency: 2, workSliceMs: 8 })).rejects.toThrow("corrupt record");
    expect(drained).toBe(true);
    expect(map).toHaveBeenCalledTimes(2);
  });

  it("respects an explicit mode preference over hardware detection", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 2 });
    vi.stubGlobal("localStorage", { getItem: () => "false" });
    expect(prefersLowSpecMode()).toBe(false);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("unavailable"); } });
    expect(prefersLowSpecMode()).toBe(true);
  });
});
