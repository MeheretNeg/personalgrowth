import { GraduationLevel, Trip } from "./types";

/**
 * Client side of Phase 3 push. On every trip transition the remaining
 * schedule-anchored cues are recomputed from the locked timeline and
 * re-posted wholesale to /api/push/sync — so the server never needs to
 * understand the ladder, and cues the user already dealt with disappear.
 *
 * Tags reuse the in-page cue keys, so when the app IS open and both paths
 * fire, the OS collapses them into one notification.
 *
 * Everything no-ops without NEXT_PUBLIC_VAPID_PUBLIC_KEY or push support.
 */

export interface PushCue {
  at: string;
  title: string;
  body: string;
  tag: string;
  requireInteraction?: boolean;
}

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const NAG_EVERY_MIN = 3;
const NAG_RUNGS = 3;

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getSubscription(create: boolean): Promise<PushSubscription | null> {
  if (
    !PUBLIC_KEY ||
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing || !create) return existing;
    return await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUBLIC_KEY),
    });
  } catch {
    return null;
  }
}

/**
 * Schedule-anchored cues for everything still ahead of the user. With the
 * app closed nobody is tapping Start, so the locked schedule is exactly
 * the right anchor. Same level fading as the in-page ladder.
 */
export function buildPushCues(trip: Trip, level: GraduationLevel, now: Date): PushCue[] {
  if (level >= 4 || trip.phase !== "executing") return [];
  const cues: PushCue[] = [];
  const horizon = now.getTime() + 5_000; // never schedule into the past
  const idx = trip.currentStepIndex;

  for (let i = idx; i < trip.timeline.length; i++) {
    const step = trip.timeline[i];
    const isFinal =
      step.kind === "staging" && trip.timeline.slice(i + 1).every((s) => s.kind !== "prep");
    if (level === 3 && !isFinal) continue;

    const add = (atMs: number, cue: Omit<PushCue, "at">) => {
      if (atMs > horizon) cues.push({ at: new Date(atMs).toISOString(), ...cue });
    };

    if (i === idx && step.startedAt) {
      // Block is running: overtime rungs from the ACTUAL start, matching
      // the in-page ladder and the decay bar.
      const end = new Date(step.startedAt).getTime() + step.plannedMinutes * 60_000;
      for (let n = 0; n < NAG_RUNGS; n++) {
        const over = n * NAG_EVERY_MIN;
        add(end + over * 60_000, {
          title: isFinal
            ? "OUT THE DOOR"
            : n === 0
              ? `Time's up: ${step.label}`
              : `${over} min over: ${step.label}`,
          body: isFinal
            ? n === 0
              ? "Leave time. Keys, wallet, phone — go."
              : `${over} min past leave time. Every minute is a late minute now.`
            : n === 0
              ? "Wrap it up and move."
              : "This is where the day slips. Cut it off.",
          tag: `overtime-${step.id}-${n}`,
          requireInteraction: isFinal || n >= 1,
        });
      }
      continue;
    }

    const startMs = new Date(step.startsAt).getTime();
    add(startMs - 2 * 60_000, {
      title: `Up next: ${step.label}`,
      body: "Starts in 2 min. Land this block first.",
      tag: `headsup-${step.id}`,
    });
    for (let n = 0; n < NAG_RUNGS; n++) {
      const late = n * NAG_EVERY_MIN;
      add(startMs + late * 60_000, {
        title: isFinal ? "Be at the door — now" : `It's time: ${step.label}`,
        body:
          n === 0
            ? "This block starts now. Tap start."
            : `You're ${late} min behind on starting this. Chop chop.`,
        tag: `missed-${step.id}-${n}`,
        requireInteraction: isFinal || n >= 2,
      });
    }
  }
  return cues;
}

async function post(subscription: PushSubscription, cues: PushCue[]): Promise<void> {
  try {
    await fetch("/api/push/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON(), cues }),
    });
  } catch {
    /* offline or push disabled — in-page cues still run */
  }
}

/** Re-sync the remaining schedule; call on every trip transition. */
export async function syncPushSchedule(trip: Trip, level: GraduationLevel): Promise<void> {
  const sub = await getSubscription(true);
  if (!sub) return;
  await post(sub, buildPushCues(trip, level, new Date()));
}

/** Drop everything scheduled (arrived, debriefed, or plan discarded). */
export async function clearPushSchedule(): Promise<void> {
  const sub = await getSubscription(false);
  if (!sub) return;
  await post(sub, []);
}
