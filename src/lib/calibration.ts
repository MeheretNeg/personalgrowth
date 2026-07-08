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

/** True elapsed minutes — seconds precision (newer logs) over rounded. */
function actualMin(l: DurationLog): number {
  return l.actualSeconds != null ? l.actualSeconds / 60 : l.actualMinutes;
}

/** Median of the last WINDOW logs for a task, or null if not enough data. */
export function personalMedian(logs: DurationLog[], taskId: string): number | null {
  const mine = logsFor(logs, taskId);
  if (mine.length < MIN_LOGS_FOR_HISTORY) return null;
  return Math.round(median(mine.slice(-WINDOW).map(actualMin)));
}

/** Signed % error of a guess vs reality. Positive = underestimated. */
export function estimationErrorPct(guessMinutes: number, actualMinutes: number): number {
  if (guessMinutes <= 0) return 100;
  return Math.round(((actualMinutes - guessMinutes) / guessMinutes) * 100);
}

/** Log-level error using the most precise elapsed value available. */
function logErrorPct(l: DurationLog): number {
  return estimationErrorPct(l.guessMinutes, actualMin(l));
}

/**
 * Calibration score 0–100: how close the user's blind guesses are to
 * reality lately. 100 = perfect internal clock. This is THE trained metric —
 * graduation levels key off it.
 */
/**
 * Logs that can honestly score the clock: a real blind guess, and long
 * enough that whole-minute rounding isn't the whole signal (a 2-minute
 * task measured at 1:20 rounds to ±50% error — pure quantization noise).
 */
export function scorableLogs(logs: DurationLog[]): DurationLog[] {
  return logs.filter(
    (l) => l.guessMinutes > 0 && Math.max(l.guessMinutes, actualMin(l)) >= 5,
  );
}

export function calibrationScore(logs: DurationLog[], window = 10): number | null {
  const scored = scorableLogs(logs);
  if (scored.length === 0) return null;
  const recent = scored.slice(-window);
  const avgAbsError =
    recent.reduce((sum, l) => sum + Math.abs(logErrorPct(l)), 0) / recent.length;
  return Math.max(0, Math.round(100 - avgAbsError));
}

/**
 * Signed bias: positive = you guess short (the time-blindness signature).
 * Lateness comes almost entirely from underestimation, so the direction
 * matters more than the magnitude.
 */
export function meanSignedErrorPct(logs: DurationLog[], window = 10): number | null {
  const scored = scorableLogs(logs);
  if (scored.length < 3) return null;
  const recent = scored.slice(-window);
  return Math.round(recent.reduce((s, l) => s + logErrorPct(l), 0) / recent.length);
}

/**
 * What to PLAN with (~p75 of recent actuals): task durations are
 * right-skewed, so planning at the median means ~50% overrun odds per
 * task — the planning fallacy the app exists to fix. The median stays the
 * display/calibration reference; this is the buffer-aware number.
 */
export function planningMinutes(logs: DurationLog[], taskId: string): number | null {
  const mine = logsFor(logs, taskId);
  if (mine.length < MIN_LOGS_FOR_HISTORY) return null;
  const recent = mine
    .slice(-8)
    .map(actualMin)
    .sort((a, b) => a - b);
  const idx = Math.min(recent.length - 1, Math.ceil(0.75 * recent.length) - 1);
  return Math.round(recent[Math.max(0, idx)]);
}

/** Rolling guess-vs-actual pairs for the stats trend, oldest first. */
export function errorTrend(logs: DurationLog[], window = 14): { at: string; errorPct: number }[] {
  return scorableLogs(logs)
    .slice(-window)
    .map((l) => ({
      at: l.at,
      errorPct: logErrorPct(l),
    }));
}
