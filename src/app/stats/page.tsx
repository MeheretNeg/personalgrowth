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
import { LEVELS, levelProgress } from "@/lib/graduation";
import { Debrief, DurationLog, GraduationLevel } from "@/lib/types";

function labelFor(taskId: string, logs: DurationLog[]): string {
  if (taskId.startsWith("drive:"))
    return `Drive → ${taskId.slice(6).replace(/-/g, " ")}`;
  return logs.find((l) => l.taskId === taskId)?.taskId.replace(/-/g, " ") ?? taskId;
}

export default function Stats() {
  const [logs, setLogs] = useState<DurationLog[]>([]);
  const [debriefs, setDebriefs] = useState<Debrief[]>([]);
  const [level, setLevel] = useState<GraduationLevel>(1);

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
  const progress = levelProgress(logs, debriefs, level);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-5 py-8">
      <header className="flex items-baseline justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-accent">Training</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Your clock, measured</h1>
        </div>
        <Link href="/" className="text-sm text-muted-foreground underline">
          Home
        </Link>
      </header>

      <section className="surface-active p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Internal clock score
        </p>
        <p className="text-5xl font-bold tabular-nums text-primary">
          {score === null ? "—" : score}
          <span className="text-lg text-muted-foreground">/100</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          How close your blind guesses land to measured reality (last 10 tasks).
          This number IS the training goal — the app fades as it climbs.
        </p>
      </section>

      <section className="surface p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Graduation level
        </p>
        <p className="mt-1 text-xl font-bold">
          Level {level} — {LEVELS[level].name}
        </p>
        <p className="text-sm text-muted-foreground">{LEVELS[level].means}</p>
        {progress ? (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-xs font-semibold text-muted-foreground">
              To reach Level {progress.target} — {LEVELS[progress.target].name}:
            </p>
            {progress.items.map((item) => (
              <div key={item.label} className="flex items-center justify-between text-sm">
                <span className={item.met ? "text-muted-foreground line-through" : ""}>
                  {item.label}
                </span>
                <span className={`tabular-nums font-semibold ${item.met ? "text-primary" : "text-muted-foreground"}`}>
                  {item.met ? "✓ " : ""}
                  {item.have}/{item.need}
                </span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Levels move one step per debrief, in both directions — a late day
              brings the scaffold back.
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            This is the last level. Anchor is a scoreboard now — you are the clock.
          </p>
        )}
      </section>

      <section className="surface p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Arrival record
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-2xl font-bold tabular-nums text-primary">{early}</p>
            <p className="text-xs text-muted-foreground">early</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums">{onTime}</p>
            <p className="text-xs text-muted-foreground">on time</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-destructive">{late}</p>
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
        <section className="surface p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Guess error, recent tasks (down = better)
          </p>
          <div className="mt-3 flex h-24 items-end gap-1">
            {trend.map((t, i) => {
              const h = Math.min(100, Math.abs(t.errorPct));
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-t-sm ${t.errorPct > 0 ? "bg-destructive/80" : "bg-accent/80"}`}
                  style={{ height: `${Math.max(4, h)}%` }}
                  title={`${t.errorPct > 0 ? "+" : ""}${t.errorPct}%`}
                />
              );
            })}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            red = underestimated (the time-blindness signature) · blue = overestimated
          </p>
        </section>
      )}

      {taskIds.length > 0 && (
        <section className="surface p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
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
    </main>
  );
}
