import { formatTime, leaveByInfo, minutesUntil } from "./engine";
import { GraduationLevel, TimelineStep, Trip } from "./types";

/**
 * Conversational phrasing without a backend. Cues must work offline and
 * with the app closed, so the copy is generated locally — but varied and
 * human, picked deterministically by a key hash so a given cue always
 * reads the same (stable dedup) while different cues sound different.
 */
function pick(pool: string[], seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return pool[Math.abs(h) % pool.length];
}

/**
 * Notification escalation during EXECUTE. The ladder climbs with lateness:
 * heads-up → it's time → nagging every few minutes → door-critical. Cues
 * fade with graduation level (the app must do less as the clock improves):
 * levels 1–2 get the full ladder, level 3 only the leave-door guard,
 * level 4 nothing at all.
 *
 * Cues route through the service worker's showNotification (required on
 * installed Android PWAs), falling back to the Notification constructor.
 * True screen-off scheduling still needs a push server (Phase 3) — the OS
 * suspends page timers when the app is fully closed.
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
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const options: NotificationOptions = {
    body: cue.body,
    tag: cue.key,
    requireInteraction: cue.urgency === "critical",
  };

  // Installed Android PWAs can only show system notifications through the
  // service worker; `new Notification()` throws there. Prefer the worker,
  // fall back to the constructor (e.g. desktop tab before the SW is ready).
  const viaConstructor = () => {
    try {
      new Notification(cue.title, options);
    } catch {
      /* no path available — vibration + in-page cues still carry it */
    }
  };
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (reg) return reg.showNotification(cue.title, options);
        viaConstructor();
      })
      .catch(viaConstructor);
  } else {
    viaConstructor();
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

/**
 * The leave-by cue: the consequence-framed departure alert. Fires as the
 * door deadline approaches and after it passes, escalating with the actual
 * arrival cost. This is the highest-value nudge for a time-blind user —
 * "leave now or you'll be N late" beats any generic "hurry up".
 */
export function leaveByCue(trip: Trip, level: GraduationLevel, now: Date): Cue | null {
  if (level >= 4) return null;
  const info = leaveByInfo(trip, now);
  if (!info) return null;
  const mins = Math.round(info.minsUntilDoor);
  const doorClock = formatTime(info.doorAt);

  // Heads-up window: 10 and 5 minutes before you must leave.
  if (mins === 10 || mins === 5) {
    return {
      key: `leaveby-heads-${mins}`,
      title: pick(
        [`Out the door in ${mins} min`, `${mins} minutes till you leave`, `Wheels up in ${mins}`],
        `h${mins}`,
      ),
      body: pick(
        [
          `Be walking out by ${doorClock} to keep your whole cushion. Start wrapping up.`,
          `You need to leave at ${doorClock}. ${mins} minutes — begin closing things out.`,
          `Door time is ${doorClock}. Give yourself these ${mins} minutes to land, not to start something new.`,
        ],
        `hb${mins}`,
      ),
      urgency: mins <= 5 ? "warn" : "info",
    };
  }

  // The door moment itself.
  if (mins === 0) {
    return {
      key: "leaveby-now",
      title: pick(["It's time — go", "Leave now", "Out the door"], "n"),
      body: pick(
        [
          "This is your leave time. Keys, wallet, phone — walk.",
          "Right now is on-time. Every minute from here eats your cushion.",
          "Go. You planned for this exact minute — trust it and move.",
        ],
        "nb",
      ),
      urgency: "critical",
    };
  }

  // Past the door — consequence math, escalating each minute.
  if (mins < 0) {
    const late = mins <= -1 ? Math.floor(-info.minsUntilDoor) : 0;
    const nag = Math.floor(late / 1); // every minute past matters here
    if (info.lateIfLeaveNow > 0) {
      return {
        key: `leaveby-late-${nag}`,
        title: pick(["You're going to be late", "Moving into late", "This is the late zone"], "L"),
        body: `Leave this second and you arrive about ${info.lateIfLeaveNow} min late. Every minute you wait adds one. Go now.`,
        urgency: "critical",
      };
    }
    return {
      key: `leaveby-cushion-${nag}`,
      title: pick(["Cushion's shrinking", "Past your leave time", "Move now"], "C"),
      body: `You're ${late} min past leave time — ${info.cushionLeftMin} min of cushion left before you're actually late. Out the door.`,
      urgency: "warn",
    };
  }
  return null;
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
