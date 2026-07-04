"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadDebriefs, loadLogs, loadSettings } from "@/lib/store";
import {
  MIN_LOGS_FOR_HISTORY,
  calibrationScore,
  errorTrend,
  personalMedian,
} from "@/lib/calibration";
import { Debrief, DurationLog } from "@/lib/types";

const LEVELS: Record<number, { name: string; means: string }> = {
  1: { name: "Scaffold", means: "Anchor computes everything. You guess first, every time — that's the rep." },
  2: { name: "Coach", means: "You build the timeline; Anchor only flags the errors before you lock." },
  3: { name: "Solo", means: "You plan in your head. Anchor silently checks and debriefs you after." },
  4: { name: "Graduated", means: "Anchor is a scoreboard. You are the clock." },
};

function labelFor(taskId: string, logs: DurationLog[]): string {
  if (taskId.startsWith("drive:"))
    return `Drive → ${taskId.slice(6).replace(/-/g, " ")}`;
  return logs.find((l) => l.taskId === taskId)?.taskId.replace(/-/g, " ") ?? taskId;
}

export default function Stats() {
  const [logs, setLogs] = useState<DurationLog[]>([]);
  const [debriefs, setDebriefs] = useState<Debrief[]>([]);
  const [level, setLevel] = useState(1);

  useEffect(() => {
    setLogs(loadLogs());
    setDebriefs(loadDebriefs());
    setLevel(loadSettings().level);
  }, []);

  const score = calibrationScore(logs);
  const trend = errorTrend(logs);
  const early = debriefs.filter((d) => d.deltaMinutes < 0).length;
  const onTime = debriefs.filter((d) => d.deltaMinutes === 0).length;
  const late = debriefs.filter((d) => d.deltaMinutes > 0).length;
  const avgDelta = debriefs.length
    ? Math.round(debriefs.reduce((s, d) => s + d.deltaMinutes, 0) / debriefs.length)
    : null;

  const taskIds = [...new Set(logs.map((l) => l.taskId))];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-8">
      <header className="flex items-baseline justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.35em] text-accent">Training</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight">Your clock, measured</h1>
        </div>
        <Link href="/" className="text-sm text-muted-foreground underline">
          Home
        </Link>
      </header>

      <section className="brutal-primary bg-card p-5">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Internal clock score
        </p>
        <p className="text-5xl font-black text-primary">
          {score === null ? "—" : score}
          <span className="text-lg text-muted-foreground">/100</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          How close your blind guesses land to measured reality (last 10 tasks).
          This number IS the training goal — the app fades as it climbs.
        </p>
      </section>

      <section className="glass p-4">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Arrival record
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-2xl font-black text-primary">{early}</p>
            <p className="text-xs text-muted-foreground">early</p>
          </div>
          <div>
            <p className="text-2xl font-black">{onTime}</p>
            <p className="text-xs text-muted-foreground">on time</p>
          </div>
          <div>
            <p className="text-2xl font-black text-destructive">{late}</p>
            <p className="text-xs text-muted-foreground">late</p>
          </div>
        </div>
        {avgDelta !== null && (
          <p className="mt-2 text-center text-sm">
            Average: <b>{Math.abs(avgDelta)} min {avgDelta <= 0 ? "early" : "late"}</b>
          </p>
        )}
      </section>

      {trend.length > 0 && (
        <section className="glass p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Guess error, recent tasks (down = better)
          </p>
          <div className="mt-3 flex h-24 items-end gap-1">
            {trend.map((t, i) => {
              const h = Math.min(100, Math.abs(t.errorPct));
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-t-sm ${t.errorPct > 0 ? "bg-destructive" : "bg-accent"}`}
                  style={{ height: `${Math.max(4, h)}%` }}
                  title={`${t.errorPct > 0 ? "+" : ""}${t.errorPct}%`}
                />
              );
            })}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            orange = underestimated (the time-blindness signature) · blue = overestimated
          </p>
        </section>
      )}

      {taskIds.length > 0 && (
        <section className="glass p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            What Anchor has learned about you
          </p>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {taskIds.map((id) => {
              const mine = logs.filter((l) => l.taskId === id);
              const med = personalMedian(logs, id);
              return (
                <li key={id} className="flex justify-between capitalize">
                  <span>{labelFor(id, logs)}</span>
                  <span className="text-muted-foreground">
                    {med !== null ? (
                      <>
                        really takes <b className="text-primary">{med}m</b>
                      </>
                    ) : (
                      `${mine.length}/${MIN_LOGS_FOR_HISTORY} measurements`
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="glass p-4">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Graduation level
        </p>
        <p className="mt-1 text-xl font-black">
          Level {level} — {LEVELS[level].name}
        </p>
        <p className="text-sm text-muted-foreground">{LEVELS[level].means}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Levels unlock as your clock score and early-arrival streak climb —
          the goal is for Anchor to do less until you don&apos;t need it.
        </p>
      </section>
    </main>
  );
}
