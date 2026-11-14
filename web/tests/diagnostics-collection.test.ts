import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const vault = vi.hoisted(() => ({ listEntries: vi.fn(), getSyncSnapshot: vi.fn(), hasPinLock: vi.fn() }));
vi.mock("../app/lib/local-vault", () => vault);
import { createDiagnosticReport, downloadDiagnosticReport } from "../app/lib/diagnostics";
import { clearDiagnosticActivity, diagnosticGeneration, recordDiagnosticEvent } from "../app/lib/diagnostic-activity";
const params = { language: "en", theme: "dark", isVaultLocked: false };
beforeEach(() => {
  vault.listEntries.mockResolvedValue([]);
  vault.getSyncSnapshot.mockResolvedValue({ pending: 0, conflicts: 0 });
  vault.hasPinLock.mockResolvedValue(false);
});
afterEach(() => { clearDiagnosticActivity(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe("diagnostic collection availability and boundaries", () => {
  it("distinguishes unavailable APIs from successfully measured zero and false", async () => {
    vi.stubGlobal("navigator", { onLine: false, userAgent: "synthetic" });
    const unsupported = await createDiagnosticReport(params);
    expect(unsupported.schemaVersion).toBe(2);
    expect(unsupported.collectionStatus).toMatchObject({ entries: "ok", storageEstimate: "unsupported", storagePersistence: "unsupported" });
    vi.stubGlobal("navigator", { onLine: false, storage: {
      estimate: async () => ({ usage: 0, quota: 0 }), persisted: async () => false,
    } });
    const measured = await createDiagnosticReport(params);
    expect(measured.storage).toEqual({ usageMB: "0.0", quotaMB: "0.0", isPersistent: false });
    expect(measured.collectionStatus.storageEstimate).toBe("ok");
    expect(measured.collectionStatus.storagePersistence).toBe("ok");
  });

  it("exports partial results without errors, content or network calls", async () => {
    const secret = "synthetic-private-entry-photo-key-email@example.com";
    vault.listEntries.mockRejectedValue(new Error(secret));
    vault.hasPinLock.mockRejectedValue(new Error(secret));
    vault.getSyncSnapshot.mockResolvedValue({ pending: 3, conflicts: 2 });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("navigator", { storage: {
      estimate: async () => { throw new Error(secret); }, persisted: async () => { throw new Error(secret); },
    } });
    recordDiagnosticEvent("entry.save", new Error(secret));
    const report = await createDiagnosticReport(params);
    expect(report.collectionStatus).toMatchObject({ entries: "failed", pinLock: "failed", sync: "ok", storageEstimate: "failed", storagePersistence: "failed" });
    expect(report.metrics).toMatchObject({ totalEntriesCount: 0, pendingSyncCount: 3, conflictsCount: 2 });
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("marks locked entries as omitted and failed sync as unmeasured", async () => {
    vault.getSyncSnapshot.mockRejectedValue(new Error("private cursor"));
    const report = await createDiagnosticReport({ ...params, isVaultLocked: true });
    expect(vault.listEntries).not.toHaveBeenCalled();
    expect(report.collectionStatus).toMatchObject({ entries: "locked", sync: "failed" });
    expect(report.metrics.pendingSyncCount).toBe(0);
  });

  it("cancels reports collected across a privacy boundary", async () => {
    let release!: (value: { usage: number }) => void;
    vi.stubGlobal("navigator", { storage: { estimate: () => new Promise((resolve) => { release = resolve; }) } });
    const report = createDiagnosticReport(params);
    const rejected = expect(report).rejects.toMatchObject({ name: "DiagnosticCancelledError" });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    clearDiagnosticActivity(); release({ usage: 0 });
    await rejected;
  });

  it("rejects stale download requests before reading storage or accessing the DOM", async () => {
    const generation = diagnosticGeneration();
    clearDiagnosticActivity();
    await expect(downloadDiagnosticReport(params, generation)).rejects.toMatchObject({ name: "DiagnosticCancelledError" });
    expect(vault.listEntries).not.toHaveBeenCalled();
  });
});
