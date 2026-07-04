"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TASK_PRIORS, getPrior } from "@/lib/priors";
import { buildTimeline, formatTime, timeOnSameDay } from "@/lib/engine";
import { loadLogs, loadSettings, saveTrip } from "@/lib/store";
import { personalMedian } from "@/lib/calibration";
import { PlannedTask, TransitDetails, TransitMode, Trip } from "@/lib/types";

const MODES: { id: TransitMode; label: string; hint: string }[] = [
  { id: "driving", label: "Driving", hint: "You drive yourself there" },
  { id: "walking", label: "Walking", hint: "On foot, door to door" },
  { id: "transit", label: "Bus / train", hint: "Anchored to its departure, not your arrival" },
  { id: "pickup", label: "Being picked up", hint: "Ready at the door before they arrive" },
  { id: "pickingUp", label: "Picking someone up", hint: "Curbside on time for them" },
];

interface Selection {
  taskId: string;
  label: string;
  guess: string;
  revealed: boolean;
  planned?: number;
  source?: PlannedTask["source"];
  /** Level 2: guess accepted without the compare card (close to record). */
  autoAccepted?: boolean;
}

const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-");

/** Level 2 only flags guesses >40% off the best reference we have. */
const COACH_FLAG_THRESHOLD = 0.4;

