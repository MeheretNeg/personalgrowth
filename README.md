# Anchor

A training gym for time blindness — not a crutch. Anchor backward-plans every arrival, trains your internal clock with guess-first estimation, measures reality silently, and fades its own support as you improve. **Early is the new on time.**

Built with [Next.js](https://nextjs.org), Tailwind CSS, and shadcn/ui. Installable on Android as a PWA.

## The loop

```
PLAN    backward from arrival (Park et al. 2017: backward planning wins)
LOCK    if-then commitment (Gollwitzer, d≈0.65) + 20s future visualization
EXECUTE one task visible, time-decay visual, everything else masked
DEBRIEF early/late by how much — and where the gap came from
LEARN   your measured medians replace research priors (planning-fallacy fix)
FADE    as calibration improves, the app does less — graduation is the goal
```

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). On an Android phone, open the deployed URL in Chrome → menu → **Add to Home screen** to install.

## Deploy on Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/MeheretNeg/personalgrowth)

Import `MeheretNeg/personalgrowth` at [vercel.com/new](https://vercel.com/new) — Next.js is auto-detected, every push to `main` deploys.

## Project structure

```
src/
  app/
    page.tsx          Pulse dashboard (single next-action card)
    plan/             Trip wizard — guess-first estimates, 5 transit modes
    lock/             If-then chain + episodic future thinking
    execute/          One task, countdown + time-decay block, drift pill
    debrief/          Arrival delta + cause attribution + level movement
    stats/            Clock score, arrival record, graduation progress
    manifest.ts       Android PWA manifest
  components/
    time-decay.tsx    Shrinking-block time display with mm:ss countdown
    ui/               shadcn/ui primitives
  lib/
    engine.ts         Backward-planning math (pure, API-injectable later)
    calibration.ts    Personal medians, calibration score, error trend
    graduation.ts     Earned levels, one-step movement, fade rules
    notify.ts         Escalating execution cues (heads-up → door-critical)
    priors.ts         Research-based task duration priors + buffers
    store.ts          localStorage persistence
```

Data lives in localStorage (single-device).

Phase 2 (shipped): graduation levels move automatically — earned from clock
score, measured-task count, and the on-time streak, one step per debrief in
either direction — and the app fades per level (L2 only flags far-off
guesses, L3 plans silently and guards the door, L4 is a scoreboard).
Notifications escalate during execution: heads-up → it's time → nags →
door-critical, with vibration; they fade with level too. A service worker
(`public/sw.js`) displays the cues system-natively (required on installed
Android PWAs), reopens the app on notification tap, and serves an offline
shell.

Phase 3 (push shipped): with VAPID keys set, cues fire even with the app
fully closed. The client re-posts its remaining schedule-anchored cues to
`/api/push/sync` on every trip transition; a server loop
(`src/lib/push-server.ts`, booted by `src/instrumentation.ts`) sends due
cues via Web Push, persisting state in `.data/push.json`. Setup:

```bash
npx web-push generate-vapid-keys
cp .env.example .env.local   # paste the keys in
```

Without keys the endpoint returns 503 and the client silently skips push —
in-page cues, vibration, and the screen wake-lock during execution still
cover the app-open case. Note: the send loop needs a persistent Node host
(any `next start` box); on serverless it only runs while an instance is
warm. Still Phase 3: calendar pull, live traffic, NFC door tag (native
wrapper).
