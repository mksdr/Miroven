import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginDiagnosticOperation, clearDiagnosticActivity, diagnosticActivity, diagnosticApiOperation,
  diagnosticContext, diagnosticGeneration, recordDiagnosticEvent, setDiagnosticSyncStatus, trackDiagnosticOperation,
} from "../app/lib/diagnostic-activity";

afterEach(() => { clearDiagnosticActivity(); setDiagnosticSyncStatus(null); vi.restoreAllMocks(); });

describe("memory-only diagnostic activity", () => {
  it("links concurrent operations and records monotonic timing and outcomes", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(100);
    const first = beginDiagnosticOperation("entry.save");
    clock.mockReturnValue(110);
    const second = beginDiagnosticOperation("image.process");
    clock.mockReturnValue(140);
    second("failed", new DOMException("private filename.png", "QuotaExceededError"));
    clock.mockReturnValue(150);
    first(); first();
    const events = diagnosticActivity().events;
    expect(events.map((event) => [event.sequence, event.operationId, event.outcome])).toEqual([
      [1, 1, "started"], [2, 2, "started"], [3, 2, "failed"], [4, 1, "succeeded"],
    ]);
    expect(events[2]).toMatchObject({ elapsedMs: 140, durationMs: 30, errorType: "QuotaExceededError" });
    expect(events[3].durationMs).toBe(50);
  });

  it("bounds history at 200 events and returns isolated snapshots", () => {
    for (let i = 0; i < 110; i++) recordDiagnosticEvent("entry.list");
    const snapshot = diagnosticActivity();
    expect(snapshot.events).toHaveLength(200);
    expect(snapshot.droppedEvents).toBe(20);
    expect(snapshot.events[0].sequence).toBe(21);
    snapshot.events[0].operation = "entry.delete";
    snapshot.events.length = 0;
    expect(diagnosticActivity().events[0].operation).toBe("entry.list");
    expect(diagnosticActivity().events).toHaveLength(200);
  });

  it("discards old completions after a boundary, even when operation IDs repeat", () => {
    setDiagnosticSyncStatus("local");
    const old = beginDiagnosticOperation("entry.save");
    const generation = diagnosticGeneration();
    clearDiagnosticActivity();
    expect(diagnosticGeneration()).toBeGreaterThan(generation);
    expect(diagnosticContext().syncStatus).toBe("local");
    const current = beginDiagnosticOperation("entry.list");
    old("failed", new Error("private content")); current();
    expect(diagnosticActivity().events.map((event) => event.operation)).toEqual(["entry.list", "entry.list"]);
    expect(diagnosticActivity().droppedEvents).toBe(0);
  });

  it("preserves results, rethrows identical failures and categorizes cancellation", async () => {
    const value = { private: "not a diagnostic payload" };
    expect(await trackDiagnosticOperation("entry.save", async () => value)).toBe(value);
    expect(await trackDiagnosticOperation("pin.unlock", async () => false)).toBe(false);
    const error = new DOMException("private ID", "AbortError");
    await expect(trackDiagnosticOperation("entry.list", async () => { throw error; })).rejects.toBe(error);
    expect(diagnosticActivity().events.at(-1)?.outcome).toBe("cancelled");
    expect(JSON.stringify(diagnosticActivity())).not.toContain(value.private);
  });

  it("allows only fixed labels, error types, codes and HTTP statuses", () => {
    const secret = "synthetic-journal-photo.png-email@example.com-token-key-PIN";
    const error = { name: secret, code: secret, message: secret, stack: secret, body: secret };
    beginDiagnosticOperation(secret as "entry.save")("failed", error, 999);
    beginDiagnosticOperation("api.sync.changes")("failed", { ...error, code: "cursor_expired" }, 410);
    const serialized = JSON.stringify(diagnosticActivity());
    expect(serialized).not.toContain(secret);
    expect(diagnosticActivity().events[1]).toMatchObject({ operation: "api.unknown", errorType: "unknown", errorCode: "unknown" });
    expect(diagnosticActivity().events[1]).not.toHaveProperty("httpStatus");
    expect(diagnosticActivity().events.at(-1)).toMatchObject({ httpStatus: 410, errorCode: "cursor_expired" });
    expect(diagnosticApiOperation("/sync/changes?cursor=" + secret)).toBe("api.sync.changes");
    expect(diagnosticApiOperation("/blobs/" + secret)).toBe("api.blob");
    expect(diagnosticApiOperation("/unknown/" + secret)).toBe("api.unknown");
    expect(diagnosticApiOperation("__proto__")).toBe("api.unknown");
  });

  it("does not let hostile errors or unavailable timing change application results", async () => {
    vi.spyOn(performance, "now").mockImplementation(() => { throw new Error("unavailable"); });
    const hostile = { get name() { throw new Error("private getter"); } };
    await expect(trackDiagnosticOperation("entry.save", async () => { throw hostile; })).rejects.toBe(hostile);
    expect(diagnosticActivity().events.at(-1)).toMatchObject({ outcome: "failed", errorType: "unknown", errorCode: "unknown" });
    expect(await trackDiagnosticOperation("entry.save", async () => "ok")).toBe("ok");
  });
});
