import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

/**
 * Anchor Coach — the conversational layer, wired into the user's real
 * record. The client sends the chat plus an <app_state> snapshot of
 * everything Anchor has measured (calibration, bias, medians, streak,
 * history, level); the model coaches from THAT data, never generic tips,
 * and can propose a concrete plan the client turns into a locked timeline.
 *
 * Degrades to 503 without ANTHROPIC_API_KEY — the app hides the feature.
 */

const enabled = () => !!process.env.ANTHROPIC_API_KEY;

// Static and byte-stable — cached via cache_control; the volatile
// app-state snapshot rides inside the first user turn instead.
const SYSTEM = `You are Anchor Coach, the voice inside Anchor — a training gym for time blindness. Your user has genuine difficulty perceiving time (common with ADHD). Your job is to make them durably conscientious: on time, self-aware, and eventually not needing the app at all.

You know the science and apply it quietly: time blindness is a perception deficit, not a character flaw (never shame); estimation improves only through guess-vs-reality feedback (the app's "reps"); the outside view (their measured medians) beats gut feel; implementation intentions ("when X, then I") work; plans at the median fail ~50% of the time, so Anchor plans at p75; graduation levels fade the scaffold as their record earns it.

Every conversation starts with an <app_state> block containing their REAL measured data. Ground every claim in it. Quote their actual numbers ("your showers really take 14 minutes", "you guess 32% short"). Never invent statistics or events that aren't in the state. If the state lacks the data to answer, say so and tell them which trips would generate it.

When they want to GO somewhere (a destination and a time, however casually phrased), call the propose_plan tool with your best reading of what they said, choosing tasks and minutes from their measured record where available. Also write one short sentence introducing the plan. If key details are missing (destination or arrival time), ask — don't guess those two.

Style: warm, direct, concrete. 2-4 sentences for most answers; never more than ~120 words unless they ask for depth. No bullet lists unless they ask. No lectures. Attribute wins to them, not to the app. One actionable next step beats three insights.`;

const PLAN_TOOL: Anthropic.Tool = {
  name: "propose_plan",
  description:
    "Propose a concrete arrival plan Anchor can lock into a backward-planned timeline. Call this whenever the user expresses needing to be somewhere at a time. Use their measured medians for task minutes when the app_state has them; otherwise omit minutes and Anchor fills typical times.",
  input_schema: {
    type: "object",
    properties: {
      destination: { type: "string", description: "Where they're going, e.g. 'Airport'" },
      arrivalTime: {
        type: "string",
        description: "Required arrival time as 24h HH:MM local, e.g. '11:45'",
      },
      mode: {
        type: "string",
        enum: ["driving", "walking", "transit", "pickup", "pickingUp"],
        description:
          "driving = they drive; walking = on foot; transit = bus/train; pickup = someone picks them up; pickingUp = they pick someone up",
      },
      travelMinutes: {
        type: "number",
        description:
          "Estimated drive/walk/ride minutes. For driving/walking/pickingUp this is required; use their measured route median from app_state if present.",
      },
      transitDeparture: {
        type: "string",
        description: "Transit mode only: the vehicle's departure time as HH:MM",
      },
      pickupTime: {
        type: "string",
        description: "Pickup mode only: when the driver arrives, as HH:MM",
      },
      tasks: {
        type: "array",
        maxItems: 12,
        description:
          "Prep tasks before leaving, in order (max 12). Use taskIds from app_state's task list where they match; freeform labels otherwise. Empty array = they're leaving immediately, no prep.",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Task name, e.g. 'Shower'" },
            minutes: {
              type: "number",
              description: "Planned minutes; omit to let Anchor use the measured/typical time",
            },
          },
          required: ["label"],
          additionalProperties: false,
        },
      },
    },
    required: ["destination", "arrivalTime", "mode", "tasks"],
    additionalProperties: false,
  },
  strict: true,
};

const MODES = ["driving", "walking", "transit", "pickup", "pickingUp"];

/**
 * Trust nothing from the model layer. A malformed propose_plan payload
 * must never reach the client as a "plan" — the card would crash on it
 * and take the whole conversation down. Returns a clean CoachPlan or null.
 */
