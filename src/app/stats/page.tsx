"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadDebriefs, loadLogs, loadSettings } from "@/lib/store";
import {
  MIN_LOGS_FOR_HISTORY,
  calibrationScore,
  errorTrend,
  meanSignedErrorPct,
  personalMedian,
} from "@/lib/calibration";
import { getPrior } from "@/lib/priors";
import { LEVELS, levelProgress, onTimeStreak } from "@/lib/graduation";
import { Debrief, DurationLog, GraduationLevel } from "@/lib/types";

function historyDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function labelFor(taskId: string): string {
  if (taskId.startsWith("drive:"))
    return `Drive → ${taskId.slice(6).replace(/-/g, " ")}`;
  if (taskId.startsWith("walk:"))
    return `Walk → ${taskId.slice(5).replace(/-/g, " ")}`;
  // The screen that proves personalization must show the label the user
  // chose, not an internal slug.
  return getPrior(taskId)?.label ?? taskId.replace(/-/g, " ");
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
        {(() => {
          const bias = meanSignedErrorPct(logs);
          return bias !== null && Math.abs(bias) >= 10 ? (
            <p className="mt-2 text-sm">
              Your pattern: you guess about{" "}
              <b className={bias > 0 ? "text-destructive" : "text-accent"}>
                {Math.abs(bias)}% {bias > 0 ? "short" : "long"}
              </b>
              {bias > 0 ? " — the time-blindness signature. Pad your gut number." : "."}
            </p>
          ) : null;
        })()}
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
        {onTimeStreak(debriefs) >= 2 && (
          <p className="mt-2 rounded-full bg-primary/12 px-4 py-1.5 text-center text-sm font-bold text-primary">
            🔥 {onTimeStreak(debriefs)} on-time arrivals in a row
          </p>
        )}
      </section>

      {debriefs.length > 0 && (
        <section className="surface p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Arrival history
          </p>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {[...debriefs]
              .reverse()
              .slice(0, 12)
              .map((d, i) => (
                <li key={`${d.tripId}-${i}`} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="text-muted-foreground">{historyDate(d.at)}</span>{" "}
                    <span className="font-medium">{d.destination}</span>
                    {d.solo && (
                      <span className="ml-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">
                        solo
                      </span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${
                      d.deltaMinutes < 0
                        ? "bg-primary/12 text-primary"
                        : d.deltaMinutes === 0
                          ? "surface-soft text-muted-foreground"
                          : "bg-destructive/15 text-destructive"
                    }`}
                  >
                    {d.deltaMinutes === 0
                      ? "on time"
                      : `${Math.abs(d.deltaMinutes)}m ${d.deltaMinutes < 0 ? "early" : "late"}`}
                  </span>
                </li>
              ))}
          </ul>
          {debriefs.length > 12 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {debriefs.length} trips recorded in total — every one is training data.
            </p>
          )}
        </section>
      )}

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
            What you&apos;ve learned about yourself
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            After 5 measurements, your real time replaces the textbook number
            in every future plan.
          </p>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {taskIds.map((id) => {
              const mine = logs.filter((l) => l.taskId === id);
              const med = personalMedian(logs, id);
              return (
                <li key={id} className="flex justify-between">
                  <span>{labelFor(id)}</span>
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
