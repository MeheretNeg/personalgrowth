"use client";

/**
 * Spatial time representation: a solid mass of color that physically drains
 * top-to-bottom as time elapses (externalized time, the first-line
 * intervention for time blindness) — with a large digital countdown overlaid,
 * because "about N min" is exactly the vagueness a time-blind brain rounds
 * to zero. You see the mass shrink AND the seconds move.
 */

/** Signed mm:ss — negative input means overtime. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.abs(Math.round(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${totalSeconds < 0 ? "+" : ""}${mm}:${ss}`;
}

export function TimeDecay({
  plannedMinutes,
  startedAt,
  now,
}: {
  plannedMinutes: number;
  startedAt: string;
  now: Date;
}) {
  const elapsedSec = (now.getTime() - new Date(startedAt).getTime()) / 1000;
  const remainingSec = plannedMinutes * 60 - elapsedSec;
  const pct = Math.max(0, Math.min(100, (remainingSec / (plannedMinutes * 60)) * 100));
  const overtime = remainingSec < 0;
  const low = !overtime && pct < 25;

  return (
    <div className="flex flex-col items-center gap-2.5">
      <div
        className={`relative h-56 w-full overflow-hidden rounded-2xl border ${
          overtime ? "border-destructive/60" : "border-white/10"
        } bg-black/25`}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-label="Time remaining"
      >
        <div
          className={`absolute inset-x-0 bottom-0 transition-[height] duration-1000 ease-linear ${
            overtime
              ? "bg-destructive/80 animate-anchor-pulse"
              : low
                ? "bg-destructive/70"
                : "bg-primary/85"
          }`}
          style={{ height: overtime ? "100%" : `${pct}%` }}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p
            className={`font-mono text-6xl font-bold tabular-nums tracking-tight ${
              overtime ? "text-white" : "text-foreground"
            }`}
            style={{ textShadow: "0 2px 12px rgba(0,0,0,0.55)" }}
          >
            {formatCountdown(remainingSec)}
          </p>
          <p
            className={`mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
              overtime ? "text-white/90" : "text-foreground/70"
            }`}
            style={{ textShadow: "0 1px 8px rgba(0,0,0,0.5)" }}
          >
            {overtime ? "over — wrap it up" : "left in this block"}
          </p>
        </div>
      </div>
    </div>
  );
}
