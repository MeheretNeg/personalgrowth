import { Debrief, DurationLog, Settings, Trip } from "./types";

/**
 * localStorage persistence. Single active trip; logs and debriefs accumulate
 * forever (they are the training record).
 */

const KEYS = {
  trip: "anchor:trip",
  logs: "anchor:logs",
  debriefs: "anchor:debriefs",
  settings: "anchor:settings",
  lastTasks: "anchor:lastTasks",
  solo: "anchor:solo",
  planDraft: "anchor:planDraft",
} as const;

const DEFAULT_SETTINGS: Settings = { earlyBufferMinutes: 10, level: 1 };

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt JSON: quarantine the raw string instead of destroying it on
    // the next write, so the months-of-training record can be recovered.
    try {
      window.localStorage.setItem(`${key}:corrupt-${new Date().getTime()}`, raw);
    } catch {
      /* quota — nothing more we can do */
    }
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled — surface nothing here; callers of
    // append* still return the in-memory value so the current session works.
  }
}

export const loadTrip = (): Trip | null => read<Trip | null>(KEYS.trip, null);
export const saveTrip = (trip: Trip): void => write(KEYS.trip, trip);
export const clearTrip = (): void => {
  if (typeof window !== "undefined") window.localStorage.removeItem(KEYS.trip);
};

export const loadLogs = (): DurationLog[] => read<DurationLog[]>(KEYS.logs, []);
export const appendLog = (log: DurationLog): DurationLog[] => {
  const logs = [...loadLogs(), log];
  write(KEYS.logs, logs);
  return logs;
};

export const loadDebriefs = (): Debrief[] => read<Debrief[]>(KEYS.debriefs, []);
export const appendDebrief = (d: Debrief): Debrief[] => {
  const all = [...loadDebriefs(), d];
  write(KEYS.debriefs, all);
  return all;
};

export const loadSettings = (): Settings => {
  // Merge over defaults so a settings object written before a field existed
  // (e.g. an old user with no planMode) never reads back undefined.
  const stored = read<Partial<Settings>>(KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...stored };
};
export const saveSettings = (s: Settings): void => write(KEYS.settings, s);

/**
 * A half-finished plan. The wizard has several screens; a time-blind user
 * who gets interrupted mid-plan and loses everything won't come back. We
 * persist the draft on every change and offer to resume it — but never
 * auto-restore (that would surprise someone deliberately starting fresh).
 */
export interface PlanDraft {
  savedAt: string;
  step: number;
  destination: string;
  arrivalTime: string;
  arrivalDateStr: string;
  noPrep: boolean;
  mode: string | null;
  driveGuess: string;
  driveSuggested: boolean;
  walkGuess: string;
  walkSuggested: boolean;
  transitDeparture: string;
  walkToStop: string;
  transitRideGuess: string;
  pickupTime: string;
  pickupDriveGuess: string;
  planMode: "train" | "quick";
  selections: unknown[];
}

export const loadPlanDraft = (): PlanDraft | null =>
  read<PlanDraft | null>(KEYS.planDraft, null);
export const savePlanDraft = (d: PlanDraft): void => write(KEYS.planDraft, d);
export const clearPlanDraft = (): void => {
  if (typeof window !== "undefined") window.localStorage.removeItem(KEYS.planDraft);
};

/** Ask the browser to keep our storage from being auto-evicted. Best-effort. */
export function requestPersistentStorage(): void {
  if (typeof navigator !== "undefined" && navigator.storage?.persist) {
    void navigator.storage.persist().catch(() => {});
  }
}

/** The whole irreplaceable training record, for backup/restore. */
export interface AnchorBackup {
  version: 1;
  exportedAt: string;
  logs: DurationLog[];
  debriefs: Debrief[];
  settings: Settings;
  lastTasks: string[];
}

export function exportBackup(): AnchorBackup {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    logs: loadLogs(),
    debriefs: loadDebriefs(),
    settings: loadSettings(),
    lastTasks: loadLastTaskIds(),
  };
}

/** Merge an imported backup into the current record. Dedupes by (at) stamp. */
export function importBackup(raw: unknown): { logs: number; debriefs: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Partial<AnchorBackup>;
  if (!Array.isArray(b.logs) || !Array.isArray(b.debriefs)) return null;
  const curLogs = loadLogs();
  const logKeys = new Set(curLogs.map((l) => `${l.taskId}@${l.at}`));
  let addedLogs = 0;
  for (const l of b.logs) {
    if (l && typeof l.at === "string" && !logKeys.has(`${l.taskId}@${l.at}`)) {
      curLogs.push(l);
      logKeys.add(`${l.taskId}@${l.at}`);
      addedLogs++;
    }
  }
  const curDebriefs = loadDebriefs();
  const dKeys = new Set(curDebriefs.map((d) => d.at));
  let addedDebriefs = 0;
  for (const d of b.debriefs) {
    if (d && typeof d.at === "string" && !dKeys.has(d.at)) {
      curDebriefs.push(d);
      dKeys.add(d.at);
      addedDebriefs++;
    }
  }
  curLogs.sort((a, z) => a.at.localeCompare(z.at));
  curDebriefs.sort((a, z) => a.at.localeCompare(z.at));
  write(KEYS.logs, curLogs);
  write(KEYS.debriefs, curDebriefs);
  return { logs: addedLogs, debriefs: addedDebriefs };
}

/** Task ids from the last locked plan — powers the one-tap "My usual". */
export const loadLastTaskIds = (): string[] => read<string[]>(KEYS.lastTasks, []);
export const saveLastTaskIds = (ids: string[]): void => write(KEYS.lastTasks, ids);

/** Free solo (Level 3+): destination + required time, no timeline — the
 * internal clock alone. Graduation demonstrated, not asserted. */
export interface SoloTrip {
  destination: string;
  arrivalTime: string; // ISO
  startedAt: string; // ISO
}
export const loadSolo = (): SoloTrip | null => read<SoloTrip | null>(KEYS.solo, null);
export const saveSolo = (s: SoloTrip): void => write(KEYS.solo, s);
export const clearSolo = (): void => {
  if (typeof window !== "undefined") window.localStorage.removeItem(KEYS.solo);
};