export default function Plan() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [destination, setDestination] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [mode, setMode] = useState<TransitMode | null>(null);
  const [driveGuess, setDriveGuess] = useState("");
  const [walkGuess, setWalkGuess] = useState("");
  const [transitDeparture, setTransitDeparture] = useState("");
  const [walkToStop, setWalkToStop] = useState("10");
  const [pickupTime, setPickupTime] = useState("");
  const [selections, setSelections] = useState<Selection[]>([]);
  const [logs] = useState(() => (typeof window === "undefined" ? [] : loadLogs()));
  const [level] = useState(() => (typeof window === "undefined" ? 1 : loadSettings().level));
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => setNow(new Date()), [step]);

  /** Arrival as a Date — today, or tomorrow if that time already passed. */
  const arrivalDate = useMemo(() => {
    if (!arrivalTime || !now) return null;
    let d = timeOnSameDay(arrivalTime, now);
    if (d.getTime() < now.getTime()) d = new Date(d.getTime() + 24 * 3600_000);
    return d;
  }, [arrivalTime, now]);

  const transit: TransitDetails | null = useMemo(() => {
    if (!mode) return null;
    if (mode === "driving" || mode === "pickingUp")
      return { mode, driveMinutes: Number(driveGuess) || 0 };
    if (mode === "walking") return { mode, walkMinutes: Number(walkGuess) || 0 };
    if (mode === "transit")
      return { mode, transitDepartureTime: transitDeparture, walkToStopMinutes: Number(walkToStop) || 10 };
    return { mode, pickupTime };
  }, [mode, driveGuess, walkGuess, transitDeparture, walkToStop, pickupTime]);

  const plannedTasks: PlannedTask[] = useMemo(
    () =>
      selections
        .filter((s) => s.planned !== undefined)
        .map((s) => ({
          taskId: s.taskId,
          label: s.label,
          guessMinutes: Number(s.guess) || 0,
          plannedMinutes: s.planned!,
          source: s.source!,
        })),
    [selections],
  );

  const timeline = useMemo(() => {
    if (!arrivalDate || !transit || plannedTasks.length === 0) return null;
    const settings = loadSettings();
    return buildTimeline({
      arrival: arrivalDate,
      earlyBufferMinutes: settings.earlyBufferMinutes,
      transit,
      tasks: plannedTasks,
    });
  }, [arrivalDate, transit, plannedTasks]);

  function toggleTask(taskId: string) {
    const existing = selections.find((s) => s.taskId === taskId);
    if (existing) {
      setSelections(selections.filter((s) => s.taskId !== taskId));
    } else {
      const prior = getPrior(taskId)!;
      setSelections([
        ...selections,
        { taskId, label: prior.label, guess: "", revealed: false },
      ]);
    }
  }

  /**
   * FADE by graduation level. L1: always show the compare card (full
   * scaffold). L2: accept the guess silently unless it's far off the best
   * reference — Anchor only flags errors. L3+: the guess IS the plan;
   * measurement stays silent until the debrief.
   */
  function lockGuess(taskId: string) {
    const sel = selections.find((s) => s.taskId === taskId)!;
    const guess = Number(sel.guess);
    if (level >= 3) {
      setSelections(
        selections.map((s) =>
          s.taskId === taskId ? { ...s, planned: guess, source: "guess" as const } : s,
        ),
      );
      return;
    }
    if (level === 2) {
      const med = personalMedian(logs, taskId);
      const ref = med ?? getPrior(taskId)!.p50;
      if (Math.abs(guess - ref) / ref <= COACH_FLAG_THRESHOLD) {
        setSelections(
          selections.map((s) =>
            s.taskId === taskId
              ? { ...s, planned: guess, source: "guess" as const, autoAccepted: true }
              : s,
          ),
        );
        return;
      }
    }
    setSelections(selections.map((s) => (s.taskId === taskId ? { ...s, revealed: true } : s)));
  }

  function choose(taskId: string, planned: number, source: PlannedTask["source"]) {
    setSelections(
      selections.map((s) => (s.taskId === taskId ? { ...s, planned, source } : s)),
    );
  }

  /**
   * Escape hatch for rushed days: fill every un-planned task with the
   * standard time — the international average (population median), or the
   * user's own measured median once Anchor has one. Skipping the guess
   * means skipping the training rep, so these tasks are excluded from
   * calibration logging (no guess, nothing to score).
   */
  function fillWithStandards() {
    setSelections(
      selections.map((s) => {
        if (s.planned !== undefined) return s;
        const med = personalMedian(logs, s.taskId);
        return {
          ...s,
          guess: "",
          planned: med ?? getPrior(s.taskId)!.p50,
          source: med !== null ? ("history" as const) : ("prior" as const),
        };
      }),
    );
  }

  function lock() {
    if (!timeline || !arrivalDate || !transit) return;
    // Scope travel calibration to this destination so "work" and "gym"
    // learn separately.
    const steps = timeline.steps.map((s) =>
      s.taskId === "drive" || s.taskId === "walk"
        ? { ...s, taskId: `${s.taskId}:${slug(destination)}` }
        : s,
    );
    const settings = loadSettings();
    const trip: Trip = {
      id: `trip-${arrivalDate.getTime()}`,
      destination,
      arrivalTime: arrivalDate.toISOString(),
      earlyBufferMinutes: settings.earlyBufferMinutes,
      transit,
      tasks: plannedTasks,
      phase: "locked",
      timeline: steps,
      currentStepIndex: 0,
      lockedAt: new Date().toISOString(),
    };
    saveTrip(trip);
    router.push("/lock");
  }

  const stepValid =
    step === 0
      ? destination.trim() && arrivalTime && mode
      : step === 1
        ? (mode === "driving" || mode === "pickingUp"
            ? Number(driveGuess) > 0
            : mode === "walking"
              ? Number(walkGuess) > 0
              : mode === "transit"
                ? !!transitDeparture
                : !!pickupTime)
        : plannedTasks.length > 0;

  /** Exact deficit when the plan already starts in the past. */
  const behindMin =
    timeline && now && timeline.startAt.getTime() < now.getTime()
      ? Math.ceil((now.getTime() - timeline.startAt.getTime()) / 60_000)
      : 0;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-8">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-accent">
          Plan · step {step + 1} of 4
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          {step === 0 && "Where, when, how?"}
          {step === 1 && "The travel math"}
          {step === 2 && "What has to happen first?"}
          {step === 3 && "Your timeline, backwards"}
        </h1>
      </header>

      {step === 0 && (
        <section className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Destination
            <Input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="e.g. Work, Dentist, Airport"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Must arrive by
            <Input
              type="time"
              value={arrivalTime}
              onChange={(e) => setArrivalTime(e.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Anchor targets {loadSettings().earlyBufferMinutes} minutes before
            this. Early is the new on time.
          </p>
          <div className="grid grid-cols-1 gap-2">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`rounded-2xl p-3.5 text-left transition-all active:scale-[0.98] ${
                  mode === m.id ? "surface-active" : "surface-soft"
                }`}
              >
                <span className={`block font-semibold ${mode === m.id ? "text-primary" : ""}`}>
                  {m.label}
                </span>
                <span className="text-xs text-muted-foreground">{m.hint}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 1 && (mode === "driving" || mode === "pickingUp") && (
        <section className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Honest gut guess: how many minutes is the drive?
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={driveGuess}
              onChange={(e) => setDriveGuess(e.target.value)}
              placeholder="minutes"
            />
          </label>
          {level < 3 &&
            (() => {
              const med = personalMedian(logs, `drive:${slug(destination)}`);
              return med !== null ? (
                <div className="surface-soft p-3.5 text-sm">
                  Your last drives to <b>{destination}</b> actually took about{" "}
                  <b className="text-primary">{med} min</b>.
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2 w-full rounded-full"
                    onClick={() => setDriveGuess(String(med))}
                  >
                    Use {med} min
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Anchor measures the real drive every trip and will correct you
                  once it knows this route.
                </p>
              );
            })()}
          <p className="text-xs text-muted-foreground">
            Parking + walking in ({mode === "driving" ? "10" : "3"} min) and
            getting to the car (3 min) are added automatically — those are the
            minutes time blindness always steals.
          </p>
        </section>
      )}

      {step === 1 && mode === "walking" && (
        <section className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Honest gut guess: how many minutes is the walk?
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={walkGuess}
              onChange={(e) => setWalkGuess(e.target.value)}
              placeholder="minutes"
            />
          </label>
          {level < 3 &&
            (() => {
              const med = personalMedian(logs, `walk:${slug(destination)}`);
              return med !== null ? (
                <div className="surface-soft p-3.5 text-sm">
                  Your last walks to <b>{destination}</b> actually took about{" "}
                  <b className="text-primary">{med} min</b>.
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2 w-full rounded-full"
                    onClick={() => setWalkGuess(String(med))}
                  >
                    Use {med} min
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Anchor measures the real walk every trip and will correct you
                  once it knows this route.
                </p>
              );
            })()}
          <p className="text-xs text-muted-foreground">
            Getting staged at the door (5 min) and lights, crossings, finding
            the entrance (3 min) are added automatically — those are the
            minutes time blindness always steals.
          </p>
        </section>
      )}

      {step === 1 && mode === "transit" && (
        <section className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Your bus/train leaves at
            <Input type="time" value={transitDeparture} onChange={(e) => setTransitDeparture(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Walk to the stop (minutes)
            <Input type="number" inputMode="numeric" min={0} value={walkToStop} onChange={(e) => setWalkToStop(e.target.value)} />
          </label>
          <p className="text-xs text-muted-foreground">
            The timeline anchors to the <b>departure</b> — the vehicle does not
            negotiate. A 3-minute platform buffer is added automatically.
          </p>
        </section>
      )}

      {step === 1 && mode === "pickup" && (
        <section className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            They arrive to pick you up at
            <Input type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} />
          </label>
          <p className="text-xs text-muted-foreground">
            You&apos;ll be fully ready and waiting at the door <b>10 minutes
            before</b> they pull up. Nobody waits on you — that&apos;s the
            contract.
          </p>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {level >= 3
              ? "Solo level: your guess is the plan. Anchor measures silently and tells you the truth at the debrief."
              : level === 2
                ? "Coach level: your guess is the plan unless it's far off your record — then Anchor steps in."
                : "Pick what you still need to do, then guess each duration from your gut before seeing what it typically takes. That guess is the rep — this is the gym."}
          </p>
          <div className="flex flex-wrap gap-2">
            {TASK_PRIORS.map((t) => {
              const sel = selections.find((s) => s.taskId === t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => toggleTask(t.id)}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                    sel ? "bg-primary text-primary-foreground" : "surface-soft"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          {selections.some((s) => s.planned === undefined) && (
            <div className="surface-soft flex items-center justify-between gap-3 p-3">
              <p className="text-xs text-muted-foreground">
                Rushed? Skip the guessing reps — plan the rest with standard
                times: the international average, or your own medians once
                Anchor has measured you.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0 rounded-full"
                onClick={fillWithStandards}
              >
                Use standard times
              </Button>
            </div>
          )}
          {selections.map((s) => {
            const prior = getPrior(s.taskId)!;
            const med = personalMedian(logs, s.taskId);
            return (
              <div key={s.taskId} className="surface p-4">
                <p className="font-semibold">{s.label}</p>
                {s.planned === undefined ? (
                  <>
                    <label className="mt-2 flex flex-col gap-1.5 text-sm font-medium">
                      Gut guess — minutes?
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={s.guess}
                        onChange={(e) =>
                          setSelections(
                            selections.map((x) =>
                              x.taskId === s.taskId ? { ...x, guess: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </label>
                    {!s.revealed ? (
                      <Button
                        className="mt-3 w-full rounded-full font-semibold"
                        disabled={!(Number(s.guess) > 0)}
                        onClick={() => lockGuess(s.taskId)}
                      >
                        {level >= 3 ? "Lock it in" : "Lock my guess & compare"}
                      </Button>
                    ) : (
                      <div className="mt-3 flex flex-col gap-2 text-sm">
                        <p>
                          You guessed <b>{s.guess} min</b>. Typical person:{" "}
                          <b className="text-accent">{prior.p50} min</b> (a slow day:{" "}
                          {prior.p75}).
                          {med !== null && (
                            <>
                              {" "}
                              <b className="text-primary">You, measured: {med} min.</b>
                            </>
                          )}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <Button variant="secondary" size="sm" className="rounded-full" onClick={() => choose(s.taskId, Number(s.guess), "guess")}>
                            Keep {s.guess}m
                          </Button>
                          <Button variant="secondary" size="sm" className="rounded-full" onClick={() => choose(s.taskId, prior.p75, "prior")}>
                            Safe {prior.p75}m
                          </Button>
                          {med !== null && (
                            <Button size="sm" className="col-span-2 rounded-full font-semibold" onClick={() => choose(s.taskId, med, "history")}>
                              Trust my data: {med}m
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Planned: <b className="text-foreground">{s.planned} min</b>{" "}
                    ({s.source === "guess" ? "your guess" : s.source === "prior" ? "typical" : "your history"})
                    {s.autoAccepted && (
                      <span className="text-primary"> · close to your record ✓</span>
                    )}
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}

      {step === 3 && timeline && now && (
        <section className="flex flex-col gap-3">
          <div className="surface p-4 text-sm">
            <p>
              Target: <b className="text-primary">{formatTime(timeline.targetArrival)}</b>{" "}
              at {destination} ({loadSettings().earlyBufferMinutes} min early).
            </p>
            <p className="mt-1">
              Out the door <b>{formatTime(timeline.leaveDoorAt)}</b> · start
              getting ready <b className="text-primary">{formatTime(timeline.startAt)}</b>.
            </p>
          </div>
          {behindMin > 0 && (
            <div className="surface-alert p-4">
              <p className="text-3xl font-bold tabular-nums text-destructive">
                {behindMin} min behind
              </p>
              <p className="mt-1 text-sm text-destructive/90">
                This timeline should have started at {formatTime(timeline.startAt)}.
                Cut {behindMin} min of tasks, or start now and move fast — the
                clock is already running.
              </p>
            </div>
          )}
          <ol className="flex flex-col gap-2">
            {timeline.steps.map((s) => (
              <li key={s.id} className="surface-soft flex items-center justify-between p-3 text-sm">
                <span className="font-medium">{s.label}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatTime(s.startsAt)} · {s.plannedMinutes}m
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="mt-auto flex gap-2 pt-4">
        {step > 0 && (
          <Button variant="secondary" className="h-12 flex-1 rounded-full" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        {step < 3 ? (
          <Button
            className="h-12 flex-1 rounded-full font-semibold"
            disabled={!stepValid}
            onClick={() => setStep(step + 1)}
          >
            Next
          </Button>
        ) : (
          <Button
            className="h-12 flex-1 rounded-full bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
            disabled={!timeline}
            onClick={lock}
          >
            {behindMin > 0 ? "Lock it — I'm moving now" : "Lock timeline"}
          </Button>
        )}
      </div>
    </main>
  );
}
