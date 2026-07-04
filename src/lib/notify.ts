import { minutesUntil } from "./engine";
import { GraduationLevel, TimelineStep } from "./types";

/**
 * Notification escalation during EXECUTE. The ladder climbs with lateness:
 * heads-up → it's time → nagging every few minutes → door-critical. Cues
 * fade with graduation level (the app must do less as the clock improves):
 * levels 1–2 get the full ladder, level 3 only the leave-door guard,
 * level 4 nothing at all.
 *
 * No service worker yet (Phase 3), so system notifications fire only while
 * the app is open; vibration + the in-page countdown carry the rest.
 */

export type CueUrgency = "info" | "warn" | "critical";

export interface Cue {
  /** Dedupe key — each key fires at most once per execution. */
  key: string;
  title: string;
  body: string;
  urgency: CueUrgency;
}

const VIBRATION: Record<CueUrgency, number[]> = {
  info: [80],
  warn: [150, 80, 150],
  critical: [250, 100, 250, 100, 500],
};

export async function requestNotifyPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export function fireCue(cue: Cue): void {
  if (typeof window === "undefined") return;
  try {
    navigator.vibrate?.(VIBRATION[cue.urgency]);
  } catch {
    /* vibration is best-effort */
  }
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(cue.title, {
        body: cue.body,
        tag: cue.key,
        requireInteraction: cue.urgency === "critical",
      });
    } catch {
      /* some platforms require a service worker — in-page cues still show */
    }
  }
}

const NAG_EVERY_MIN = 3;

export interface CueInput {
  step: TimelineStep;
  running: boolean;
  /** True for the last staged-at-the-door step — the leave-door guard. */
  isFinalStaging: boolean;
  now: Date;
  level: GraduationLevel;
}

/** The single cue due right now, or null. Pure — callers dedupe by key. */
export function cueForStep({ step, running, isFinalStaging, now, level }: CueInput): Cue | null {
  if (level >= 4) return null;
  if (level === 3 && !isFinalStaging) return null;

  if (!running) {
    const until = minutesUntil(step.startsAt, now);
    if (until > 0 && until <= 2) {
      return {
        key: `headsup-${step.id}`,
        title: `Up next: ${step.label}`,
        body: `Starts in ${Math.ceil(until)} min. Land this block first.`,
        urgency: "info",
      };
    }
    if (until <= 0) {
      const lateBy = Math.floor(-until);
      const nag = Math.floor(lateBy / NAG_EVERY_MIN);
      const critical = isFinalStaging || nag >= 2;
      return {
        key: `missed-${step.id}-${nag}`,
        title: isFinalStaging ? "Be at the door — now" : `It's time: ${step.label}`,
        body:
          lateBy < 1
            ? "This block starts now. Tap start."
            : `You're ${lateBy} min behind on starting this. Chop chop.`,
        urgency: critical ? "critical" : "warn",
      };
    }
    return null;
  }

  // Overtime is measured from when the block actually started, matching the
  // decay bar — an early starter who runs long still gets the wrap-it-up nag.
  const plannedEnd = step.startedAt
    ? new Date(new Date(step.startedAt).getTime() + step.plannedMinutes * 60_000).toISOString()
    : step.endsAt;
  const over = -minutesUntil(plannedEnd, now);
  if (over >= 0) {
    const nag = Math.floor(over / NAG_EVERY_MIN);
    if (isFinalStaging) {
      return {
        key: `overtime-${step.id}-${nag}`,
        title: "OUT THE DOOR",
        body:
          over < 1
            ? "Leave time. Keys, wallet, phone — go."
            : `${Math.floor(over)} min past leave time. Every minute is a late minute now.`,
        urgency: "critical",
      };
    }
    return {
      key: `overtime-${step.id}-${nag}`,
      title: nag === 0 ? `Time's up: ${step.label}` : `${Math.floor(over)} min over: ${step.label}`,
      body: nag === 0 ? "Wrap it up and move." : "This is where the day slips. Cut it off.",
      urgency: nag >= 1 ? "critical" : "warn",
    };
  }
  return null;
}
