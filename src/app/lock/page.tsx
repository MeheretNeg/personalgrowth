"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { clearTrip, loadDebriefs, loadSettings, loadTrip, saveTrip } from "@/lib/store";
import { formatTime, minutesUntil } from "@/lib/engine";
import { requestNotifyPermission } from "@/lib/notify";
import { clearPushSchedule, syncPushSchedule } from "@/lib/push-client";
import { formatCountdown } from "@/components/time-decay";
import { Trip } from "@/lib/types";

/** Recurring debrief causes get a tailored countermeasure in the chain. */
const COUNTERMEASURES: Record<string, string> = {
  "Underestimated a task": "I set the timer before starting, not after.",
  "Started getting ready late": "I start at the first alert, not when it feels urgent.",
  "Got distracted mid-task": "I put the phone face-down until this block is done.",
  "Couldn't find something": "I stage keys, wallet and bag at the door tonight.",
  "Traffic / transit": "I take the earlier option, not the exact-fit one.",
  "Left the door late": "When the door alert fires, I walk out mid-task if I must.",
};

/**
 * LOCK = commitment device. Three evidence-based moves happen here:
 * 1. The if-then chain (implementation intentions, Gollwitzer: d≈0.65) —
 *    now personalized: a recurring debrief cause injects a countermeasure.
 * 2. Mental contrasting (Oettingen): 10s vivid future + 10s naming the
 *    obstacle — positive fantasy alone measurably HURTS goal attainment.
 *    The dose is enforced, but collapses to 5s when already behind.
 * 3. Optional ARM: plan calmly tonight, Anchor wakes you tomorrow — but it
 *    only ever promises that when a push path verifiably exists.
 */
