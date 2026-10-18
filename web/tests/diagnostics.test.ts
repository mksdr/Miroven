import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { version } from "../package.json";
import { createDiagnosticReport } from "../app/lib/diagnostics";
import { createRecoveryKit, saveEntry } from "../app/lib/local-vault";

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
});
