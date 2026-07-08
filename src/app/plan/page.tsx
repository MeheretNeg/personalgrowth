"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoiceInput } from "@/components/voice-input";
import { TASK_PRIORS, getPrior } from "@/lib/priors";
import { buildTimeline, formatTime, timeOnSameDay } from "@/lib/engine";
import {
  loadLastTaskIds,
  loadLogs,
  loadSettings,
  loadTrip,
  saveLastTaskIds,
  saveSettings,
  saveTrip,
} from "@/lib/store";
import { personalMedian, planningMinutes } from "@/lib/calibration";
import { CalEvent, destinationFrom, parseIcs } from "@/lib/calendar";
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
  const [arrivalDateStr, setArrivalDateStr] = useState(""); // empty = next occurrence
  const [noPrep, setNoPrep] = useState(false);
  const [calEvents, setCalEvents] = useState<CalEvent[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<TransitMode | null>(null);
  const [driveGuess, setDriveGuess] = useState("");
  const [driveSuggested, setDriveSuggested] = useState(false);
  const [walkGuess, setWalkGuess] = useState("");
  const [walkSuggested, setWalkSuggested] = useState(false);
  const [transitDeparture, setTransitDeparture] = useState("");
  const [walkToStop, setWalkToStop] = useState("10");
  const [transitRideGuess, setTransitRideGuess] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [pickupDriveGuess, setPickupDriveGuess] = useState("");
  const [selections, setSelections] = useState<Selection[]>([]);
  const [logs] = useState(() => (typeof window === "undefined" ? [] : loadLogs()));
  const [level] = useState(() => (typeof window === "undefined" ? 1 : loadSettings().level));
  const [planMode, setPlanMode] = useState<"train" | "quick">(() =>
    typeof window === "undefined" ? "train" : (loadSettings().planMode ?? "train"),
  );
  const [now, setNow] = useState<Date | null>(null);
  const [lastTaskIds] = useState<string[]>(() =>
    typeof window === "undefined" ? [] : loadLastTaskIds().filter((id) => getPrior(id)),
  );

  useEffect(() => setNow(new Date()), [step]);

  /**
   * Arrival as a Date. With an explicit date picked, use it literally
   * (planning forward — Thursday's appointment on Monday). Without one,
   * today, rolling to tomorrow if the time already passed.
   */
  const arrivalDate = useMemo(() => {
    if (!arrivalTime || !now) return null;
    if (arrivalDateStr) {
      const [y, mo, day] = arrivalDateStr.split("-").map(Number);
      const [h, mi] = arrivalTime.split(":").map(Number);
      return new Date(y, mo - 1, day, h, mi, 0, 0);
    }
    const d = timeOnSameDay(arrivalTime, now);
    // Roll by calendar day, not +24h of milliseconds — a DST weekend would
    // land an armed airport run a full hour off.
    if (d.getTime() < now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }, [arrivalTime, arrivalDateStr, now]);

  const arrivalInPast = !!(arrivalDate && now && arrivalDate.getTime() < now.getTime());
  const isTomorrow =
    !arrivalDateStr && !!(arrivalDate && now && arrivalDate.toDateString() !== now.toDateString());
  /** "tomorrow" for a rolled time; the weekday+date for an explicit future day. */
  const dayLabel = (() => {
    if (!arrivalDate || !now || arrivalDate.toDateString() === now.toDateString()) return null;
    if (isTomorrow) return "tomorrow";
    return arrivalDate.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  })();

  const transit: TransitDetails | null = useMemo(() => {
    if (!mode) return null;
    if (mode === "driving" || mode === "pickingUp")
      return {
        mode,
        driveMinutes: Number(driveGuess) || 0,
        // Accepting the suggestion is planning, not estimating — it must
        // never count as a near-perfect calibration rep.
        driveGuessMinutes: driveSuggested ? 0 : Number(driveGuess) || 0,
      };
    if (mode === "walking")
      return {
        mode,
        walkMinutes: Number(walkGuess) || 0,
        walkGuessMinutes: walkSuggested ? 0 : Number(walkGuess) || 0,
      };
    if (mode === "transit")
      return {
        mode,
        transitDepartureTime: transitDeparture,
        walkToStopMinutes: Number(walkToStop) || 10,
        rideMinutes: Number(transitRideGuess) || undefined,
      };
    return { mode, pickupTime, driveMinutes: Number(pickupDriveGuess) || undefined };
  }, [mode, driveGuess, driveSuggested, walkGuess, walkSuggested, transitDeparture, walkToStop, transitRideGuess, pickupTime, pickupDriveGuess]);

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
    if (!arrivalDate || !transit || (plannedTasks.length === 0 && !noPrep)) return null;
    const settings = loadSettings();
    return buildTimeline({
      arrival: arrivalDate,
      earlyBufferMinutes: settings.earlyBufferMinutes,
      transit,
      tasks: plannedTasks,
    });
  }, [arrivalDate, transit, plannedTasks, noPrep]);

  /**
   * The no-guess plan for a task. Plans at ~p75 (your slow-ish day), not
   * the median: durations are right-skewed, so planning at p50 means ~50%
   * overrun odds per task — the planning fallacy this app exists to fix.
   */
  function standardFor(taskId: string): Pick<Selection, "planned" | "source"> {
    const plan = planningMinutes(logs, taskId);
    return {
      planned: plan ?? getPrior(taskId)!.p75,
      source: plan !== null ? ("history" as const) : ("prior" as const),
    };
  }

  function toggleTask(taskId: string) {
    setNoPrep(false);
    const existing = selections.find((s) => s.taskId === taskId);
    if (existing) {
      setSelections(selections.filter((s) => s.taskId !== taskId));
    } else {
      const prior = getPrior(taskId)!;
      setSelections([
        ...selections,
        {
          taskId,
          label: prior.label,
          guess: "",
          revealed: false,
          // Quick plan: the time appears the moment the task is tapped.
          ...(planMode === "quick" ? standardFor(taskId) : {}),
        },
      ]);
    }
  }

  /** The minutes quick plan would use for a task — shown on the chips. */
  function standardMinutes(taskId: string): number {
    return planningMinutes(logs, taskId) ?? getPrior(taskId)!.p75;
  }

  function selectUsual() {
    setSelections(
      lastTaskIds.map((taskId) => ({
        taskId,
        label: getPrior(taskId)!.label,
        guess: "",
        revealed: false,
        ...(planMode === "quick" ? standardFor(taskId) : {}),
      })),
    );
  }

  async function onIcsFile(file: File) {
    try {
      const events = parseIcs(await file.text(), new Date());
      setCalEvents(events);
    } catch {
      setCalEvents([]);
    }
  }

  function applyCalEvent(e: CalEvent) {
    setDestination(destinationFrom(e));
    const p = (n: number) => String(n).padStart(2, "0");
    setArrivalTime(`${p(e.start.getHours())}:${p(e.start.getMinutes())}`);
    setArrivalDateStr(
      `${e.start.getFullYear()}-${p(e.start.getMonth() + 1)}-${p(e.start.getDate())}`,
    );
    setCalEvents(null);
  }

  function choosePlanMode(m: "train" | "quick") {
    setPlanMode(m);
    saveSettings({ ...loadSettings(), planMode: m });
    // Switching to quick fills anything still waiting on a guess.
    if (m === "quick") {
      setSelections((cur) =>
        cur.map((s) => (s.planned === undefined ? { ...s, guess: "", ...standardFor(s.taskId) } : s)),
      );
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
      selections.map((s) =>
        s.planned !== undefined ? s : { ...s, guess: "", ...standardFor(s.taskId) },
      ),
    );
  }

  function lock() {
    if (!timeline || !arrivalDate || !transit) return;
    // Never silently clobber a trip that's armed or already running.
    const active = loadTrip();
    if (active && (active.phase === "locked" || active.phase === "executing")) {
      const ok = window.confirm(
        `You have a ${active.destination} trip already set up. Replace it with this one?`,
      );
      if (!ok) return;
    }
    // Scope travel calibration to this destination so "work" and "gym"
    // learn separately.
    const steps = timeline.steps.map((s) =>
      s.taskId === "drive" || s.taskId === "walk"
        ? { ...s, taskId: `${s.taskId}:${slug(destination)}` }
        : s,
    );
    if (plannedTasks.length > 0) saveLastTaskIds(plannedTasks.map((t) => t.taskId));
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

  // A selected-but-unplanned task must never silently drop out of the
  // timeline — the plan would budget zero minutes for it without warning.
  const unplannedCount = selections.filter((s) => s.planned === undefined).length;
  const stepValid =
    step === 0
      ? destination.trim() && arrivalTime && mode && !arrivalInPast
      : step === 1
        ? (mode === "driving" || mode === "pickingUp"
            ? Number(driveGuess) > 0
            : mode === "walking"
              ? Number(walkGuess) > 0
              : mode === "transit"
                ? !!transitDeparture
                : !!pickupTime)
        : noPrep || (plannedTasks.length > 0 && unplannedCount === 0);

  /**
   * Reverse the anchor question for pickup/transit: given required arrival,
   * what time should the ride/vehicle LEAVE? This is exactly the backward
   * calculation a time-blind brain skips — so Anchor does it.
   */
  function recommendedAnchor(travelMinutes: number, arrivalSideBufferMin: number) {
    if (!arrivalDate || travelMinutes <= 0) return null;
    const settings = loadSettings();
    const t = new Date(
      arrivalDate.getTime() -
        (settings.earlyBufferMinutes + travelMinutes + arrivalSideBufferMin) * 60_000,
    );
    const hh = String(t.getHours()).padStart(2, "0");
    const mm = String(t.getMinutes()).padStart(2, "0");
    return { display: formatTime(t), value: `${hh}:${mm}` };
  }

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
          <input
            ref={fileRef}
            type="file"
            accept=".ics,text/calendar"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onIcsFile(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="surface-soft flex items-center justify-between p-3 text-left text-sm font-semibold"
          >
            <span>Import from my calendar</span>
            <span className="text-xs font-normal text-muted-foreground">.ics file →</span>
          </button>
          {calEvents !== null && (
            <div className="surface flex flex-col gap-1.5 p-3">
              {calEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No upcoming events found in that file. You can still enter the
                  trip by hand below.
                </p>
              ) : (
                <>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Tap an event to plan for it
                  </p>
                  {calEvents.map((e, i) => (
                    <button
                      key={i}
                      onClick={() => applyCalEvent(e)}
                      className="surface-soft flex items-center justify-between gap-2 p-2.5 text-left text-sm"
                    >
                      <span className="min-w-0 truncate font-medium">{e.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {e.start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
                        {e.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Destination
            <div className="flex items-center gap-2">
              <Input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="e.g. Work, Dentist, Airport"
              />
              <VoiceInput label="Say the destination" onResult={setDestination} />
            </div>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Must arrive by
              <Input
                type="time"
                value={arrivalTime}
                onChange={(e) => setArrivalTime(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              On
              <Input
                type="date"
                value={arrivalDateStr}
                min={now ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}` : undefined}
                onChange={(e) => setArrivalDateStr(e.target.value)}
              />
            </label>
          </div>
          {dayLabel && !arrivalInPast && (
            <p className="w-fit rounded-full bg-accent/15 px-3 py-1 text-xs font-bold text-accent">
              {isTomorrow
                ? "That time already passed today — planning for TOMORROW"
                : `Planning ahead for ${dayLabel}`}
            </p>
          )}
          {arrivalInPast && (
            <p className="w-fit rounded-full bg-destructive/15 px-3 py-1 text-xs font-bold text-destructive">
              That date and time is in the past — pick a future one
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Anchor targets {loadSettings().earlyBufferMinutes} minutes before
            this. Early is the new on time.
          </p>
          <div className="grid grid-cols-1 gap-2">
            {MODES.map((m) => (
              <button
                key={m.id}
                aria-pressed={mode === m.id}
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
              // Blind first: the record only appears AFTER a guess exists,
              // or the "rep" is just copying the answer.
              if (med === null)
                return (
                  <p className="text-xs text-muted-foreground">
                    Anchor measures the real drive every trip and will correct you
                    once it knows this route.
                  </p>
                );
              if (!(Number(driveGuess) > 0)) return null;
              return (
                <div className="surface-soft p-3.5 text-sm">
                  Guess locked. Your last drives to <b>{destination}</b> actually
                  took about <b className="text-primary">{med} min</b>.
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2 w-full rounded-full"
                    onClick={() => {
                      setDriveGuess(String(med));
                      setDriveSuggested(true);
                    }}
                  >
                    Plan with {med} min
                  </Button>
                </div>
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
              if (med === null)
                return (
                  <p className="text-xs text-muted-foreground">
                    Anchor measures the real walk every trip and will correct you
                    once it knows this route.
                  </p>
                );
              if (!(Number(walkGuess) > 0)) return null;
              return (
                <div className="surface-soft p-3.5 text-sm">
                  Guess locked. Your last walks to <b>{destination}</b> actually
                  took about <b className="text-primary">{med} min</b>.
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2 w-full rounded-full"
                    onClick={() => {
                      setWalkGuess(String(med));
                      setWalkSuggested(true);
                    }}
                  >
                    Plan with {med} min
                  </Button>
                </div>
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
          <div className="surface-soft flex flex-col gap-2 p-3.5">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Not sure which one to catch? How long is the ride (minutes)?
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={transitRideGuess}
                onChange={(e) => setTransitRideGuess(e.target.value)}
                placeholder="minutes"
              />
            </label>
            {(() => {
              const rec = recommendedAnchor(Number(transitRideGuess) || 0, 5);
              return rec ? (
                <div className="text-sm">
                  Catch one departing by <b className="text-primary">{rec.display}</b> or
                  earlier (ride + walk at the far end included).
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2 w-full rounded-full"
                    onClick={() => setTransitDeparture(rec.value)}
                  >
                    Use {rec.display}
                  </Button>
                </div>
              ) : null;
            })()}
          </div>
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
          <div className="surface-soft flex flex-col gap-2 p-3.5">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Not sure what time to ask for? How long is the drive there (minutes)?
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={pickupDriveGuess}
                onChange={(e) => setPickupDriveGuess(e.target.value)}
                placeholder="minutes"
              />
            </label>
            {(() => {
              const rec = recommendedAnchor(Number(pickupDriveGuess) || 0, 3);
              return rec ? (
                <div className="text-sm">
                  Ask to be picked up by <b className="text-primary">{rec.display}</b> to
                  make {destination || "it"} on time (drive + drop-off included).
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2 w-full rounded-full"
                    onClick={() => setPickupTime(rec.value)}
                  >
                    Use {rec.display}
                  </Button>
                </div>
              ) : null;
            })()}
          </div>
          <p className="text-xs text-muted-foreground">
            You&apos;ll be fully ready and waiting at the door <b>10 minutes
            before</b> they pull up. Nobody waits on you — that&apos;s the
            contract.
          </p>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-1 rounded-full p-1 surface-soft">
            {(
              [
                { id: "train", label: "Train my clock" },
                { id: "quick", label: "Quick plan" },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                onClick={() => choosePlanMode(m.id)}
                aria-pressed={planMode === m.id}
                className={`rounded-full px-3 py-2 text-sm font-semibold transition-colors ${
                  planMode === m.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {planMode === "quick"
              ? "Tap tasks — times fill themselves: your measured record where Anchor knows you, typical times where it doesn't. Quick plan keeps you on time; Train mode is what graduates you — one trained trip a week is enough."
              : level >= 3
                ? "Solo level: your guess is the plan. Anchor measures silently and tells you the truth at the debrief."
                : level === 2
                  ? "Coach level: your guess is the plan unless it's far off your record — then Anchor steps in."
                  : "Pick what you still need to do, then guess each duration from your gut before seeing what it typically takes. That guess is the rep — this is the gym."}
          </p>
          <button
            onClick={() => {
              setNoPrep(true);
              setSelections([]);
              setStep(3);
            }}
            aria-pressed={noPrep}
            className={`p-3.5 text-left ${noPrep ? "surface-active" : "surface-soft"}`}
          >
            <span className={`block text-sm font-semibold ${noPrep ? "text-primary" : ""}`}>
              Nothing — I&apos;m heading out now
            </span>
            <span className="text-xs text-muted-foreground">
              Skip prep entirely: just the door, the travel, and the clock.
            </span>
          </button>
          {lastTaskIds.length > 0 && selections.length === 0 && !noPrep && (
            <button onClick={selectUsual} className="surface-active p-3.5 text-left">
              <span className="block text-sm font-semibold text-primary">
                My usual — {lastTaskIds.length} tasks, ~
                {lastTaskIds.reduce((sum, id) => sum + standardMinutes(id), 0)} min
              </span>
              <span className="text-xs text-muted-foreground">
                One tap: same tasks as your last plan
                {planMode === "quick" ? ", times filled automatically." : "."}
              </span>
            </button>
          )}
          <div className="flex flex-wrap gap-2">
            {TASK_PRIORS.map((t) => {
              const sel = selections.find((s) => s.taskId === t.id);
              return (
                <button
                  key={t.id}
                  aria-pressed={!!sel}
                  onClick={() => toggleTask(t.id)}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                    sel ? "bg-primary text-primary-foreground" : "surface-soft"
                  }`}
                >
                  {t.label}
                  {planMode === "quick" && (
                    <span className={sel ? "text-primary-foreground/70" : "text-muted-foreground"}>
                      {" "}
                      · {standardMinutes(t.id)}m
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {unplannedCount > 0 && (
            <p className="text-xs font-semibold text-accent">
              {unplannedCount} selected {unplannedCount === 1 ? "task still needs" : "tasks still need"} a
              time — lock it in or deselect. Nothing gets silently skipped.
            </p>
          )}
          {plannedTasks.length > 0 && (
            <p className="text-sm font-semibold tabular-nums">
              Prep total:{" "}
              <span className="text-primary">
                {plannedTasks.reduce((sum, t) => sum + t.plannedMinutes, 0)} min
              </span>
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                + travel and buffers on the next screen
              </span>
            </p>
          )}
          {planMode === "train" && selections.some((s) => s.planned === undefined) && (
            <div className="surface-soft flex items-center justify-between gap-3 p-3">
              <p className="text-xs text-muted-foreground">
                Rushed? Skip the guessing reps — plan the rest with standard
                times: typical durations, or your own record once Anchor has
                measured you.
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
                            Slow day {prior.p75}m
                          </Button>
                          {med !== null && (
                            <Button
                              size="sm"
                              className="col-span-2 rounded-full font-semibold"
                              onClick={() =>
                                choose(s.taskId, planningMinutes(logs, s.taskId) ?? med, "history")
                              }
                            >
                              Trust my record: {planningMinutes(logs, s.taskId) ?? med}m
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
              at {destination}
              {dayLabel && <b className="text-accent"> {dayLabel}</b>} (
              {loadSettings().earlyBufferMinutes} min early).
            </p>
            <p className="mt-1">
              Out the door <b>{formatTime(timeline.leaveDoorAt)}</b> · start
              getting ready <b className="text-primary">{formatTime(timeline.startAt)}</b>.
            </p>
          </div>
          {(mode === "transit" || mode === "pickup") &&
            new Date(timeline.steps[timeline.steps.length - 1].endsAt).getTime() >
              timeline.targetArrival.getTime() && (
              <div className="surface-alert p-3 text-sm font-semibold text-destructive">
                {mode === "transit"
                  ? "That departure is after your target arrival — you'll be late unless the ride is instant. Wrong bus time?"
                  : "That pickup is after your target arrival — you'll be late the moment they arrive. Wrong pickup time?"}
              </div>
            )}
          {behindMin > 0 && (
            <div className="surface-alert p-4">
              <p className="text-3xl font-bold tabular-nums text-destructive">
                {behindMin} min behind
              </p>
              {(() => {
                // The consequence, made concrete: start now, take every block
                // as planned, and THIS is when you walk in.
                const buffer = loadSettings().earlyBufferMinutes;
                const projected = new Date(
                  timeline.targetArrival.getTime() + behindMin * 60_000,
                );
                const lateBy = behindMin - buffer;
                return (
                  <p className="mt-1 text-sm font-semibold text-destructive">
                    Doing all of this at the planned pace, you&apos;d walk in at{" "}
                    <b className="text-base">{formatTime(projected)}</b>
                    {lateBy > 0 ? (
                      <> — {lateBy} min past the required {formatTime(arrivalDate!)}.</>
                    ) : (
                      <> — your {buffer}-min early cushion just absorbs it.</>
                    )}
                  </p>
                );
              })()}
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
