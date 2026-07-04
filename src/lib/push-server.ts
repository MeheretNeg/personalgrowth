import webpush from "web-push";
import { promises as fs } from "fs";
import path from "path";

/**
 * Server side of Phase 3 push: cues that fire with the app fully closed.
 * The client posts its subscription plus a schedule-anchored cue list on
 * every trip transition; a 30s loop sends whatever has come due. State is
 * a JSON file under .data/ so restarts don't drop an active timeline —
 * this needs a persistent `next start` host (on serverless the loop only
 * runs while an instance is warm; in-page cues still cover the app-open
 * case there).
 *
 * Enabled only when VAPID keys are set (see .env.example); everything
 * no-ops cleanly without them.
 */

export interface PushCue {
  at: string; // ISO — when to send
  title: string;
  body: string;
  /** Same tag namespace as the in-page cues, so the OS collapses dupes. */
  tag: string;
  requireInteraction?: boolean;
}

interface Entry {
  subscription: webpush.PushSubscription;
  cues: PushCue[];
}

interface PushState {
  entries: Map<string, Entry>;
  timer: ReturnType<typeof setInterval> | null;
  ready: boolean;
}

const DATA_FILE = path.join(process.cwd(), ".data", "push.json");
const TICK_MS = Number(process.env.PUSH_TICK_MS) || 30_000;

// Survives route-module reloads in dev and multiple importers in prod.
const g = globalThis as unknown as { __anchorPush?: PushState };

function state(): PushState {
  g.__anchorPush ??= { entries: new Map(), timer: null, ready: false };
  return g.__anchorPush;
}

export function pushEnabled(): boolean {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

async function persist(): Promise<void> {
  const s = state();
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify([...s.entries.values()]), "utf8");
}

async function load(): Promise<void> {
  const s = state();
  try {
    const entries: Entry[] = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    for (const e of entries) s.entries.set(e.subscription.endpoint, e);
  } catch {
    /* first boot — nothing scheduled */
  }
}

async function tick(): Promise<void> {
  const s = state();
  const now = Date.now();
  let dirty = false;
  for (const [endpoint, entry] of [...s.entries]) {
    const due = entry.cues.filter((c) => new Date(c.at).getTime() <= now);
    if (due.length === 0) continue;
    dirty = true;
    entry.cues = entry.cues.filter((c) => new Date(c.at).getTime() > now);
    for (const cue of due) {
      try {
        await webpush.sendNotification(entry.subscription, JSON.stringify(cue), {
          TTL: 180,
          urgency: "high",
        });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Subscription expired or revoked — drop it entirely.
          s.entries.delete(endpoint);
          break;
        }
        // Transient send failure: the cue is spent either way, but leave a trace.
        console.warn("[push] send failed", status ?? (err as Error).message);
      }
    }
    if (s.entries.has(endpoint) && entry.cues.length === 0) s.entries.delete(endpoint);
  }
  if (dirty) await persist();
}

/** Idempotent boot: configure VAPID, reload state, start the send loop. */
export async function ensurePushLoop(): Promise<void> {
  if (!pushEnabled()) return;
  const s = state();
  if (!s.ready) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:anchor@localhost",
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    await load();
    s.ready = true;
  }
  if (!s.timer) {
    s.timer = setInterval(() => void tick(), TICK_MS);
    s.timer.unref?.();
  }
}

/** Replace (or clear, with cues=[]) the schedule for one subscription. */
export async function setSchedule(
  subscription: webpush.PushSubscription,
  cues: PushCue[],
): Promise<void> {
  await ensurePushLoop();
  const s = state();
  if (cues.length === 0) s.entries.delete(subscription.endpoint);
  else s.entries.set(subscription.endpoint, { subscription, cues });
  await persist();
}
