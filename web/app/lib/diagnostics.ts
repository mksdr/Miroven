import { version as appVersion } from "../../package.json";
import { getSyncSnapshot, hasPinLock, listEntries } from "./local-vault";

export type DiagnosticReport = {
  appVersion: string;
  generatedAt: string;
  environment: {
    online: boolean;
    language: string;
    theme: string;
    userAgent: string;
  };
  metrics: {
    totalEntriesCount: number;
    entriesWithImageCount: number;
    pendingSyncCount: number;
    conflictsCount: number;
  };
  securityAndVault: {
    hasPinLock: boolean;
    isVaultLocked: boolean;
  };
  storage: {
    isPersistent: boolean;
    usageMB: string | null;
    quotaMB: string | null;
  };
};

export async function createDiagnosticReport(params: {
  language: string;
  theme: string;
  isVaultLocked: boolean;
}): Promise<DiagnosticReport> {
  const entries = params.isVaultLocked ? [] : await listEntries().catch(() => []);
  const snapshot = await getSyncSnapshot().catch(() => ({ cursor: 0, pending: 0, conflicts: 0 }));
  const pinLockActive = await hasPinLock().catch(() => false);

  let usageMB: string | null = null;
  let quotaMB: string | null = null;
  let isPersistent = false;

  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      if (estimate.usage) usageMB = (estimate.usage / (1024 * 1024)).toFixed(1);
      if (estimate.quota) quotaMB = (estimate.quota / (1024 * 1024)).toFixed(1);
    } catch {
      // Ignore
    }
  }

  if (typeof navigator !== "undefined" && navigator.storage?.persisted) {
    try {
      isPersistent = await navigator.storage.persisted();
    } catch {
      // Ignore
    }
  }

  return {
    appVersion,
    generatedAt: new Date().toISOString(),
    environment: {
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      language: params.language,
      theme: params.theme,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "SSR",
    },
    metrics: {
      totalEntriesCount: entries.length,
      entriesWithImageCount: entries.filter((e) => Boolean(e.image)).length,
      pendingSyncCount: snapshot.pending,
      conflictsCount: snapshot.conflicts,
    },
    securityAndVault: {
      hasPinLock: pinLockActive,
      isVaultLocked: params.isVaultLocked,
    },
    storage: {
      isPersistent,
      usageMB,
      quotaMB,
    },
  };
}

export async function downloadDiagnosticReport(params: {
  language: string;
  theme: string;
  isVaultLocked: boolean;
}): Promise<void> {
  const report = await createDiagnosticReport(params);
  const jsonString = JSON.stringify(report, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `miroven-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();

  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
