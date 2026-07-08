---
name: anchor-orientation
description: Zero-context onboarding to the Anchor codebase — what the app is, the training loop, file map, build/lint commands, doctrine at a glance, and which sibling skill to load for which task. Load this FIRST in any session touching this repo.
---

# Anchor orientation

## What this is

Anchor is a training gym for time blindness — not a crutch. It backward-plans
every arrival from the required time, makes the user guess task durations
BEFORE showing any reference number (guess-first), silently measures reality,
replaces research priors with personal medians, and then fades its own
scaffolding as measured calibration improves (graduation levels 1–4, earned,
never self-selected). Motto in code and copy: "Early is the new on time."
The end state is the user NOT needing the app.

The product loop (each phase is a route):

```
PLAN    /plan     backward from arrival; guess-first task estimates
LOCK    /lock     if-then commitments + 20s future visualization
EXECUTE /execute  one task visible, time-decay bar, escalating cues
DEBRIEF /debrief  early/late delta + cause attribution
LEARN   (silent)  measured medians replace priors (src/lib/calibration.ts)
FADE    (silent)  graduation levels; the app does less (src/lib/graduation.ts)
```

## Stack facts (verified against package.json / components.json)

| Fact | Value |
|---|---|
| Framework | Next.js **16.2.10**, App Router, Turbopack (default for dev AND build) |
| React | 19.2.4 |
| CSS | Tailwind 4 (`@tailwindcss/postcss`; no tailwind.config file) |
| UI kit | **Base UI** (`@base-ui/react`) via shadcn CLI, style `base-nova` in `components.json` — **NOT Radix**. Prop APIs differ (e.g. Accordion takes `multiple`, not `type="multiple"`) |
| Icons | lucide-react |
| Push | web-push (VAPID; optional — everything no-ops without keys) |
| Persistence | localStorage only, single device, no database, no auth |
| Target | Mobile-first, Android-installable PWA (max-w-md shell, 412×915 viewport) |
| Deploy | Vercel, every push to `main` deploys |

## Commands (all verified in this repo)

| Task | Command | Notes |
|---|---|---|
| Install | `npm install` | |
| Dev server | `npm run dev` | Turbopack; writes `.next/dev/` — dev and build can run concurrently |
| Build | `npm run build` | Includes the TypeScript check; must pass before claiming done |
| Lint | `npm run lint` | Runs `eslint` directly — **`next lint` is REMOVED in Next 16**; flat config in `eslint.config.mjs` |
| Serve prod | `npm run start` | |

There is **no test runner and no CI, on purpose**. Do NOT add jest/vitest
scaffolding as a "fix" — correctness is proven by headless-driving the real
app with a controlled clock. That harness is the `verify` skill
(`.claude/skills/verify/SKILL.md`); the broader QA method is the
`validation-and-qa` skill.

## File map

```
src/app/
  layout.tsx            The ONLY server component (fonts, Metadata, Viewport, <SwRegister/>)
  page.tsx              Pulse dashboard + dispatcher: routes into the page matching trip.phase
  plan/                 4-step trip wizard (guess-first estimates, 5 transit modes)
  lock/                 If-then chain + visualization ritual (20s; 5s when already behind at lock) + arm/waiting room
  execute/              One task visible, 1s tick, drift pill, replan-from-now, cues
  debrief/              Arrival delta + causes; steps settings.level via stepToward (solo/ is the only other level mutator)
  stats/                Read-only: clock score, arrival record, level progress, medians
  solo/                 Free solo (level ≥3): destination + time, no timeline; also steps settings.level on arrival
  manifest.ts           PWA manifest (MetadataRoute.Manifest, standalone, 3 icons)
  api/push/sync/route.ts POST-only; client re-posts its full cue schedule (503 without VAPID keys)
src/components/
  time-decay.tsx        Shrinking-block time display, mm:ss countdown, hideDigits mode
  voice-input.tsx       Web Speech API mic button (renders null when unsupported)
  sw-register.tsx       Registers /sw.js (updateViaCache: "none")
  ui/                   Base UI primitives (accordion, button, card, dialog, input, textarea)
src/lib/
  engine.ts             Backward-planning math. PURE: no UI, no storage imports
  calibration.ts        Personal medians, calibration score, error trend (LEARN)
  graduation.ts         Level thresholds, earnedLevel, stepToward (FADE)
  priors.ts             Research-based p50/p75 task priors + buffers
  notify.ts             In-page cue ladder (heads-up → door-critical), fades with level
  push-client.ts        Builds + posts push cue schedules to /api/push/sync
  push-server.ts        Send loop via web-push; state in .data/push.json
  store.ts              All localStorage reads/writes (keys prefixed anchor:)
  types.ts              Trip, TimelineStep, DurationLog, Debrief, Settings, TripPhase
  utils.ts              cn() only
src/instrumentation.ts  register() boots the push loop, gated on NEXT_RUNTIME === "nodejs"
public/sw.js            Notification display, offline shell, cache "anchor-v1"
next.config.ts          headers() for /sw.js only (no-cache + CSP). No webpack block — it would break Turbopack builds
```

