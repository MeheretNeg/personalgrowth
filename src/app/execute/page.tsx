"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TimeDecay, formatCountdown } from "@/components/time-decay";
import { appendLog, loadSettings, loadTrip, saveTrip } from "@/lib/store";
import { formatTime, minutesUntil } from "@/lib/engine";
import { cueForStep, fireCue } from "@/lib/notify";
import { TimelineStep, Trip } from "@/lib/types";

const EXIT_CHECKLIST = ["Keys", "Wallet", "Phone", "Charger"];

/** The user's blind guess for a step, for calibration logging. */
function guessFor(trip: Trip, step: TimelineStep): number | null {
  if (!step.taskId) return null;
  if (step.taskId.startsWith("drive:")) return trip.transit.driveMinutes ?? null;
  const task = trip.tasks.find((t) => t.taskId === step.taskId);
  return task ? task.guessMinutes : null;
}

export default function Execute() {
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [checked, setChecked] = useState<string[]>([]);
  const [level] = useState(() => (typeof window === "undefined" ? 1 : loadSettings().level));
  const firedCues = useRef<Set<string>>(new Set());

  useEffect(() => {
    const t = loadTrip();
    if (!t || t.phase !== "executing") {
      router.replace("/");
      return;
    }
    setTrip(t);
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [router]);

  const idx = trip?.currentStepIndex ?? 0;
  const done = !trip || idx >= trip.timeline.length;
  const step = done ? null : trip!.timeline[idx];
  const running = !!step?.startedAt;

  const isFinalStaging =
    !!trip &&
    step?.kind === "staging" &&
    trip.timeline.slice(idx + 1).every((s) => s.kind !== "prep");

  // Escalating cues: heads-up → it's time → nags → door-critical.
  useEffect(() => {
    if (!step) return;
    const cue = cueForStep({ step, running, isFinalStaging, now, level });
    if (cue && !firedCues.current.has(cue.key)) {
      firedCues.current.add(cue.key);
      fireCue(cue);
    }
  }, [now, step, running, isFinalStaging, level]);

  if (!trip) return null;

  // Ahead/behind: measured against the locked plan, not vibes.
  const driftMin = step
    ? Math.round(-minutesUntil(running ? step.endsAt : step.startsAt, now))
    : 0;
  const behind = driftMin >= 1;
  const ahead = driftMin <= -1;

  function update(next: Trip) {
    saveTrip(next);
    setTrip(next);
  }

  function start() {
    const timeline = trip!.timeline.map((s, i) =>
      i === idx ? { ...s, startedAt: new Date().toISOString() } : s,
    );
    update({ ...trip!, timeline });
  }

  function finish() {
    const nowIso = new Date().toISOString();
    const current = trip!.timeline[idx];
    const guess = guessFor(trip!, current);
    if (current.startedAt && guess !== null && current.taskId) {
      const actual = Math.max(
        1,
        Math.round((Date.now() - new Date(current.startedAt).getTime()) / 60_000),
      );
      appendLog({ taskId: current.taskId, guessMinutes: guess, actualMinutes: actual, at: nowIso });
    }
    const timeline = trip!.timeline.map((s, i) =>
      i === idx ? { ...s, finishedAt: nowIso } : s,
    );
    update({ ...trip!, timeline, currentStepIndex: idx + 1 });
    setChecked([]);
  }

  function toDebrief() {
    update({ ...trip!, phase: "debrief" });
    router.push("/debrief");
  }

  const secsToStart = step ? minutesUntil(step.startsAt, now) * 60 : 0;
  const overdueStart = step && !running && secsToStart <= 0;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-5 py-8">
      <header className="flex items-baseline justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-accent">Execute</p>
        <p className="text-sm font-medium text-muted-foreground">
          {trip.destination} ·{" "}
          <span className="font-semibold text-primary">
            {formatTime(new Date(new Date(trip.arrivalTime).getTime() - trip.earlyBufferMinutes * 60_000))}
          </span>
        </p>
      </header>

      {!done && step && (
        <>
          {/* Always-visible plan drift — the number the user asked to SEE. */}
          <div
            className={`flex items-center justify-between rounded-full px-4 py-2.5 text-sm font-semibold ${
              behind
                ? "bg-destructive/15 text-destructive"
                : ahead
                  ? "bg-primary/12 text-primary"
                  : "surface-soft text-muted-foreground"
            }`}
            role="status"
            aria-live="polite"
          >
            <span>
              {behind
                ? `${driftMin} min behind plan`
                : ahead
                  ? `${-driftMin} min ahead of plan`
                  : "On plan"}
            </span>
            <span className={`text-xs font-medium ${behind ? "" : "text-muted-foreground"}`}>
              {behind ? "chop chop — make it back" : ahead ? "keep it, don't spend it" : "stay on the block"}
            </span>
          </div>

          <section
            className={`${
              isFinalStaging ? "surface-alert" : "surface-active"
            } flex min-h-[26rem] flex-col justify-between gap-4 p-6`}
          >
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Only this. Now.
              </p>
              <h2 className="mt-1 text-3xl font-bold tracking-tight">{step.label}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatTime(step.startsAt)} → {formatTime(step.endsAt)}
              </p>
            </div>

            {running ? (
              <TimeDecay plannedMinutes={step.plannedMinutes} startedAt={step.startedAt!} now={now} />
            ) : (
              <div className="flex flex-col items-center gap-1 py-6 text-center">
                <p
                  className={`font-mono text-6xl font-bold tabular-nums tracking-tight ${
                    overdueStart ? "text-destructive animate-anchor-pulse" : ""
                  }`}
                >
                  {formatCountdown(secsToStart)}
                </p>
                <p
                  className={`text-[11px] font-semibold uppercase tracking-[0.2em] ${
                    overdueStart ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {overdueStart ? "past start — tap start now" : "until this block starts"}
                </p>
              </div>
            )}

            {isFinalStaging && running && (
              <div className="flex flex-wrap gap-2">
                {EXIT_CHECKLIST.map((item) => (
                  <button
                    key={item}
                    onClick={() =>
                      setChecked((c) =>
                        c.includes(item) ? c.filter((x) => x !== item) : [...c, item],
                      )
                    }
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                      checked.includes(item)
                        ? "bg-foreground text-background"
                        : "surface-soft text-foreground"
                    }`}
                  >
                    {checked.includes(item) ? "✓ " : ""}
                    {item}
                  </button>
                ))}
              </div>
            )}

            {running ? (
              <Button
                size="lg"
                className={`h-16 rounded-2xl text-lg font-bold tracking-tight ${
                  isFinalStaging
                    ? "bg-destructive text-white hover:bg-destructive/90"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
                onClick={finish}
              >
                {isFinalStaging ? "Out the door" : "Done — next"}
              </Button>
            ) : (
              <Button
                size="lg"
                className="h-16 rounded-2xl bg-primary text-lg font-bold tracking-tight text-primary-foreground hover:bg-primary/90"
                onClick={start}
              >
                Start
              </Button>
            )}
          </section>

          {/* Heavy masking: the future exists, but only just. */}
          {trip.timeline.length > idx + 1 && (
            <section className="flex flex-col gap-2 opacity-55 blur-[2px] select-none" aria-hidden>
              {trip.timeline.slice(idx + 1, idx + 4).map((s) => (
                <div key={s.id} className="surface-soft flex justify-between p-3 text-sm">
                  <span>{s.label}</span>
                  <span className="text-muted-foreground">{formatTime(s.startsAt)}</span>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {done && (
        <section className="surface-active flex flex-col gap-4 p-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight">Anchor dropped.</h2>
          <p className="text-sm text-muted-foreground">
            The plan is finished. The only question left is the one that trains
            your clock: when did you actually get there?
          </p>
          <Button
            size="lg"
            className="h-14 rounded-2xl bg-primary font-bold text-primary-foreground hover:bg-primary/90"
            onClick={toDebrief}
          >
            I&apos;ve arrived — debrief
          </Button>
        </section>
      )}
    </main>
  );
}
