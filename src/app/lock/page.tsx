"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { clearTrip, loadTrip, saveTrip } from "@/lib/store";
import { formatTime } from "@/lib/engine";
import { Trip } from "@/lib/types";

/**
 * LOCK = commitment device. Two evidence-based moves happen here:
 * 1. The if-then chain (implementation intentions, Gollwitzer: d≈0.65) —
 *    the user reads each cue→action pair once out loud.
 * 2. A 20-second episodic-future-thinking visualization (meta-analyses show
 *    vividly imagining the future moment reduces "later is not real" bias).
 */
export default function Lock() {
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [visualized, setVisualized] = useState(false);

  useEffect(() => {
    const t = loadTrip();
    if (!t || t.phase !== "locked") {
      router.replace("/");
      return;
    }
    setTrip(t);
  }, [router]);

  if (!trip) return null;

  function begin() {
    saveTrip({ ...trip!, phase: "executing" });
    router.push("/execute");
  }

  function discard() {
    clearTrip();
    router.push("/");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-8">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-accent">Lock</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight">
          {trip.destination}, {formatTime(new Date(new Date(trip.arrivalTime).getTime() - trip.earlyBufferMinutes * 60_000))}
          <span className="block text-sm font-semibold text-muted-foreground">
            ({trip.earlyBufferMinutes} min before the real {formatTime(trip.arrivalTime)})
          </span>
        </h1>
      </header>

      <section className="flex flex-col gap-2">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Read each line. Mean it.
        </p>
        {trip.timeline.map((s) => (
          <p key={s.id} className="glass p-3 text-sm">
            {s.ifThen}
          </p>
        ))}
      </section>

      {!visualized ? (
        <section className="brutal bg-card p-5">
          <p className="text-sm font-bold uppercase tracking-widest text-accent">
            20 seconds — future you
          </p>
          <p className="mt-2 text-sm leading-6">
            Close your eyes and picture it concretely: you walk into{" "}
            <b>{trip.destination}</b> at{" "}
            <b>{formatTime(new Date(new Date(trip.arrivalTime).getTime() - trip.earlyBufferMinutes * 60_000))}</b>,
            ten minutes to spare. Where are you standing? What do you do with
            the extra time? How does it feel to be the early one?
          </p>
          <Button className="mt-4 w-full font-bold" onClick={() => setVisualized(true)}>
            I saw it
          </Button>
        </section>
      ) : (
        <Button
          size="lg"
          className="brutal-primary h-16 bg-primary text-lg font-black uppercase tracking-wide text-primary-foreground hover:bg-primary/90"
          onClick={begin}
        >
          Timeline locked — begin
        </Button>
      )}

      <button onClick={discard} className="text-center text-xs text-muted-foreground underline">
        Discard this plan
      </button>
    </main>
  );
}