export default function Lock() {
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [visualizeUntil, setVisualizeUntil] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const [pushOk, setPushOk] = useState<boolean | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [level] = useState(() => (typeof window === "undefined" ? 1 : loadSettings().level));
  const [topLeak] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const late = loadDebriefs().filter((d) => d.deltaMinutes > 0).slice(-5);
    const counts = new Map<string, number>();
    for (const d of late) for (const c of d.causes) counts.set(c, (counts.get(c) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return top && top[1] >= 2 && COUNTERMEASURES[top[0]] ? top[0] : null;
  });

  useEffect(() => {
    const t = loadTrip();
    if (!t || t.phase !== "locked") {
      router.replace("/");
      return;
    }
    setTrip(t);
    // Reopening an armed plan lands back in the waiting room, and a
    // completed ritual is never re-enforced.
    if (t.armedAt) setArmed(true);
    if (t.visualizedAt) setVisualizeUntil(0);
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [router]);

  const startAtIso = trip?.timeline[0]?.startsAt;
  const behindAtLock = startAtIso ? minutesUntil(startAtIso, now) < 0 : false;
  const doseSeconds = behindAtLock ? 5 : 20;
  const secondsLeft =
    visualizeUntil === null
      ? null
      : Math.max(0, Math.ceil((visualizeUntil - now.getTime()) / 1000));
  const visualized = secondsLeft !== null && secondsLeft <= 0;

  // Persist ritual completion + a small completion buzz, once.
  useEffect(() => {
    if (!visualized || !trip || trip.visualizedAt) return;
    try {
      navigator.vibrate?.([60]);
    } catch {
      /* best-effort */
    }
    const next = { ...trip, visualizedAt: new Date().toISOString() };
    saveTrip(next);
    setTrip(next);
  }, [visualized, trip]);

  if (!trip) return null;

  const startAt = new Date(trip.timeline[0].startsAt);
  const minsToStart = minutesUntil(trip.timeline[0].startsAt, now);
  const canArm = minsToStart > 20;
  const startDue = minsToStart <= 1;

  function begin() {
    const next: Trip = { ...trip!, phase: "executing" };
    // "Begin" when the first block is due means starting NOW — auto-start
    // it so a missed Start tap can't under-count the first task.
    if (startDue && next.currentStepIndex === 0 && !next.timeline[0].startedAt) {
      next.timeline = next.timeline.map((s, i) =>
        i === 0 ? { ...s, startedAt: new Date().toISOString() } : s,
      );
    }
    void requestNotifyPermission().then(() => syncPushSchedule(next, level));
    saveTrip(next);
    router.push("/execute");
  }

  async function arm() {
    const granted = await requestNotifyPermission();
    const ok = granted && (await syncPushSchedule(trip!, level));
    setPushOk(ok);
    const next = { ...trip!, armedAt: new Date().toISOString() };
    saveTrip(next);
    setTrip(next);
    setArmed(true);
  }

  function discard() {
    clearTrip();
    void clearPushSchedule();
    router.push("/");
  }

  if (armed) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-5 py-8 text-center">
        <section className="surface-active p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Armed
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {trip.destination} — first block {formatTime(startAt)}
          </h1>
          <p className="mt-3 font-mono text-5xl font-bold tabular-nums">
            {minsToStart > 2880
              ? `${Math.floor(minsToStart / 1440)}d ${Math.floor((minsToStart % 1440) / 60)}h`
              : minsToStart * 60 > 5940
                ? `${Math.floor(minsToStart / 60)}h ${Math.floor(minsToStart % 60)}m`
                : formatCountdown(Math.max(0, minsToStart * 60))}
          </p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {startDue ? "it's time" : "until the first block"}
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            {pushOk === false
              ? `Heads up: notifications aren't available here, so Anchor can't call you with the app closed. Keep this screen open, or set a phone alarm for ${formatTime(startAt)}.`
              : "You can close the app — Anchor will call you. The plan is set; that was the hard part, and you did it early."}
          </p>
        </section>
        <Button
          size="lg"
          className={`h-14 rounded-2xl font-bold ${
            startDue
              ? "bg-primary text-primary-foreground hover:bg-primary/90 animate-anchor-pulse"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          }`}
          onClick={begin}
        >
          {startDue ? "It's time — begin" : "Start now instead"}
        </Button>
        <button onClick={discard} className="text-xs text-muted-foreground underline">
          Discard this plan
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-8">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-accent">Lock</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          {trip.destination}, {formatTime(new Date(new Date(trip.arrivalTime).getTime() - trip.earlyBufferMinutes * 60_000))}
          <span className="block text-sm font-medium text-muted-foreground">
            ({trip.earlyBufferMinutes} min before the real {formatTime(trip.arrivalTime)})
          </span>
        </h1>
      </header>

      <section className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Read each line. Mean it.
        </p>
        {trip.timeline.map((s) => (
          <p key={s.id} className="surface-soft p-3.5 text-sm">
            {s.ifThen}
          </p>
        ))}
        {topLeak && (
          <p className="surface-active p-3.5 text-sm">
            Your #1 leak lately: <b>{topLeak.toLowerCase()}</b>. So — when it
            threatens today, then {COUNTERMEASURES[topLeak].toLowerCase()}
          </p>
        )}
      </section>

      {!visualized ? (
        <section className="surface p-5">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
            {behindAtLock ? "5 seconds — one breath" : "20 seconds — future you"}
          </p>
          <p className="mt-2 text-sm leading-6" aria-live="polite">
            {behindAtLock ? (
              <>One breath. The clock is already running — see yourself walking
              in at <b>{formatTime(new Date(new Date(trip.arrivalTime).getTime() - trip.earlyBufferMinutes * 60_000))}</b> anyway, then move.</>
            ) : secondsLeft !== null && secondsLeft <= doseSeconds / 2 ? (
              <>Now the other half: name the ONE thing that usually makes you
              late today. See it happening — and see yourself handling it the
              way the lines above say.</>
            ) : (
              <>Close your eyes and picture it concretely: you walk into{" "}
              <b>{trip.destination}</b> at{" "}
              <b>{formatTime(new Date(new Date(trip.arrivalTime).getTime() - trip.earlyBufferMinutes * 60_000))}</b>,
              ten minutes to spare. Where are you standing? What do you do with
              the extra time?</>
            )}
          </p>
          {secondsLeft === null ? (
            <Button
              className="mt-4 w-full rounded-full font-semibold"
              onClick={() => setVisualizeUntil(Date.now() + doseSeconds * 1000)}
            >
              Start the {doseSeconds} seconds
            </Button>
          ) : (
            <Button className="mt-4 w-full rounded-full font-semibold" disabled>
              <span aria-hidden>Keep seeing it… {secondsLeft}s</span>
              <span className="sr-only" role="status">
                {secondsLeft} seconds remaining
              </span>
            </Button>
          )}
        </section>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            className="h-16 rounded-2xl bg-primary text-lg font-bold tracking-tight text-primary-foreground hover:bg-primary/90"
            onClick={begin}
          >
            Timeline locked — begin
          </Button>
          {canArm && (
            <Button
              variant="secondary"
              size="lg"
              className="h-12 rounded-2xl font-semibold"
              onClick={arm}
            >
              Arm it — wake me at {formatTime(startAt)}
            </Button>
          )}
          <p className="text-center text-xs text-muted-foreground">
            {level >= 3
              ? "Solo level: Anchor stays silent and only guards the door."
              : canArm
                ? "Begin now, or arm it and pick this up when the first block starts."
                : "Anchor will ping you as each block starts — and escalate if you run over."}
          </p>
        </div>
      )}

      <button onClick={discard} className="text-center text-xs text-muted-foreground underline">
        Discard this plan
      </button>
    </main>
  );
}
