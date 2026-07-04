import { NextResponse } from "next/server";
import type webpush from "web-push";
import { PushCue, pushEnabled, setSchedule } from "@/lib/push-server";

export const runtime = "nodejs";

const MAX_CUES = 60;

/**
 * The client re-posts its full remaining cue schedule on every trip
 * transition (lock, step start/finish, out the door, debrief, discard) —
 * replace-not-merge keeps the server dumb and the client authoritative.
 * An empty cue list clears the schedule.
 */
export async function POST(req: Request) {
  if (!pushEnabled()) {
    return NextResponse.json({ enabled: false }, { status: 503 });
  }
  let body: { subscription?: webpush.PushSubscription; cues?: PushCue[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const sub = body.subscription;
  const cues = body.cues;
  if (!sub?.endpoint || !Array.isArray(cues)) {
    return NextResponse.json({ error: "subscription and cues required" }, { status: 400 });
  }
  if (
    cues.length > MAX_CUES ||
    cues.some((c) => !c.at || !c.title || !c.tag || isNaN(new Date(c.at).getTime()))
  ) {
    return NextResponse.json({ error: "invalid cues" }, { status: 400 });
  }
  await setSchedule(sub, cues);
  return NextResponse.json({ enabled: true, scheduled: cues.length });
}
