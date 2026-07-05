"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SoloTrip,
  appendDebrief,
  clearSolo,
  loadLogs,
  loadSettings,
  loadSolo,
  saveSettings,
  saveSolo,
} from "@/lib/store";
import { formatTime, timeOnSameDay } from "@/lib/engine";
import { LEVELS, earnedLevel, onTimeStreak, stepToward } from "@/lib/graduation";
import { GraduationLevel } from "@/lib/types";

/**
 * FREE SOLO (Level 3+): destination and required time only. No timeline,
 * no cues, no countdown — the trained internal clock, unaided. Without
 * this, "you are the clock" is asserted but never demonstrated, and a
 * Level-4 user still runs the full scaffold for every trip.
 */
export default function Solo() {
  const router = useRouter();
  const [solo, setSolo] = useState<SoloTrip | null>(null);
  const [destination, setDestination] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<{
    delta: number;
    streak: number;
    levelTo?: GraduationLevel;
  } | null>(null);

  useEffect(() => {
    setSolo(loadSolo());
    setReady(true);
  }, []);

  if (!ready) return null;

  function begin() {
    const now = new Date();
    const d = timeOnSameDay(arrivalTime, now);
    if (d.getTime() < now.getTime()) d.setDate(d.getDate() + 1);
    const s: SoloTrip = {
      destination: destination.trim(),
      arrivalTime: d.toISOString(),
      startedAt: now.toISOString(),
    };
    saveSolo(s);
    setSolo(s);
  }

  function arrived() {
    const now = new Date();
    const delta = Math.round(
      (now.getTime() - new Date(solo!.arrivalTime).getTime()) / 60_000,
    );
    const debriefs = appendDebrief({
      tripId: `solo-${solo!.startedAt}`,
      destination: solo!.destination,
      at: now.toISOString(),
      deltaMinutes: delta,
      causes: [],
      solo: true,
    });
    const settings = loadSettings();
    const next = stepToward(settings.level, earnedLevel(loadLogs(), debriefs), delta > 0);
    if (next !== settings.level) saveSettings({ ...settings, level: next });
    clearSolo();
    setResult({
      delta,
      streak: onTimeStreak(debriefs),
      levelTo: next !== settings.level ? next : undefined,
    });
  }

  function abandon() {
    clearSolo();
    router.push("/");
  }

  if (result) {
    const onTime = result.delta <= 0;
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-5 py-8 text-center">
        <section className={`${onTime ? "surface-active" : "surface-alert"} p-6`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Free solo — measured
          </p>
          <p className="mt-2 text-4xl font-bold tabular-nums">
            {result.delta === 0
              ? "Exactly on time"
              : `${Math.abs(result.delta)} min ${result.delta < 0 ? "early" : "late"}`}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {onTime
              ? "No timeline, no cues — that was your clock, and it held."
              : "Unaided data is the honest kind. The scaffold is right there when you want a rep."}
          </p>
          {onTime && result.streak >= 2 && (
            <p className="mt-3 rounded-full bg-primary/12 px-4 py-2 text-sm font-bold text-primary">
              🔥 {result.streak} on-time arrivals in a row
            </p>
          )}
          {result.levelTo && (
            <p className="mt-2 text-sm font-semibold">
              Level {result.levelTo} — {LEVELS[result.levelTo].name}
            </p>
          )}
        </section>
        <Button size="lg" className="h-14 rounded-2xl font-bold" onClick={() => router.push("/")}>
          Home
        </Button>
      </main>
    );
  }

  if (solo) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-5 py-8 text-center">
        <section className="surface-active p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
            Free solo
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {solo.destination} by {formatTime(solo.arrivalTime)}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            No timeline. No cues. Get there the way you&apos;ll do it for the
            rest of your life — then tap the moment you walk in. Anchor
            measures the truth from this tap, so tap honestly.
          </p>
        </section>
        <Button
          size="lg"
          className="h-16 rounded-2xl bg-primary text-lg font-bold text-primary-foreground hover:bg-primary/90"
          onClick={arrived}
        >
          I&apos;ve arrived
        </Button>
        <button onClick={abandon} className="text-xs text-muted-foreground underline">
          Abandon — log nothing
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-5 py-8">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-accent">
          Free solo
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          Just you and the clock
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Where and when — that&apos;s all Anchor gets. No timeline, no
          pings. This is the graduation exam, as many times as you want it.
        </p>
      </header>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Destination
        <Input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="e.g. Work"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Must arrive by
        <Input type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} />
      </label>
      <Button
        size="lg"
        className="h-14 rounded-2xl bg-primary font-bold text-primary-foreground hover:bg-primary/90"
        disabled={!destination.trim() || !arrivalTime}
        onClick={begin}
      >
        Start — clock&apos;s running
      </Button>
      <button onClick={() => router.push("/")} className="text-center text-xs text-muted-foreground underline">
        Back
      </button>
    </main>
  );
}
