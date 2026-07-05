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
  hideDigits = false,
}: {
  plannedMinutes: number;
  startedAt: string;
  now: Date;
  /** Coach level and up: train blocks show only the drain — feel the time. */
  hideDigits?: boolean;
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
          {/* Scrim keeps the digits readable over the amber fill (WCAG). */}
          <div className="flex flex-col items-center rounded-2xl bg-black/45 px-5 py-2">
            {hideDigits && !overtime ? (
              <p className="font-mono text-4xl font-bold tracking-tight text-foreground">
                ~ ~ ~
              </p>
            ) : (
              <p
                className={`font-mono text-6xl font-bold tabular-nums tracking-tight ${
                  overtime ? "text-white" : "text-foreground"
                }`}
              >
                {formatCountdown(remainingSec)}
              </p>
            )}
            <p
              className={`mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                overtime ? "text-white/90" : "text-foreground/80"
              }`}
            >
              {overtime
                ? "over — wrap it up"
                : hideDigits
                  ? "the bar is your clock — feel it"
                  : "left in this block"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