function normalizePlan(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null;
  const p = input as Record<string, unknown>;
  if (typeof p.destination !== "string" || !p.destination.trim()) return null;
  if (typeof p.arrivalTime !== "string" || !/^\d{1,2}:\d{2}$/.test(p.arrivalTime)) return null;
  if (typeof p.mode !== "string" || !MODES.includes(p.mode)) return null;
  const rawTasks = Array.isArray(p.tasks) ? p.tasks : [];
  const tasks = rawTasks
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map((t) => ({
      label: typeof t.label === "string" ? t.label.slice(0, 60) : "",
      minutes:
        typeof t.minutes === "number" && isFinite(t.minutes) && t.minutes > 0
          ? Math.min(600, Math.round(t.minutes))
          : undefined,
    }))
    .filter((t) => t.label.trim())
    .slice(0, 12);
  const num = (v: unknown) =>
    typeof v === "number" && isFinite(v) && v > 0 ? Math.min(1440, Math.round(v)) : undefined;
  const hhmm = (v: unknown) =>
    typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v) ? v : undefined;
  return {
    destination: p.destination.trim().slice(0, 80),
    arrivalTime: p.arrivalTime,
    mode: p.mode,
    travelMinutes: num(p.travelMinutes),
    transitDeparture: hhmm(p.transitDeparture),
    pickupTime: hhmm(p.pickupTime),
    tasks,
  };
}

export async function GET() {
  return NextResponse.json({ enabled: enabled() });
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

// Naive per-IP token bucket — the endpoint calls a paid model, so a public
// deployment needs a floor against runaway/abusive use. Process-memory only
// (best-effort on serverless); pair with platform rate limits for real DoS.
const BUCKET = new Map<string, { tokens: number; ts: number }>();
const RATE = { max: 12, refillPerSec: 12 / 60 };
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const b = BUCKET.get(ip) ?? { tokens: RATE.max, ts: now };
  b.tokens = Math.min(RATE.max, b.tokens + ((now - b.ts) / 1000) * RATE.refillPerSec);
  b.ts = now;
  if (b.tokens < 1) {
    BUCKET.set(ip, b);
    return true;
  }
  b.tokens -= 1;
  BUCKET.set(ip, b);
  return false;
}

export async function POST(req: Request) {
  if (!enabled()) {
    return NextResponse.json({ enabled: false }, { status: 503 });
  }
  // Same-origin only: this key-billed endpoint must not be a public proxy.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Slow down a moment — too many messages at once." },
      { status: 429 },
    );
  }
  let body: { messages?: ChatTurn[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const messages = body.messages;
  const totalChars = Array.isArray(messages)
    ? messages.reduce((n, m) => n + (typeof m?.content === "string" ? m.content.length : 0), 0)
    : 0;
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > 40 ||
    totalChars > 60_000 ||
    messages.some(
      (m) =>
        (m.role !== "user" && m.role !== "assistant") ||
        typeof m.content !== "string" ||
        m.content.length > 30_000,
    ) ||
    messages[0].role !== "user"
  ) {
    return NextResponse.json({ error: "invalid messages" }, { status: 400 });
  }

  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [PLAN_TOOL],
      messages,
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({
        reply: "That one's outside what I can help with — but I'm here for the time stuff.",
        plan: null,
      });
    }

    const reply = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const planBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "propose_plan",
    );
    const plan = planBlock ? normalizePlan(planBlock.input) : null;
    if (response.stop_reason === "max_tokens" && !reply && !plan) {
      return NextResponse.json({
        reply: "I lost my train of thought there — ask me again?",
        plan: null,
      });
    }
    return NextResponse.json({ reply, plan });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "Coach is catching its breath — try again in a minute." },
        { status: 429 },
      );
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "Coach isn't configured correctly." }, { status: 503 });
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: "Coach hit a snag — try again." }, { status: 502 });
    }
    return NextResponse.json({ error: "Coach is unreachable." }, { status: 502 });
  }
}
