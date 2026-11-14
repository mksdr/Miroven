import { version as appVersion } from "../../package.json";
import { getSyncSnapshot, hasPinLock, listEntries } from "./local-vault";
import { entryImages } from "./journal-images";
import { diagnosticActivity, diagnosticContext, diagnosticGeneration } from "./diagnostic-activity";

type CollectionStatus = "ok" | "failed" | "unsupported" | "locked";
export class DiagnosticCancelledError extends Error {
  constructor() { super("Diagnostic export cancelled after a privacy boundary changed."); this.name = "DiagnosticCancelledError"; }
}
export function assertDiagnosticGeneration(generation: number): void {
  if (generation !== diagnosticGeneration()) throw new DiagnosticCancelledError();
}

export type DiagnosticReport = {
  schemaVersion: 2;
  activity: ReturnType<typeof diagnosticActivity>;
  runtime: {
    viewport: { width: number; height: number; pixelRatio: number } | null;
    timeZone: string | null;
    displayMode: "standalone" | "browser" | null;
    apiConfigured: boolean;
    authenticated: boolean | null;
    syncStatus: ReturnType<typeof diagnosticContext>["syncStatus"];
    serviceWorker: { supported: boolean; controlled: boolean };
  };
  collectionStatus: Record<"entries" | "sync" | "pinLock" | "storageEstimate" | "storagePersistence" | "runtime", CollectionStatus>;
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
  const generation = diagnosticGeneration();
  const collectionStatus: DiagnosticReport["collectionStatus"] = {
    entries: params.isVaultLocked ? "locked" : "ok", sync: "ok", pinLock: "ok",
    storageEstimate: "unsupported", storagePersistence: "unsupported", runtime: "unsupported",
  };
  const entries = params.isVaultLocked ? [] : await listEntries().catch(() => {
    collectionStatus.entries = "failed"; return [];
  });
  const snapshot = await getSyncSnapshot().catch(() => {
    collectionStatus.sync = "failed"; return { pending: 0, conflicts: 0 };
  });
  const pinLockActive = await hasPinLock().catch(() => { collectionStatus.pinLock = "failed"; return false; });
  let usageMB: string | null = null;
  let quotaMB: string | null = null;
  let isPersistent = false;
  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      if (typeof estimate.usage === "number") usageMB = (estimate.usage / (1024 * 1024)).toFixed(1);
      if (typeof estimate.quota === "number") quotaMB = (estimate.quota / (1024 * 1024)).toFixed(1);
      collectionStatus.storageEstimate = "ok";
    } catch { collectionStatus.storageEstimate = "failed"; }
  }
  if (typeof navigator !== "undefined" && navigator.storage?.persisted) {
    try {
      isPersistent = await navigator.storage.persisted();
      collectionStatus.storagePersistence = "ok";
    } catch { collectionStatus.storagePersistence = "failed"; }
  }
  const runtime: DiagnosticReport["runtime"] = {
    viewport: null, timeZone: null, displayMode: null,
    apiConfigured: Boolean(process.env.NEXT_PUBLIC_MIROVEN_API_URL),
    ...diagnosticContext(), serviceWorker: { supported: false, controlled: false },
  };
  if (typeof window !== "undefined") {
    try {
      runtime.viewport = { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio };
      runtime.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
      runtime.displayMode = window.matchMedia("(display-mode: standalone)").matches
        || (navigator as Navigator & { standalone?: boolean }).standalone === true ? "standalone" : "browser";
      runtime.serviceWorker = { supported: "serviceWorker" in navigator,
        controlled: "serviceWorker" in navigator && Boolean(navigator.serviceWorker.controller) };
      collectionStatus.runtime = "ok";
    } catch { collectionStatus.runtime = "failed"; }
  }
  assertDiagnosticGeneration(generation);

  return {
    schemaVersion: 2, activity: diagnosticActivity(), runtime, collectionStatus,
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
      entriesWithImageCount: entries.filter((entry) => entryImages(entry).length > 0).length,
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
}, expectedGeneration = diagnosticGeneration()): Promise<void> {
  assertDiagnosticGeneration(expectedGeneration);
  const report = await createDiagnosticReport(params);
  assertDiagnosticGeneration(expectedGeneration);
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
