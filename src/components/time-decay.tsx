"use client";

/**
 * Spatial time representation: a solid mass of color that physically shrinks
 * top-to-bottom as time elapses. No ticking digits during a task — time is
 * something you SEE draining (externalized time, the first-line intervention
 * for time blindness). A small minutes label remains for orientation.
 */
export function TimeDecay({
  plannedMinutes,
  startedAt,
  now,
}: {
  plannedMinutes: number;
  startedAt: string;
  now: Date;
}) {
  const elapsedMin = (now.getTime() - new Date(startedAt).getTime()) / 60_000;
  const remaining = plannedMinutes - elapsedMin;
  const pct = Math.max(0, Math.min(100, (remaining / plannedMinutes) * 100));
  const overtime = remaining < 0;

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`relative h-56 w-full overflow-hidden rounded-sm border-2 ${
          overtime ? "border-destructive" : "border-foreground/80"
        } bg-background/60`}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-label="Time remaining"
      >
        <div
          className={`absolute inset-x-0 bottom-0 transition-[height] duration-1000 ease-linear ${
            overtime
              ? "bg-destructive animate-anchor-pulse"
              : pct < 25
                ? "bg-destructive"
                : "bg-primary"
          }`}
          style={{ height: overtime ? "100%" : `${pct}%` }}
        />
      </div>
      <p
        className={`text-sm font-semibold uppercase tracking-widest ${
          overtime ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {overtime
          ? `${Math.ceil(-remaining)} min over — wrap it up`
          : `about ${Math.ceil(remaining)} min of this block left`}
      </p>
    </div>
  );
}
