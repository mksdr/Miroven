/** Bounded, memory-only breadcrumbs. Never accept arbitrary payloads or error text. */
const operations = [
  "entry.list", "entry.save", "entry.delete", "entry.pin", "image.process", "image.load",
  "pin.setup", "pin.remove", "pin.unlock", "backup.export", "backup.import",
  "recovery.create", "recovery.restore", "sync.run", "sync.keep-both", "sync.use-local",
  "account.load", "backup.load", "diagnostics.load", "api.auth.policy", "api.auth.session",
  "api.auth.request-code", "api.auth.verify-code", "api.auth.logout", "api.auth.logout-all",
  "api.vault", "api.sync.push", "api.sync.changes", "api.sync.snapshot", "api.blob",
  "api.account", "api.account.usage", "api.account.deletion", "api.unknown",
  "network.online", "network.offline", "page.visible", "page.hidden",
  "sw.register", "sw.controller-change", "runtime.error", "runtime.rejection",
] as const;
export type DiagnosticOperation = typeof operations[number];
type Outcome = "started" | "succeeded" | "failed" | "cancelled";
const errorTypes = ["AbortError", "QuotaExceededError", "NotAllowedError", "NotFoundError",
  "InvalidStateError", "OperationError", "DataError", "SecurityError", "TypeError", "RangeError", "SyntaxError"] as const;
const errorCodes = ["http_error", "invalid_code", "auth_scope_changed", "cursor_expired", "invalid_cursor",
  "rate_limited", "quota_exceeded", "unauthorized", "forbidden", "revision_conflict", "PIN_LOCK_CONFIGURED"] as const;
export type DiagnosticEvent = {
  sequence: number; elapsedMs: number; operationId: number; operation: DiagnosticOperation;
  outcome: Outcome; durationMs?: number; errorType?: string; errorCode?: string; httpStatus?: number;
};
export const DIAGNOSTIC_EVENT_LIMIT = 200;
let events: DiagnosticEvent[] = [];
let droppedEvents = 0;
let sequence = 0;
let operationId = 0;
let generation = 0;
let authenticated: boolean | null = null;
const syncStates = ["local", "ready", "syncing", "synced", "conflict", "error"] as const;
type DiagnosticSyncState = typeof syncStates[number];
let syncStatus: DiagnosticSyncState | null = null;

function now(): number {
  try { return Math.max(0, Math.round(performance.now())); } catch { return 0; }
}
function append(event: Omit<DiagnosticEvent, "sequence" | "elapsedMs">): void {
  events.push({ ...event, sequence: ++sequence, elapsedMs: now() });
  if (events.length > DIAGNOSTIC_EVENT_LIMIT) { events.shift(); droppedEvents++; }
}
export function diagnosticGeneration(): number { return generation; }
export function clearDiagnosticActivity(): void {
  generation++;
  events = [];
  droppedEvents = 0;
  sequence = 0;
  operationId = 0;
}
export function diagnosticContext() { return { authenticated, syncStatus }; }
export function setDiagnosticAuthenticated(value: boolean): void { authenticated = value === true; }
export function setDiagnosticSyncStatus(value: DiagnosticSyncState | null): void {
  syncStatus = value !== null && syncStates.includes(value) ? value : null;
}
export function diagnosticActivity() {
  return { limit: DIAGNOSTIC_EVENT_LIMIT, droppedEvents, events: events.map((event) => ({ ...event })) };
}
export function beginDiagnosticOperation(operation: DiagnosticOperation) {
  const epoch = generation;
  const id = ++operationId;
  const started = now();
  let finished = false;
  // Validate at runtime too: JavaScript callers cannot inject labels or payloads.
  const safeOperation = operations.includes(operation) ? operation : "api.unknown";
  try { append({ operation: safeOperation, operationId: id, outcome: "started" }); } catch { /* Best effort. */ }
  return (outcome: Exclude<Outcome, "started"> = "succeeded", error?: unknown, httpStatus?: number) => {
    if (finished || epoch !== generation) return;
    finished = true;
    try {
      const details: Partial<DiagnosticEvent> = {};
      if (error !== undefined) {
        const candidate = error as { name?: unknown; code?: unknown } | null;
        let name: unknown;
        let code: unknown;
        try { name = candidate?.name; } catch { /* Use unknown. */ }
        try { code = candidate?.code; } catch { /* Use unknown. */ }
        details.errorType = errorTypes.includes(name as typeof errorTypes[number]) ? name as string : "unknown";
        details.errorCode = errorCodes.includes(code as typeof errorCodes[number]) ? code as string : "unknown";
      }
      if (Number.isInteger(httpStatus) && httpStatus! >= 100 && httpStatus! <= 599) details.httpStatus = httpStatus;
      append({ ...details, operation: safeOperation, operationId: id,
        outcome: ["succeeded", "failed", "cancelled"].includes(outcome) ? outcome : "failed",
        durationMs: Math.max(0, now() - started) });
    } catch { /* Even hostile error getters must not affect the application. */ }
  };
}
export async function trackDiagnosticOperation<T>(operation: DiagnosticOperation, action: () => Promise<T>): Promise<T> {
  const finish = beginDiagnosticOperation(operation);
  try {
    const result = await action();
    finish(result === false ? "failed" : "succeeded");
    return result;
  } catch (error) {
    let cancelled = false;
    try { cancelled = (error as { name?: unknown } | null)?.name === "AbortError"; } catch { /* Unknown error. */ }
    finish(cancelled ? "cancelled" : "failed", error);
    throw error;
  }
}
export function recordDiagnosticEvent(operation: DiagnosticOperation, error?: unknown): void {
  beginDiagnosticOperation(operation)(error === undefined ? "succeeded" : "failed", error);
}

/** Classify only known route shapes; never retain paths, queries, IDs or bodies. */
export function diagnosticApiOperation(path: string): DiagnosticOperation {
  const route = path.split("?", 1)[0];
  const routes: Record<string, DiagnosticOperation> = {
    "/auth/policy": "api.auth.policy", "/auth/session": "api.auth.session",
    "/auth/code/request": "api.auth.request-code", "/auth/code/verify": "api.auth.verify-code",
    "/auth/logout": "api.auth.logout", "/auth/logout-all": "api.auth.logout-all",
    "/vault": "api.vault", "/sync/push": "api.sync.push", "/sync/changes": "api.sync.changes",
    "/sync/snapshot": "api.sync.snapshot", "/account": "api.account",
    "/account/usage": "api.account.usage", "/account/deletion": "api.account.deletion",
  };
  if (route === "/blobs" || /^\/blobs\/[^/]+$/.test(route)) return "api.blob";
  if (/^\/account\/deletion\/[^/]+$/.test(route)) return "api.account.deletion";
  return Object.hasOwn(routes, route) ? routes[route] : "api.unknown";
}
