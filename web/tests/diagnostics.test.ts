import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { version } from "../package.json";
import { createDiagnosticReport } from "../app/lib/diagnostics";
import { createRecoveryKit, lockDeviceKey, saveEntry, setupPinLock } from "../app/lib/local-vault";

const DATABASE_NAME = "private-journal";

function deleteTestDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Database deletion failed"));
    request.onblocked = () => reject(new Error("Database blocked"));
  });
}

describe("diagnostics unit tests", () => {
  beforeEach(deleteTestDatabase);
  afterEach(deleteTestDatabase);

  it("generates privacy-safe diagnostic report with zero plaintext content or secrets", async () => {
    await createRecoveryKit();
    await saveEntry({
      id: "018f91f0-776b-7c8a-80d8-82455b099999",
      text: "비공개 저널 일기 테스트 본문",
      createdAt: "2026-08-01T15:00:00.000Z",
    });

    const report = await createDiagnosticReport({
      language: "ko",
      theme: "light",
      isVaultLocked: false,
    });

    expect(report.appVersion).toBe(version);
    expect(report.metrics.totalEntriesCount).toBe(1);
    expect(report.environment.language).toBe("ko");

    const jsonString = JSON.stringify(report);
    expect(jsonString).not.toContain("비공개 저널 일기 테스트 본문");
    expect(jsonString).not.toContain("018f91f0-776b-7c8a-80d8-82455b099999");
  });

  it("counts legacy and multi-photo entries once each without exposing their content", async () => {
    await createRecoveryKit();
    const photo = { dataUrl: "data:image/webp;base64,AAAA", width: 1, height: 1, mimeType: "image/webp" };
    const base = { text: "synthetic private photo entry", createdAt: "2026-08-01T15:00:00.000Z" };
    await saveEntry({ ...base, id: "018f91f0-776b-7c8a-80d8-82455b099991", image: photo });
    await saveEntry({
      ...base, id: "018f91f0-776b-7c8a-80d8-82455b099992", attachmentVersion: 2,
      images: [{ ...photo, id: "first" }, { ...photo, id: "second" }],
    });
    await saveEntry({ ...base, id: "018f91f0-776b-7c8a-80d8-82455b099993", attachmentVersion: 2, images: [] });
    await saveEntry({ ...base, id: "018f91f0-776b-7c8a-80d8-82455b099994" });

    const report = await createDiagnosticReport({ language: "en", theme: "light", isVaultLocked: false });

    expect(report.metrics.totalEntriesCount).toBe(4);
    expect(report.metrics.entriesWithImageCount).toBe(2);
    expect(JSON.stringify(report)).not.toContain(photo.dataUrl);
    expect(JSON.stringify(report)).not.toContain(base.text);
    expect(JSON.stringify(report)).not.toContain("018f91f0-776b-7c8a-80d8-82455b099992");
  });

  it("does not include entry or photo counts from a locked vault", async () => {
    await createRecoveryKit();
    await saveEntry({
      id: "018f91f0-776b-7c8a-80d8-82455b099995", text: "synthetic locked entry",
      createdAt: "2026-08-01T15:00:00.000Z", attachmentVersion: 2,
      images: [{ id: "locked", dataUrl: "data:image/webp;base64,AAAA", width: 1, height: 1, mimeType: "image/webp" }],
    });
    await setupPinLock("123456");
    await lockDeviceKey();

    const report = await createDiagnosticReport({ language: "en", theme: "dark", isVaultLocked: true });

    expect(report.metrics.totalEntriesCount).toBe(0);
    expect(report.metrics.entriesWithImageCount).toBe(0);
    expect(report.securityAndVault).toEqual({ hasPinLock: true, isVaultLocked: true });
    expect(JSON.stringify(report)).not.toContain("synthetic locked entry");
    expect(JSON.stringify(report)).not.toContain("data:image/");
  });
});
