"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { VoiceInput } from "@/components/voice-input";
import {
  CoachPlan,
  askCoach,
  buildAppState,
  coachEnabled,
  coachPlanToTrip,
  parseCoachPlan,
} from "@/lib/coach-client";
import { loadTrip } from "@/lib/store";
import { formatTime } from "@/lib/engine";

interface Turn {
  role: "user" | "assistant";
  content: string;
  plan?: CoachPlan | null;
}

const QUICK_PROMPTS = [
  "Why am I always late?",
  "What should I work on next?",
  "Plan my usual morning for 9:00",
];

/**
 * Anchor Coach: talk to the app. Grounded in the user's measured record
 * (the wiring lives in buildAppState) and able to hand back a real,
 * lockable plan — conversation as the planning surface.
 */
export default function Coach() {
  const router = useRouter();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [appState] = useState(() => (typeof window === "undefined" ? "" : buildAppState()));
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void coachEnabled().then(setEnabled);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || busy) return;
    const nextTurns: Turn[] = [...turns, { role: "user", content: msg }];
    setTurns(nextTurns);
    setInput("");
    setBusy(true);
    // The app-state snapshot rides in the first user turn — stable across
    // the conversation so the server-side prompt cache keeps working.
    const wire = nextTurns.map((t, i) => ({
      role: t.role,
      content: i === 0 ? `${appState}\n\n${t.content}` : t.content,
    }));
    const res = await askCoach(wire);
    setBusy(false);
    if (res.error) {
      setTurns([...nextTurns, { role: "assistant", content: res.error }]);
      return;
    }
    const plan = parseCoachPlan(res.plan);
    setTurns([
      ...nextTurns,
      {
        role: "assistant",
        content: res.reply || (plan ? "Here's the plan:" : "…"),
        plan,
      },
    ]);
  }

  function lockPlan(plan: CoachPlan) {
    // An armed/executing trip must never be silently clobbered.
    const active = loadTrip();
    if (active && (active.phase === "locked" || active.phase === "executing")) {
      setTurns((cur) => [
        ...cur,
        {
          role: "assistant",
          content: `You've already got a ${active.destination} trip going. Finish or discard that one first, then I'll lock this.`,
        },
      ]);
      return;
    }
    const { trip, error } = coachPlanToTrip(plan);
    if (error || !trip) {
      setTurns((cur) => [
        ...cur,
        { role: "assistant", content: `${error ?? "Couldn't build that plan."} Tell me the missing piece and I'll redo it.` },
      ]);
      return;
    }
    router.push("/lock");
  }

  if (enabled === null) return null;

  if (!enabled) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-5 py-8 text-center">
        <section className="surface p-6">
          <h1 className="text-xl font-bold">Coach isn&apos;t set up yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Add an <code className="font-mono">ANTHROPIC_API_KEY</code> to the
            server environment and the conversational coach switches on.
            Everything else in Anchor works without it.
          </p>
        </section>
        <Link href="/" className="text-sm text-muted-foreground underline">
          Home
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-8">
      <header className="flex items-baseline justify-between pb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-accent">Coach</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Talk to Anchor</h1>
        </div>
        <Link href="/" className="text-sm text-muted-foreground underline">
          Home
        </Link>
      </header>

      <section className="flex flex-1 flex-col gap-3 overflow-y-auto pb-4" aria-live="polite">
        {turns.length === 0 && (
          <div className="surface-soft p-4 text-sm text-muted-foreground">
            I know your record — your real task times, your guessing bias, your
            arrival history. Ask me anything about it, or just tell me where
            you need to be and when.
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
                t.role === "user" ? "bg-primary text-primary-foreground" : "surface"
              }`}
            >
              {t.content}
              {t.plan && (
                <div className="surface-soft mt-3 flex flex-col gap-1 rounded-xl p-3">
                  <p className="font-bold">
                    {t.plan.destination} by{" "}
                    {(() => {
                      const [h, m] = t.plan!.arrivalTime.split(":").map(Number);
                      const d = new Date();
                      d.setHours(h, m, 0, 0);
                      return formatTime(d);
                    })()}{" "}
                    · {t.plan.mode}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.plan.tasks.length
                      ? t.plan.tasks.map((x) => x.label).join(" → ")
                      : "straight out the door — no prep"}
                  </p>
                  <Button
                    size="sm"
                    className="mt-2 rounded-full font-semibold"
                    onClick={() => lockPlan(t.plan!)}
                  >
                    Looks right — lock it
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="surface rounded-2xl px-4 py-2.5 text-sm text-muted-foreground animate-anchor-pulse">
              thinking…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </section>

      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2 pb-3">
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              onClick={() => void send(q)}
              className="surface-soft rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask, or say where you need to be…"
          rows={2}
          className="flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <VoiceInput label="Speak to the coach" onResult={(text) => void send(text)} />
        <Button type="submit" disabled={busy || !input.trim()} className="h-9 rounded-full font-semibold">
          Send
        </Button>
      </form>
    </main>
  );
}
