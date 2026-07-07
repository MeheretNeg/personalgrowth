import {
  MIN_LOGS_FOR_HISTORY,
  calibrationScore,
  meanSignedErrorPct,
  personalMedian,
  planningMinutes,
} from "./calibration";
import { buildTimeline, timeOnSameDay } from "./engine";
import { LEVELS, levelProgress, onTimeRate, onTimeStreak } from "./graduation";
import { TASK_PRIORS, getPrior } from "./priors";
import {
  loadDebriefs,
  loadLogs,
  loadSettings,
  loadTrip,
  saveLastTaskIds,
  saveTrip,
} from "./store";
import { PlannedTask, TransitDetails, Trip } from "./types";

/**
 * Client side of Anchor Coach. Two jobs:
 * 1. Snapshot EVERYTHING the app has measured into an <app_state> block —
 *    the wiring that makes the coach speak from the user's real record.
 * 2. Turn a propose_plan tool call back into a real locked Trip through
 *    the same backward-planning engine the wizard uses.
 */

export function buildAppState(): string {
  const logs = loadLogs();
  const debriefs = loadDebriefs();
  const settings = loadSettings();
  const level = settings.level;
  const now = new Date();

  const taskKnowledge = [...new Set(logs.map((l) => l.taskId))].map((id) => {
    const mine = logs.filter((l) => l.taskId === id);
    return {
      taskId: id,
      measurements: mine.length,
      medianMinutes: personalMedian(logs, id),
      planAtMinutes: planningMinutes(logs, id),
    };
  });

  const state = {
    localTime: now.toString(),
    clockScore: calibrationScore(logs),
    guessBiasPct: meanSignedErrorPct(logs),
    guessedReps: logs.filter((l) => l.guessMinutes > 0).length,
    totalMeasurements: logs.length,
    onTimeStreak: onTimeStreak(debriefs),
    onTimeRate: onTimeRate(debriefs),
    level: { number: level, name: LEVELS[level].name, means: LEVELS[level].means },
    nextLevel: levelProgress(logs, debriefs, level),
    planMode: settings.planMode ?? "train",
    earlyBufferMinutes: settings.earlyBufferMinutes,
    whatAnchorMeasured: taskKnowledge,
    availableTaskIds: TASK_PRIORS.map((t) => ({ id: t.id, label: t.label, typicalP75: t.p75 })),
    recentArrivals: debriefs.slice(-12).map((d) => ({
      when: d.at,
      destination: d.destination,
      deltaMinutes: d.deltaMinutes,
      causes: d.causes,
      note: d.note,
      solo: d.solo ?? false,
    })),
    activeTrip: (() => {
      const t = loadTrip();
      return t && t.phase !== "done"
        ? { destination: t.destination, phase: t.phase, arrivalTime: t.arrivalTime }
        : null;
    })(),
  };
  return `<app_state>\n${JSON.stringify(state, null, 1)}\n</app_state>`;
}

export interface CoachPlan {
  destination: string;
  arrivalTime: string;
  mode: "driving" | "walking" | "transit" | "pickup" | "pickingUp";
  travelMinutes?: number;
  transitDeparture?: string;
  pickupTime?: string;
  tasks: { label: string; minutes?: number }[];
}

const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-");

function matchTaskId(label: string): string {
  const norm = label.trim().toLowerCase();
  const hit = TASK_PRIORS.find(
    (t) => t.label.toLowerCase() === norm || t.id === slug(label),
  );
  return hit?.id ?? "other";
}

