/** Admin-only pipeline log: persisted in sessionStorage, survives navigation away from Optimize. */

const STORAGE_KEY = "pitchcv_admin_pipeline_log_v1";
const MAX_ENTRIES = 400;

export type AdminPipelineLogEntry = {
  ts: string;
  phase: "analyze" | "optimize" | "client" | "templates_lab";
  step: string;
  message: string;
  data?: Record<string, unknown>;
};

let captureEnabled = false;
const listeners = new Set<() => void>();

function loadFromStorage(): AdminPipelineLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is AdminPipelineLogEntry =>
        x &&
        typeof x === "object" &&
        typeof (x as AdminPipelineLogEntry).ts === "string" &&
        typeof (x as AdminPipelineLogEntry).message === "string"
    );
  } catch {
    return [];
  }
}

function saveToStorage(entries: AdminPipelineLogEntry[]) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore quota
  }
}

let memoryEntries: AdminPipelineLogEntry[] | null = null;

function getEntries(): AdminPipelineLogEntry[] {
  if (memoryEntries === null) memoryEntries = loadFromStorage();
  return memoryEntries;
}

function setEntries(next: AdminPipelineLogEntry[]) {
  const trimmed = next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
  memoryEntries = trimmed;
  saveToStorage(trimmed);
  listeners.forEach((fn) => fn());
}

export function setAdminPipelineCapture(on: boolean) {
  captureEnabled = on;
}

/** Call on logout so the next account does not inherit pipeline logs. */
export function clearAdminPipelineLogOnLogout(): void {
  memoryEntries = [];
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  listeners.forEach((fn) => fn());
}

export function isAdminPipelineCaptureEnabled(): boolean {
  return captureEnabled;
}

export function appendAdminPipelineLog(
  partial: Omit<AdminPipelineLogEntry, "ts"> & { ts?: string }
): void {
  if (!captureEnabled) return;
  const ts = partial.ts ?? new Date().toISOString();
  const entry: AdminPipelineLogEntry = {
    ts,
    phase: partial.phase,
    step: partial.step,
    message: partial.message,
    ...(partial.data !== undefined ? { data: partial.data } : {}),
  };
  setEntries([...getEntries(), entry]);
}

export function appendAdminPipelineLogs(entries: AdminPipelineLogEntry[]): void {
  if (!captureEnabled || entries.length === 0) return;
  setEntries([...getEntries(), ...entries]);
}

export function clearAdminPipelineLog(): void {
  setEntries([]);
}

export function getAdminPipelineSnapshot(): AdminPipelineLogEntry[] {
  return [...getEntries()];
}

export function subscribeAdminPipelineLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
