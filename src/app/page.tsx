"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { loadTrip, loadLogs, loadDebriefs } from "@/lib/store";
import { calibrationScore } from "@/lib/calibration";
import { Trip } from "@/lib/types";

const PHASE_ROUTE: Record<string, string> = {
  planning: "/plan",
  locked: "/lock",
  executing: "/execute",
  debrief: "/debrief",
};

export default function Pulse() {
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [debriefCount, setDebriefCount] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = loadTrip();
    if (t && t.phase !== "done" && PHASE_ROUTE[t.phase]) {
      router.replace(PHASE_ROUTE[t.phase]);
      return;
    }
    setTrip(t);
    setScore(calibrationScore(loadLogs()));
    setDebriefCount(loadDebriefs().length);
    setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-5 py-10">
      <header className="text-center">
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-accent">
          Anchor
        </p>
        <h1 className="mt-1 text-4xl font-black tracking-tight">
          Early is the new on&nbsp;time.
        </h1>
      </header>

      <section className="glass flex flex-col gap-5 p-6">
        {trip?.phase === "done" ? (
          <p className="text-center text-sm text-muted-foreground">
            Last trip: {trip.destination} — debriefed. Ready for the next one.
          </p>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            No timeline running. Where do you need to be next?
          </p>
        )}
        <Button
          size="lg"
          className="h-14 text-lg font-black uppercase tracking-wide brutal-primary bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => router.push("/plan")}
        >
          Plan my next arrival
        </Button>
      </section>

      <section className="glass flex items-center justify-between p-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Internal clock score
          </p>
          <p className="text-2xl font-black text-primary">
            {score === null ? "—" : `${score}/100`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Arrivals trained
          </p>
          <p className="text-2xl font-black">{debriefCount}</p>
        </div>
      </section>

      <Link
        href="/stats"
        className="text-center text-sm font-semibold text-accent underline underline-offset-4"
      >
        See my training progress
      </Link>
    </main>
  );
}
