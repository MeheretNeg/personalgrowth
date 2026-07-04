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
} as const;

const DEFAULT_SETTINGS: Settings = { earlyBufferMinutes: 10, level: 1 };

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
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

export const loadSettings = (): Settings => read<Settings>(KEYS.settings, DEFAULT_SETTINGS);
export const saveSettings = (s: Settings): void => write(KEYS.settings, s);
