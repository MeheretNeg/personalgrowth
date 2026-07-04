"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { clearTrip, loadSettings, loadTrip, saveTrip } from "@/lib/store";
import { formatTime, minutesUntil } from "@/lib/engine";
import { requestNotifyPermission } from "@/lib/notify";
import { clearPushSchedule, syncPushSchedule } from "@/lib/push-client";
import { formatCountdown } from "@/components/time-decay";
import { Trip } from "@/lib/types";

const VISUALIZE_SECONDS = 20;

/**
 * LOCK = commitment device. Two evidence-based moves happen here:
 * 1. The if-then chain (implementation intentions, Gollwitzer: d≈0.65) —
 *    the user reads each cue→action pair once out loud.
 * 2. A 20-second episodic-future-thinking visualization — with the timer
 *    ENFORCED, because a commitment ritual you can skip in 2 seconds
 *    doesn't deliver its dose.
 * A locked trip can also stay ARMED: plan tonight, and Anchor calls you
 * when the first block starts tomorrow (intentions formed calmly in
 * advance are exactly the ones that work).
 */
export default function Lock() {
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [visualizeUntil, setVisualizeUntil] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [level] = useState(() => (typeof window === "undefined" ? 1 : loadSettings().level));

  useEffect(() => {
    const t = loadTrip();
    if (!t || t.phase !== "locked") {
      router.replace("/");
      return;
    }
    setTrip(t);
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [router]);

  if (!trip) return null;

  const startAt = new Date(trip.timeline[0].startsAt);
  const minsToStart = minutesUntil(trip.timeline[0].startsAt, now);
  const canArm = minsToStart > 20;
  // Derived from the ticking clock (deadline, not chained timeouts) so
  // throttled tabs can't stall the enforced dose.
  const secondsLeft =
    visualizeUntil === null ? null : Math.ceil((visualizeUntil - now.getTime()) / 1000);
  const visualized = secondsLeft !== null && secondsLeft <= 0;

  function begin() {
    // Ask inside the tap (user gesture) — escalating cues need it. Denied
    // permission is fine: vibration + the in-page countdown still carry it.
    const next: Trip = { ...trip!, phase: "executing" };
    void requestNotifyPermission().then(() => syncPushSchedule(next, level));
    saveTrip(next);
    router.push("/execute");
  }

  function arm() {
    // Stay locked; the schedule-anchored cues (starting with "It's time:
    // <first task>") become the wake-up call.
    void requestNotifyPermission().then(() => syncPushSchedule(trip!, level));
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
            {formatCountdown(minsToStart * 60)}
          </p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            until Anchor calls you
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            You can close the app. The plan is set — that was the hard part,
            and you did it early.
          </p>
        </section>
        <Button
          size="lg"
          className="h-14 rounded-2xl bg-primary font-bold text-primary-foreground hover:bg-primary/90"
          onClick={begin}
        >
          Start now instead
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
      </section>

      {!visualized ? (
        <section className="surface p-5">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
            20 seconds — future you
          </p>
          <p className="mt-2 text-sm leading-6">
            Close your eyes and picture it concretely: you walk into{" "}
            <b>{trip.destination}</b> at{" "}
            <b>{formatTime(new Date(new Date(trip.arrivalTime).getTime() - trip.earlyBufferMinutes * 60_000))}</b>,
            ten minutes to spare. Where are you standing? What do you do with
            the extra time? How does it feel to be the early one?
          </p>
          {secondsLeft === null ? (
            <Button
              className="mt-4 w-full rounded-full font-semibold"
              onClick={() => setVisualizeUntil(Date.now() + VISUALIZE_SECONDS * 1000)}
            >
              Start the 20 seconds
            </Button>
          ) : (
            <Button className="mt-4 w-full rounded-full font-semibold" disabled>
              Keep seeing it… {secondsLeft}s
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
                ? "Begin now, or arm it and Anchor pings you when the first block starts."
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
