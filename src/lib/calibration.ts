import { DurationLog } from "./types";

/**
 * The LEARN phase: personal history replaces both gut feel and research
 * priors (reference-class forecasting — the planning-fallacy literature's
 * only reliable fix). After MIN_LOGS real measurements, the personal median
 * outranks everything else when planning.
 */

export const MIN_LOGS_FOR_HISTORY = 5;
const WINDOW = 5;

export function logsFor(logs: DurationLog[], taskId: string): DurationLog[] {
  return logs.filter((l) => l.taskId === taskId);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median of the last WINDOW logs for a task, or null if not enough data. */
export function personalMedian(logs: DurationLog[], taskId: string): number | null {
  const mine = logsFor(logs, taskId);
  if (mine.length < MIN_LOGS_FOR_HISTORY) return null;
  return Math.round(median(mine.slice(-WINDOW).map((l) => l.actualMinutes)));
}

/** Signed % error of a guess vs reality. Positive = underestimated. */
export function estimationErrorPct(guessMinutes: number, actualMinutes: number): number {
  if (guessMinutes <= 0) return 100;
  return Math.round(((actualMinutes - guessMinutes) / guessMinutes) * 100);
}

/**
 * Calibration score 0–100: how close the user's blind guesses are to
 * reality lately. 100 = perfect internal clock. This is THE trained metric —
 * graduation levels key off it.
 */
export function calibrationScore(logs: DurationLog[], window = 10): number | null {
  if (logs.length === 0) return null;
  const recent = logs.slice(-window);
  const avgAbsError =
    recent.reduce((sum, l) => sum + Math.abs(estimationErrorPct(l.guessMinutes, l.actualMinutes)), 0) /
    recent.length;
  return Math.max(0, Math.round(100 - avgAbsError));
}

/** Rolling guess-vs-actual pairs for the stats trend, oldest first. */
export function errorTrend(logs: DurationLog[], window = 14): { at: string; errorPct: number }[] {
  return logs.slice(-window).map((l) => ({
    at: l.at,
    errorPct: estimationErrorPct(l.guessMinutes, l.actualMinutes),
  }));
}
