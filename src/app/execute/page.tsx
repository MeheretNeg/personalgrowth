"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TimeDecay } from "@/components/time-decay";
import { appendLog, loadTrip, saveTrip } from "@/lib/store";
import { formatTime, minutesUntil } from "@/lib/engine";
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

  if (!trip) return null;

  const idx = trip.currentStepIndex;
  const done = idx >= trip.timeline.length;
  const step = done ? null : trip.timeline[idx];
  const running = !!step?.startedAt;

  // Ahead/behind: measured against the locked plan, not vibes.
  const driftMin = step
    ? Math.round(-minutesUntil(running ? step.endsAt : step.startsAt, now))
    : 0;

  const isFinalStaging =
    step?.kind === "staging" &&
    trip.timeline.slice(idx + 1).every((s) => s.kind !== "prep");

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

  const overdue = step && !running && minutesUntil(step.startsAt, now) <= 0;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 py-8">
      <header className="flex items-baseline justify-between">
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-accent">Execute</p>
        <p className="text-sm font-bold">
          {trip.destination} ·{" "}
          <span className="text-primary">
            {formatTime(new Date(new Date(trip.arrivalTime).getTime() - trip.earlyBufferMinutes * 60_000))}
          </span>
        </p>
      </header>

      {!done && step && (
        <>
          {Math.abs(driftMin) >= 2 && (
            <p
              className={`p-2 text-center text-sm font-black uppercase tracking-wide ${
                driftMin > 0 ? "brutal-alert text-destructive" : "glass text-primary"
              }`}
            >
              {driftMin > 0 ? `${driftMin} min behind plan` : `${-driftMin} min ahead — keep it`}
            </p>
          )}

          <section
            className={`${
              isFinalStaging ? "brutal-alert" : "brutal-primary"
            } flex min-h-[24rem] flex-col justify-between gap-4 bg-card p-6`}
          >
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Only this. Now.
              </p>
              <h2 className="mt-1 text-3xl font-black tracking-tight">{step.label}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatTime(step.startsAt)} → {formatTime(step.endsAt)}
              </p>
            </div>

            {running ? (
              <TimeDecay plannedMinutes={step.plannedMinutes} startedAt={step.startedAt!} now={now} />
            ) : (
              <p className={`text-center text-lg font-bold ${overdue ? "text-destructive animate-anchor-pulse" : ""}`}>
                {overdue
                  ? "It's time. Tap start."
                  : `Starts in ${Math.ceil(minutesUntil(step.startsAt, now))} min`}
              </p>
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
                    className={`px-4 py-2 text-sm font-black uppercase ${
                      checked.includes(item)
                        ? "brutal bg-foreground text-background"
                        : "glass text-foreground"
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
                className={`h-16 text-lg font-black uppercase tracking-wide ${
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
                className="h-16 bg-primary text-lg font-black uppercase tracking-wide text-primary-foreground hover:bg-primary/90"
                onClick={start}
              >
                Start
              </Button>
            )}
          </section>

          {/* Heavy masking: the future exists, but only just. */}
          {trip.timeline.length > idx + 1 && (
            <section className="flex flex-col gap-2 opacity-60 blur-[2.5px] select-none" aria-hidden>
              {trip.timeline.slice(idx + 1, idx + 4).map((s) => (
                <div key={s.id} className="glass flex justify-between p-3 text-sm">
                  <span>{s.label}</span>
                  <span>{formatTime(s.startsAt)}</span>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {done && (
        <section className="brutal-primary flex flex-col gap-4 bg-card p-6 text-center">
          <h2 className="text-2xl font-black">Anchor dropped.</h2>
          <p className="text-sm text-muted-foreground">
            The plan is finished. The only question left is the one that trains
            your clock: when did you actually get there?
          </p>
          <Button
            size="lg"
            className="h-14 bg-primary font-black uppercase text-primary-foreground hover:bg-primary/90"
            onClick={toDebrief}
          >
            I&apos;ve arrived — debrief
          </Button>
        </section>
      )}
    </main>
  );
}
