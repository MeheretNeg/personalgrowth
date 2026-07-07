"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { VoiceInput } from "@/components/voice-input";
import {
  appendDebrief,
  loadLogs,
  loadSettings,
  loadTrip,
  saveSettings,
  saveTrip,
} from "@/lib/store";
import { formatTime } from "@/lib/engine";
import { LEVELS, earnedLevel, onTimeStreak, stepToward } from "@/lib/graduation";
import { planNudgeCue, syncCues } from "@/lib/push-client";
import { askCoach, buildAppState } from "@/lib/coach-client";
import { GraduationLevel, Trip } from "@/lib/types";

const CAUSES = [
  "Underestimated a task",
  "Started getting ready late",
  "Got distracted mid-task",
  "Couldn't find something",
  "Traffic / transit",
  "Left the door late",
  "Plan was actually right",
];

/**
 * DEBRIEF: the feedback half of the training loop. Time-skills research is
 * unambiguous — estimation only improves with immediate feedback on the gap
 * between prediction and reality, plus attribution of where it came from.
 * This is also where graduation moves: one level per debrief, earned from
 * the measured record, never self-selected.
 */
export default function DebriefPage() {
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [delta, setDelta] = useState(0);
  const [causes, setCauses] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [levelChange, setLevelChange] = useState<{
    from: GraduationLevel;
    to: GraduationLevel;
  } | null>(null);
  const [streak, setStreak] = useState(0);
  const [insight, setInsight] = useState<string | null>(null);

  useEffect(() => {
    const t = loadTrip();
    if (!t || t.phase !== "debrief") {
      router.replace("/");
      return;
    }
    setTrip(t);
    // Prefill from the measured arrival tap — the record that drives
    // levels shouldn't rest on an honor-system dial defaulting to
    // "on time". Still editable for "I tapped late" cases.
    if (t.arrivedAt) {
      const measured = Math.round(
        (new Date(t.arrivedAt).getTime() - new Date(t.arrivalTime).getTime()) / 60_000,
      );
      if (Math.abs(measured) <= 120) setDelta(measured);
    }
  }, [router]);

  if (!trip) return null;

  function save() {
    const debriefs = appendDebrief({
      tripId: trip!.id,
      destination: trip!.destination,
      at: new Date().toISOString(),
      deltaMinutes: delta,
      causes,
      note: note.trim() || undefined,
    });
    saveTrip({ ...trip!, phase: "done" });

    // FADE: recompute what the record supports and move one step toward
    // it. Demotion only ever happens on a late day itself — an on-time
    // arrival must never cost a level, whatever the streak math says.
    const settings = loadSettings();
    const next = stepToward(settings.level, earnedLevel(loadLogs(), debriefs), delta > 0);
    if (next !== settings.level) {
      saveSettings({ ...settings, level: next });
      setLevelChange({ from: settings.level, to: next });
    }
    setStreak(onTimeStreak(debriefs));
    // Habit anchor: one evening nudge to plan the next arrival while calm.
    void syncCues([planNudgeCue(new Date())]);
    setSaved(true);
    // Coach's read: one grounded observation about THIS arrival, async and
    // best-effort — the debrief never waits on it.
    void askCoach([
      {
        role: "user",
        content: `${buildAppState()}\n\nI just logged this arrival: ${trip!.destination}, ${
          delta === 0 ? "exactly on time" : `${Math.abs(delta)} min ${delta < 0 ? "early" : "late"}`
        }${causes.length ? `, causes: ${causes.join(", ")}` : ""}. In one or two sentences, give me the single most useful observation from my record about this. No preamble, no plan proposal.`,
      },
    ]).then((res) => {
      if (res.reply) setInsight(res.reply);
    });
  }

  const early = delta < 0;
  const onTime = delta <= 0; // early IS on time; late is late.

  if (saved) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-5 py-8 text-center">
        <section className={`${onTime ? "surface-active" : "surface-alert"} p-6`}>
          <h1 className="text-2xl font-bold tracking-tight">
            {onTime ? "Logged. That's a rep." : "Logged. The gap is the lesson."}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {onTime
              ? "You did that — Anchor just watched the clock. Every early arrival is your brain relearning what time feels like."
              : "One number, no story needed. One on-time arrival restarts the count — plan it now while it stings."}
          </p>
          {onTime && streak >= 2 && (
            <p className="mt-3 rounded-full bg-primary/12 px-4 py-2 text-sm font-bold text-primary">
              🔥 {streak} on-time arrivals in a row
            </p>
          )}
          {insight && (
            <p className="mt-3 rounded-xl bg-accent/10 px-4 py-2.5 text-left text-sm">
              <span className="font-bold text-accent">Coach&apos;s read:</span> {insight}
            </p>
          )}
        </section>

        {levelChange && (
          <section
            className={`${levelChange.to > levelChange.from ? "surface-active" : "surface"} p-5`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {levelChange.to > levelChange.from ? "Level up" : "Scaffold returns"}
            </p>
            <p className="mt-1 text-xl font-bold">
              Level {levelChange.to} — {LEVELS[levelChange.to].name}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {levelChange.to > levelChange.from
                ? LEVELS[levelChange.to].means
                : "The scaffold's back for a bit while the record rebuilds. You've earned your way up before — the route is known."}
            </p>
          </section>
        )}

        <Button
          size="lg"
          className="h-14 rounded-2xl font-bold"
          onClick={() => router.push("/stats")}
        >
          See what I learned
        </Button>
        <button onClick={() => router.push("/")} className="text-sm text-muted-foreground underline">
          Home
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-8">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-accent">Debrief</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          Required at {formatTime(trip.arrivalTime)}. Reality?
        </h1>
      </header>

      <section className="surface p-5 text-center">
        <p
          className={`text-4xl font-bold tabular-nums ${
            delta < 0 ? "text-primary" : delta === 0 ? "" : "text-destructive"
          }`}
        >
          {delta === 0 ? "Exactly on time" : `${Math.abs(delta)} min ${early ? "early" : "late"}`}
        </p>
        {trip.arrivedAt && (
          <p className="mt-1 text-xs text-muted-foreground">
            measured from your &quot;I&apos;ve arrived&quot; tap — adjust if you tapped late
          </p>
        )}
        <div className="mt-4 grid grid-cols-4 gap-2 text-xs">
          <Button variant="secondary" className="rounded-full" onClick={() => setDelta(delta - 5)}>5 earlier</Button>
          <Button variant="secondary" className="rounded-full" onClick={() => setDelta(delta - 1)}>1 earlier</Button>
          <Button variant="secondary" className="rounded-full" onClick={() => setDelta(delta + 1)}>1 later</Button>
          <Button variant="secondary" className="rounded-full" onClick={() => setDelta(delta + 5)}>5 later</Button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Where did the gap come from?
        </p>
        <div className="flex flex-wrap gap-2">
          {CAUSES.map((c) => (
            <button
              key={c}
              aria-pressed={causes.includes(c)}
              onClick={() =>
                setCauses((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))
              }
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                causes.includes(c) ? "bg-primary text-primary-foreground" : "surface-soft"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex items-start gap-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything future-you should know? (optional)"
          />
          <VoiceInput
            label="Speak the note"
            onResult={(text) => setNote((cur) => (cur ? `${cur} ${text}` : text))}
          />
        </div>
      </section>

      <Button
        size="lg"
        className="mt-auto h-14 rounded-2xl bg-primary font-bold text-primary-foreground hover:bg-primary/90"
        onClick={save}
      >
        Save the lesson
      </Button>
      <button
        onClick={() => {
          saveTrip({ ...trip!, phase: "done" });
          router.push("/");
        }}
        className="text-center text-xs text-muted-foreground underline"
      >
        Skip — log nothing this time
      </button>
    </main>
  );
}