Where truth lives: `src/lib/types.ts` is the data contract; `src/lib/store.ts`
is the only module that touches localStorage; a running browser's
localStorage is the only user state there is. Details in the
`data-model-and-storage` skill.

Every page and top-level component is `"use client"` except
`src/app/layout.tsx`; most `src/components/ui/` primitives omit the directive
(only `ui/dialog.tsx` carries it) and are only ever imported from client
components.

Hydration sentinels (`if (!ready) return null` mount-effect pattern) are
load-bearing — see the `ui-conventions` skill before touching them.

## The AGENTS.md rule (binding)

`AGENTS.md` at the repo root says: **this is not the Next.js you know.**
Next 16 has breaking changes vs training data (async-only params/cookies,
`next lint` removed, Turbopack default, `proxy.ts` replacing middleware,
fetch not cached by default, and more). Before writing any Next-touching
code, read the relevant guide under `node_modules/next/dist/docs/` — the
docs are bundled in the repo. The `nextjs-16-contract` skill is the
distilled trap list and doc index; load it for any framework-level work.

## Doctrine at a glance

These rules exist because breaking them silently corrupts the training data
or lies to the user. Do not "fix" them away. Only "verify by driving" is
owner-confirmed doctrine; the other rows are design principles evidenced in
code comments and commit history — treat them with the same care, but their
authority is the evidence, not an owner decree.

| Principle | Rule | Detail lives in |
|---|---|---|
| Verify by driving (owner-confirmed doctrine) | No unit-test framework. Prove changes by driving the built app headlessly with a controlled clock | `verify` (harness), `validation-and-qa` (method) |
| Guess-first sanctity | Priors/medians must never enter the DOM before the blind guess is locked (levels 1–2). `guessMinutes` 0 is the unscored sentinel — excluded from calibration | `calibration-and-graduation`, `ui-conventions` |
| Earned levels | Graduation moves ONE step per debrief toward the earned level; demotion only when that debrief was itself late (`stepToward` in `src/lib/graduation.ts`) | `calibration-and-graduation` |
| Honest copy | Never promise what isn't verified (e.g. "you can close the app" only after push sync succeeded). No shame or punishment framing | `ui-conventions`, `notification-pipeline` |
| Pure engine | `src/lib/engine.ts` imports no UI and no storage, so a live traffic/transit API can be injected later. The anchor (arrival) never moves on replan | `timeline-engine` |
| localStorage only | The training record lives on the device. No backend, no accounts, no server-side user state (the ephemeral push schedule is plumbing, not data). Adding a DB/sync is an owner-sign-off proposal, not a fix | `data-model-and-storage`, `architecture-contract` (inv. 13) |

Also intentional, not a bug: the eslint rule
`react-hooks/set-state-in-effect` is OFF (mount-effect localStorage
hydration on prerendered client pages requires it).

## Skill routing

| Your task | Load |
|---|---|
| Module boundaries, invariants, phase machine | `architecture-contract` |
| Timeline math, replan, midnight/DST handling | `timeline-engine` |
| Calibration score, medians, priors, level thresholds | `calibration-and-graduation` |
| Cues, service worker, web push, VAPID | `notification-pipeline` |
| localStorage schema, Trip/Settings shape, migration for existing installs | `data-model-and-storage` |
| Any UI/page work: hydration, copy tone, Tailwind/Base UI patterns | `ui-conventions` |
| Anything touching Next.js APIs, config, routes | `nextjs-16-contract` |
| Proving a change works (mandatory before "done") | `verify`, `validation-and-qa` |
| Something is broken; reproducing bugs | `debugging-playbook` |
| Why the code is weird here — past incidents and their fixes | `failure-archaeology` |
| Making a change safely: scope, review gates, what not to touch | `change-control` |
| Shipping: Vercel, PWA/SW update mechanics, env keys, rollback, public-release gaps | `release-and-deploy` |
| Improving the training science itself (owner's live priority) | `research-frontier` |

When in doubt: read `architecture-contract` next, then the skill nearest
your task. Cross-cutting changes (e.g. level gating spans page JSX,
`src/lib/notify.ts`, and `src/lib/push-client.ts`) usually need two or
three skills.

## Provenance & maintenance

- Distilled from: `README.md`, `AGENTS.md`, `package.json`,
  `components.json`, `next.config.ts`, `eslint.config.mjs`,
  `src/lib/types.ts`, `src/lib/store.ts`, `src/lib/*.ts` module headers,
  `src/instrumentation.ts`, `src/app/manifest.ts`,
  `src/app/api/push/sync/route.ts`, `.claude/skills/verify/SKILL.md`, and
  the repo file tree.
- Authored 2026-07-07; verified against HEAD `055b144`.
- Update this skill when: routes are added/removed under `src/app/`, modules
  are added/removed under `src/lib/`, npm scripts change, the Next.js major
  version changes, a database/backend replaces localStorage, or a new
  sibling skill joins the library (routing table).
- Re-verify core claims:
  1. `cat package.json` — versions and the four scripts (`lint` must still be bare `eslint`).
  2. `ls src/app src/lib src/components` — file map still matches.
  3. `npm run build && npm run lint` — both pass at the current HEAD.
