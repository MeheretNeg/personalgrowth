"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoiceInput } from "@/components/voice-input";
import { TASK_PRIORS, getPrior } from "@/lib/priors";
import { buildTimeline, formatTime, timeOnSameDay } from "@/lib/engine";
import {
  clearPlanDraft,
  loadLastTaskIds,
  loadLogs,
  loadPlanDraft,
  loadSettings,
  loadTrip,
  PlanDraft,
  savePlanDraft,
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
  // A resumable half-finished plan found on mount. Never auto-applied — the
  // user chooses via a dismissible banner.
  const [resumable, setResumable] = useState<PlanDraft | null>(null);
  // The task whose card should scroll into view + focus after a chip tap, so
  // the minutes input isn't stranded far below the chips.
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const hydrated = useRef(false);

  useEffect(() => setNow(new Date()), [step]);

  // Offer to resume an unfinished plan (but only when nothing's running and
  // the draft actually holds content). Loaded once, on mount.
  useEffect(() => {
    const active = loadTrip();
    if (active && (active.phase === "locked" || active.phase === "executing")) return;
    const draft = loadPlanDraft();
    if (draft && (draft.destination.trim() || (draft.selections?.length ?? 0) > 0)) {
      setResumable(draft);
    }
  }, []);

  function resumeDraft(d: PlanDraft) {
    setDestination(d.destination);
    setArrivalTime(d.arrivalTime);
    setArrivalDateStr(d.arrivalDateStr);
    setNoPrep(d.noPrep);
    setMode((d.mode as TransitMode | null) ?? null);
    setDriveGuess(d.driveGuess);
    setDriveSuggested(d.driveSuggested);
    setWalkGuess(d.walkGuess);
    setWalkSuggested(d.walkSuggested);
    setTransitDeparture(d.transitDeparture);
    setWalkToStop(d.walkToStop);
    setTransitRideGuess(d.transitRideGuess);
    setPickupTime(d.pickupTime);
    setPickupDriveGuess(d.pickupDriveGuess);
    setPlanMode(d.planMode);
    setSelections((d.selections as Selection[]) ?? []);
    setStep(d.step);
    setResumable(null);
  }

  function discardDraft() {
    clearPlanDraft();
    setResumable(null);
  }

  // Auto-scroll + focus the newest task card so the guess input meets the
  // user right where they tapped.
  useEffect(() => {
    if (!focusTaskId) return;
    const card = cardRefs.current[focusTaskId];
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.querySelector("input")?.focus({ preventScroll: true });
    setFocusTaskId(null);
  }, [focusTaskId]);

  // Persist the draft on every change — but skip the mount pass so we never
  // stomp the draft the resume banner is still offering.
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    const hasContent =
      destination.trim() !== "" || selections.length > 0 || mode !== null || noPrep;
    if (!hasContent) {
      clearPlanDraft();
      return;
    }
    savePlanDraft({
      savedAt: new Date().toISOString(),
      step,
      destination,
      arrivalTime,
      arrivalDateStr,
      noPrep,
      mode,
      driveGuess,
      driveSuggested,
      walkGuess,
      walkSuggested,
      transitDeparture,
      walkToStop,
      transitRideGuess,
      pickupTime,
      pickupDriveGuess,
      planMode,
      selections,
    });
  }, [
    step,
    destination,
    arrivalTime,
    arrivalDateStr,
    noPrep,
    mode,
    driveGuess,
    driveSuggested,
    walkGuess,
    walkSuggested,
    transitDeparture,
    walkToStop,
    transitRideGuess,
    pickupTime,
    pickupDriveGuess,
    planMode,
    selections,
  ]);

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
      // Train mode still needs a guess — bring its card to the user rather
      // than leaving the input stranded below the chip grid.
      if (planMode === "train") setFocusTaskId(taskId);
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
    clearPlanDraft();
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

      {resumable && step === 0 && (
        <div className="surface-active flex items-center justify-between gap-3 p-3.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary">Pick up where you left off?</p>
            <p className="truncate text-xs text-muted-foreground">
              {resumable.destination.trim()
                ? `Unfinished plan to ${resumable.destination.trim()}`
                : "An unfinished plan is saved"}
              {resumable.arrivalTime ? ` · arrive ${resumable.arrivalTime}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              className="rounded-full font-semibold"
              onClick={() => resumeDraft(resumable)}
            >
              Resume
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              onClick={discardDraft}
            >
              Discard
            </Button>
          </div>
        </div>
      )}

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

          {/* Cards sit directly under the chips they came from — tap a chip,
              its minutes card is right there, not stranded past a scroll. */}
          {selections.map((s) => {
            const prior = getPrior(s.taskId)!;
            const med = personalMedian(logs, s.taskId);
            const planningMed = planningMinutes(logs, s.taskId) ?? med;
            return (
              <div
                key={s.taskId}
                ref={(el) => {
                  cardRefs.current[s.taskId] = el;
                }}
                className="surface p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{s.label}</p>
                  <button
                    onClick={() => toggleTask(s.taskId)}
                    className="text-xs font-medium text-muted-foreground underline"
                  >
                    Remove
                  </button>
                </div>
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
                      <div className="mt-3 flex flex-col gap-2.5 text-sm">
                        <div className="flex items-center justify-between rounded-xl bg-accent/10 px-3 py-2">
                          <span className="font-medium">You guessed</span>
                          <span className="text-lg font-bold tabular-nums text-accent">
                            {s.guess}m
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Pick the number to plan with:
                        </p>
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => choose(s.taskId, Number(s.guess), "guess")}
                            className="surface-soft flex items-center justify-between px-3.5 py-3 text-left transition-colors active:scale-[0.99]"
                          >
                            <span className="text-sm font-semibold">Keep {s.guess}m</span>
                            <span className="text-xs text-muted-foreground">trust my gut</span>
                          </button>
                          <button
                            onClick={() => choose(s.taskId, prior.p75, "prior")}
                            className="surface-soft flex items-center justify-between px-3.5 py-3 text-left transition-colors active:scale-[0.99]"
                          >
                            <span className="text-sm font-semibold">Slow day {prior.p75}m</span>
                            <span className="text-xs text-muted-foreground">
                              typical: {prior.p50}m
                            </span>
                          </button>
                          {med !== null && (
                            <button
                              onClick={() => choose(s.taskId, planningMed!, "history")}
                              className="surface-active flex items-center justify-between px-3.5 py-3 text-left transition-colors active:scale-[0.99]"
                            >
                              <span className="text-sm font-semibold text-primary">
                                Trust my record: {planningMed}m
                              </span>
                              <span className="text-xs text-muted-foreground">
                                measured: {med}m
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-sm text-muted-foreground">
                      Planned: <b className="text-foreground tabular-nums">{s.planned} min</b>{" "}
                      ({s.source === "guess" ? "your guess" : s.source === "prior" ? "typical" : "your history"})
                      {s.autoAccepted && (
                        <span className="text-primary"> · close to your record ✓</span>
                      )}
                    </p>
                    <button
                      onClick={() =>
                        setSelections(
                          selections.map((x) =>
                            x.taskId === s.taskId
                              ? { ...x, planned: undefined, revealed: false, source: undefined, autoAccepted: false }
                              : x,
                          ),
                        )
                      }
                      className="shrink-0 text-xs font-medium text-accent underline"
                    >
                      Redo
                    </button>
                  </div>
                )}
              </div>
            );
          })}

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
        </section>
      )}

      {step === 3 && timeline && now && (() => {
        // Everything the dashboard needs, derived once from the built
        // timeline so the headline, the section cards and the spelled-out
        // math can never disagree with each other (or with the leave-by
        // banner on the execute screen — both now anchor on the first
        // TRAVEL step, the real walk-out).
        const buffer = loadSettings().earlyBufferMinutes;
        const prepMin = timeline.steps
          .filter((s) => s.kind === "prep")
          .reduce((a, s) => a + s.plannedMinutes, 0);
        const doorBufferMin = timeline.steps
          .filter((s) => s.kind === "staging")
          .reduce((a, s) => a + s.plannedMinutes, 0);
        const travelMin = timeline.steps
          .filter((s) => s.kind === "travel")
          .reduce((a, s) => a + s.plannedMinutes, 0);
        const stagingStep = timeline.steps.find((s) => s.kind === "staging");
        const departStep = timeline.steps.find((s) => s.kind === "travel") ?? stagingStep;
        const departAt = departStep ? new Date(departStep.startsAt) : timeline.leaveDoorAt;
        const totalSpan = Math.round(
          (timeline.targetArrival.getTime() - timeline.startAt.getTime()) / 60_000,
        );
        const departVerb =
          mode === "pickup"
            ? "be ready by"
            : mode === "transit"
              ? "leave for the stop by"
              : "leave home by";
        const whenLabel = dayLabel ?? "today";
        return (
        <section className="flex flex-col gap-3">
          {/* The headline the user asked for: arrive at X → leave at X. */}
          <div className="surface-active p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {destination} · {whenLabel}
            </p>
            <p className="mt-2 text-xl font-bold leading-snug">
              Arrive by{" "}
              <span className="text-primary">{formatTime(timeline.targetArrival)}</span>
              <span className="text-muted-foreground"> · </span>
              {departVerb}{" "}
              <span className="text-primary">{formatTime(departAt)}</span>
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Start getting ready at{" "}
              <b className="text-foreground tabular-nums">{formatTime(timeline.startAt)}</b> —
              that&apos;s {totalSpan} min from your first move to walking in.
            </p>
          </div>

          {/* Sectioned summary — each editable in place. */}
          <div className="flex flex-col gap-2">
            <div className="surface-soft flex items-start justify-between gap-3 p-3.5">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  Where & when
                </p>
                <p className="mt-0.5 text-sm font-medium">
                  {destination}, {whenLabel}
                </p>
                <p className="text-xs text-muted-foreground">
                  Required {formatTime(arrivalDate!)} · targeting{" "}
                  {formatTime(timeline.targetArrival)} ({buffer} min early)
                </p>
              </div>
              <button
                onClick={() => setStep(0)}
                className="shrink-0 text-xs font-semibold text-accent underline"
              >
                Edit
              </button>
            </div>

            <div className="surface-soft flex items-start justify-between gap-3 p-3.5">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  Getting there
                </p>
                <p className="mt-0.5 text-sm font-medium">
                  {MODES.find((m) => m.id === mode)?.label ?? mode}
                  {travelMin > 0 && (
                    <span className="text-muted-foreground"> · {travelMin} min door-to-door</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {departVerb.charAt(0).toUpperCase() + departVerb.slice(1)}{" "}
                  {formatTime(departAt)}
                </p>
              </div>
              <button
                onClick={() => setStep(1)}
                className="shrink-0 text-xs font-semibold text-accent underline"
              >
                Edit
              </button>
            </div>

            <div className="surface-soft flex items-start justify-between gap-3 p-3.5">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  Before you go
                </p>
                {noPrep || prepMin === 0 ? (
                  <p className="mt-0.5 text-sm font-medium">
                    Straight out the door — nothing to prep
                  </p>
                ) : (
                  <p className="mt-0.5 text-sm font-medium">
                    {timeline.steps.filter((s) => s.kind === "prep").length} tasks ·{" "}
                    {prepMin} min of getting ready
                  </p>
                )}
              </div>
              <button
                onClick={() => setStep(2)}
                className="shrink-0 text-xs font-semibold text-accent underline"
              >
                Edit
              </button>
            </div>
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

          {/* The math, spelled out — so "why 6:16?" is never a mystery. */}
          <div className="surface p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              The math, spelled out
            </p>
            <div className="mt-2 flex flex-col gap-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span>Start getting ready</span>
                <b className="tabular-nums">{formatTime(timeline.startAt)}</b>
              </div>
              {prepMin > 0 && !noPrep && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>+ getting ready</span>
                  <span className="tabular-nums">{prepMin} min</span>
                </div>
              )}
              {doorBufferMin > 0 && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>+ staged at the door</span>
                  <span className="tabular-nums">{doorBufferMin} min</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {mode === "pickup" ? "Ready at the door" : "Out the door"}
                </span>
                <b className="tabular-nums text-primary">{formatTime(departAt)}</b>
              </div>
              {travelMin > 0 && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>+ travel</span>
                  <span className="tabular-nums">{travelMin} min</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-border pt-1.5">
                <span className="font-medium">Walk in</span>
                <b className="tabular-nums text-primary">{formatTime(timeline.targetArrival)}</b>
              </div>
            </div>
          </div>

          <details open className="surface-soft p-3.5">
            <summary className="cursor-pointer text-sm font-semibold">
              Every step, in order
            </summary>
            <ol className="mt-3 flex flex-col gap-2">
              {timeline.steps.map((s) => (
                <li key={s.id} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatTime(s.startsAt)} · {s.plannedMinutes}m
                  </span>
                </li>
              ))}
            </ol>
          </details>

          <p className="text-center text-xs text-muted-foreground">
            {behindMin > 0
              ? "The plan's honest — now it's a race. Lock it and move."
              : "That's the whole plan, start to finish. Lock it and it's off your mind."}
          </p>
        </section>
        );
      })()}

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