/** Validate + convert a propose_plan payload into a locked Trip. */
export function coachPlanToTrip(plan: CoachPlan): { trip?: Trip; error?: string } {
  if (!plan?.destination?.trim() || !/^\d{1,2}:\d{2}$/.test(plan.arrivalTime ?? "")) {
    return { error: "The plan was missing a destination or time." };
  }
  const modes = ["driving", "walking", "transit", "pickup", "pickingUp"] as const;
  if (!modes.includes(plan.mode)) return { error: "Unknown travel mode." };

  const now = new Date();
  const arrival = timeOnSameDay(plan.arrivalTime, now);
  if (arrival.getTime() < now.getTime()) arrival.setDate(arrival.getDate() + 1);

  const logs = loadLogs();
  const settings = loadSettings();

  const tasks: PlannedTask[] = (plan.tasks ?? []).slice(0, 12).map((t) => {
    const taskId = matchTaskId(t.label);
    const planned =
      t.minutes && t.minutes > 0
        ? Math.round(t.minutes)
        : (planningMinutes(logs, taskId) ?? getPrior(taskId)!.p75);
    const fromHistory =
      logs.filter((l) => l.taskId === taskId).length >= MIN_LOGS_FOR_HISTORY;
    return {
      taskId,
      label: getPrior(taskId)?.id === "other" ? t.label : getPrior(taskId)!.label,
      guessMinutes: 0, // coach-planned = quick-plan semantics; not a scored rep
      plannedMinutes: planned,
      source: t.minutes ? "guess" : fromHistory ? "history" : "prior",
    };
  });
  if (tasks.length === 0) return { error: "The plan had no prep tasks." };

  const travel = Math.round(plan.travelMinutes ?? 0);
  let transit: TransitDetails;
  if (plan.mode === "driving" || plan.mode === "pickingUp") {
    if (travel <= 0) return { error: "The plan was missing the drive time." };
    transit = { mode: plan.mode, driveMinutes: travel, driveGuessMinutes: 0 };
  } else if (plan.mode === "walking") {
    if (travel <= 0) return { error: "The plan was missing the walk time." };
    transit = { mode: "walking", walkMinutes: travel, walkGuessMinutes: 0 };
  } else if (plan.mode === "transit") {
    if (!/^\d{1,2}:\d{2}$/.test(plan.transitDeparture ?? ""))
      return { error: "The plan was missing the departure time." };
    transit = {
      mode: "transit",
      transitDepartureTime: plan.transitDeparture,
      walkToStopMinutes: 10,
      rideMinutes: travel > 0 ? travel : undefined,
    };
  } else {
    if (!/^\d{1,2}:\d{2}$/.test(plan.pickupTime ?? ""))
      return { error: "The plan was missing the pickup time." };
    transit = { mode: "pickup", pickupTime: plan.pickupTime, driveMinutes: travel || undefined };
  }

  const timeline = buildTimeline({
    arrival,
    earlyBufferMinutes: settings.earlyBufferMinutes,
    transit,
    tasks,
  });
  const steps = timeline.steps.map((s) =>
    s.taskId === "drive" || s.taskId === "walk"
      ? { ...s, taskId: `${s.taskId}:${slug(plan.destination)}` }
      : s,
  );

  const trip: Trip = {
    id: `trip-${arrival.getTime()}`,
    destination: plan.destination.trim(),
    arrivalTime: arrival.toISOString(),
    earlyBufferMinutes: settings.earlyBufferMinutes,
    transit,
    tasks,
    phase: "locked",
    timeline: steps,
    currentStepIndex: 0,
    lockedAt: new Date().toISOString(),
  };
  saveTrip(trip);
  saveLastTaskIds(tasks.map((t) => t.taskId));
  return { trip };
}

export async function askCoach(
  messages: { role: "user" | "assistant"; content: string }[],
): Promise<{ reply?: string; plan?: CoachPlan | null; error?: string }> {
  try {
    const res = await fetch("/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error ?? "Coach is unavailable right now." };
    return data;
  } catch {
    return { error: "Coach is unreachable — check your connection." };
  }
}

export async function coachEnabled(): Promise<boolean> {
  try {
    const res = await fetch("/api/coach");
    const data = await res.json();
    return !!data.enabled;
  } catch {
    return false;
  }
}
