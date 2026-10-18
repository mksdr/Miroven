// Web Locks coordinate tabs/workers; the fallback coordinates this JS runtime.
// Keep network waits outside the mutation lock so editing stays responsive.
const queues = new WeakMap<IDBFactory, Map<string, Promise<unknown>>>();

export async function withVaultLock<T>(name: "mutation" | "sync", action: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(`private-journal:${name}`, action);
  }
  const factory = indexedDB;
  let locks = queues.get(factory);
  if (!locks) {
    locks = new Map();
    queues.set(factory, locks);
  }
  const previous = locks.get(name) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(action);
  locks.set(name, result);
  const cleanup = () => {
    if (locks.get(name) === result) locks.delete(name);
  };
  void result.then(cleanup, cleanup);
  return result;
}
