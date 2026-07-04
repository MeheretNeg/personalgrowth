"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TimeDecay, formatCountdown } from "@/components/time-decay";
import { appendLog, loadSettings, loadTrip, saveSettings, saveTrip } from "@/lib/store";
import { formatTime, minutesUntil, rebuildRemaining } from "@/lib/engine";
import { cueForStep, fireCue } from "@/lib/notify";
import { clearPushSchedule, syncPushSchedule } from "@/lib/push-client";
import { TimelineStep, Trip } from "@/lib/types";

const DEFAULT_CHECKLIST = ["Keys", "Wallet", "Phone", "Charger"];

/** The user's blind guess for a step, for calibration logging. */
function guessFor(trip: Trip, step: TimelineStep): number | null {
  if (!step.taskId) return null;
  if (step.taskId.startsWith("drive:")) return trip.transit.driveMinutes ?? null;
  if (step.taskId.startsWith("walk:")) return trip.transit.walkMinutes ?? null;
  const task = trip.tasks.find((t) => t.taskId === step.taskId);
  // No guess (planned from standard times) → no calibration rep to score.
  return task && task.guessMinutes > 0 ? task.guessMinutes : null;
}

export default function Execute() {
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [checked, setChecked] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<string[]>(() =>
    typeof window === "undefined"
      ? DEFAULT_CHECKLIST
      : (loadSettings().exitChecklist ?? DEFAULT_CHECKLIST),
  );
  const [editingChecklist, setEditingChecklist] = useState(false);
  const [checklistDraft, setChecklistDraft] = useState("");
  const [banked, setBanked] = useState<{ amount: number; key: number } | null>(null);
  const [replanOpen, setReplanOpen] = useState(false);
  const [keepIds, setKeepIds] = useState<Set<string>>(new Set());
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

  // A banked-minutes moment is a reward, not a fixture — it fades.
  useEffect(() => {
    if (!banked) return;
    const id = setTimeout(() => setBanked(null), 5000);
    return () => clearTimeout(id);
  }, [banked]);

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

  // Time must stay visible: keep the screen awake for the whole execution,
  // like turn-by-turn navigation. Best-effort — re-acquired on tab return.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        if ("wakeLock" in navigator && document.visibilityState === "visible") {
          lock = await navigator.wakeLock.request("screen");
        }
      } catch {
        /* low battery or unsupported — the OS decides */
      }
    };
    void acquire();
    const onVisible = () => void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);

  if (!trip) return null;

  // Ahead/behind: measured against the locked plan, not vibes.
  const driftMin = step
    ? Math.round(-minutesUntil(running ? step.endsAt : step.startsAt, now))
    : 0;
  const behind = driftMin >= 1;
  const ahead = driftMin <= -1;

  const remainingPrep = trip.timeline.slice(idx).filter((s) => s.kind === "prep");
  const canReplan = !done && behind && driftMin >= 3 && remainingPrep.length > 0;

  function update(next: Trip) {
    saveTrip(next);
    setTrip(next);
    // Re-anchor the closed-app push schedule to the new trip state.
    void syncPushSchedule(next, level);
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
    // Always measure reality (medians learn from actuals); a guess of 0
    // just means no calibration rep to score for this block.
    if (current.startedAt && current.taskId) {
      const actual = Math.max(
        1,
        Math.round((Date.now() - new Date(current.startedAt).getTime()) / 60_000),
      );
      appendLog({
        taskId: current.taskId,
        guessMinutes: guess ?? 0,
        actualMinutes: actual,
        at: nowIso,
      });
    }
    // Immediate reward: beating the block banks visible minutes.
    if (current.startedAt) {
      const spentMin = (Date.now() - new Date(current.startedAt).getTime()) / 60_000;
      const saved = Math.floor(current.plannedMinutes - spentMin);
      if (saved >= 1) setBanked({ amount: saved, key: Date.now() });
    }
    const timeline = trip!.timeline.map((s, i) =>
      i === idx ? { ...s, finishedAt: nowIso } : s,
    );
    update({ ...trip!, timeline, currentStepIndex: idx + 1 });
    setChecked([]);
  }

  function openReplan() {
    setKeepIds(new Set(remainingPrep.map((s) => s.taskId!).filter(Boolean)));
    setReplanOpen(true);
  }

  function confirmReplan() {
    const rebuilt = rebuildRemaining(trip!.timeline, idx, keepIds);
    setReplanOpen(false);
    firedCues.current.clear();
    update({ ...trip!, timeline: rebuilt.timeline });
  }

  function saveChecklist() {
    const items = checklistDraft
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);
    const next = items.length ? items : DEFAULT_CHECKLIST;
    setChecklist(next);
    saveSettings({ ...loadSettings(), exitChecklist: next });
    setEditingChecklist(false);
    setChecked([]);
  }

  function toDebrief() {
    saveTrip({ ...trip!, phase: "debrief" });
    void clearPushSchedule();
    router.push("/debrief");
  }

  const secsToStart = step ? minutesUntil(step.startsAt, now) * 60 : 0;
  const overdueStart = step && !running && secsToStart <= 0;

  // Live fit preview for the replan dialog.
  const replanPreview =
    replanOpen && !done ? rebuildRemaining(trip.timeline, idx, keepIds) : null;
  const replanSlackMin = replanPreview
    ? Math.floor(minutesUntil(replanPreview.startAt.toISOString(), now))
    : 0;

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
          {/* Always-visible plan drift — lateness as a number, not a vibe. */}
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
              {behind
                ? driftMin >= 15
                  ? "this plan is dead — replan it"
                  : "chop chop — make it back"
                : ahead
                  ? "keep it, don't spend it"
                  : "stay on the block"}
            </span>
          </div>

          {canReplan && (
            <button
              onClick={openReplan}
              className="surface-active p-3 text-center text-sm font-semibold text-primary"
            >
              Replan from now — make it winnable again
            </button>
          )}

          {banked && (
            <p
              key={banked.key}
              className="rounded-full bg-primary/12 px-4 py-2 text-center text-sm font-bold text-primary"
              role="status"
            >
              +{banked.amount} min banked. That's your lead — protect it.
            </p>
          )}

          <section
            className={`${
              isFinalStaging ? "surface-alert" : "surface-active"
            } flex min-h-[24rem] flex-col justify-between gap-4 p-6`}
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
              <div className="flex flex-wrap items-center gap-2">
                {checklist.map((item) => (
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
                <button
                  onClick={() => {
                    setChecklistDraft(checklist.join("\n"));
                    setEditingChecklist(true);
                  }}
                  aria-label="Edit checklist"
                  className="rounded-full px-3 py-2 text-sm text-muted-foreground surface-soft"
                >
                  ✎
                </button>
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

      {/* Failure routes back into the loop: rebuild a winnable plan. */}
      <Dialog open={replanOpen} onOpenChange={setReplanOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replan from now</DialogTitle>
            <DialogDescription>
              The anchor doesn&apos;t move. Cut what you can live without —
              everything left gets fresh, honest times.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {remainingPrep.map((s) => {
              const kept = s.taskId !== undefined && keepIds.has(s.taskId);
              return (
                <button
                  key={s.id}
                  onClick={() =>
                    setKeepIds((cur) => {
                      const next = new Set(cur);
                      if (s.taskId === undefined) return next;
                      if (next.has(s.taskId)) next.delete(s.taskId);
                      else next.add(s.taskId);
                      return next;
                    })
                  }
                  className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-semibold ${
                    kept ? "surface-soft" : "surface-soft opacity-45 line-through"
                  }`}
                >
                  <span>{s.label}</span>
                  <span className="text-muted-foreground">{s.plannedMinutes}m</span>
                </button>
              );
            })}
          </div>
          <p
            className={`text-sm font-semibold ${
              replanSlackMin >= 0 ? "text-primary" : "text-destructive"
            }`}
          >
            {replanSlackMin >= 0
              ? `Fits — starts in ${Math.max(0, replanSlackMin)} min.`
              : `Still ${-replanSlackMin} min over — cut more, or move fast.`}
          </p>
          <Button className="h-12 rounded-full font-bold" onClick={confirmReplan}>
            Reset the plan to now
          </Button>
        </DialogContent>
      </Dialog>

      {/* Out-the-door list is personal: kids' bag, medication, badge… */}
      <Dialog open={editingChecklist} onOpenChange={setEditingChecklist}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your out-the-door checklist</DialogTitle>
            <DialogDescription>One item per line (max 10).</DialogDescription>
          </DialogHeader>
          <Textarea
            value={checklistDraft}
            onChange={(e) => setChecklistDraft(e.target.value)}
            rows={6}
          />
          <Button className="h-11 rounded-full font-bold" onClick={saveChecklist}>
            Save checklist
          </Button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
