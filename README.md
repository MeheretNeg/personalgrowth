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
    plan/             Trip wizard — guess-first estimates, 4 transit modes
    lock/             If-then chain + episodic future thinking
    execute/          One task, time-decay block, exit checklist
    debrief/          Arrival delta + cause attribution
    stats/            Clock score, arrival record, learned durations
    manifest.ts       Android PWA manifest
  components/
    time-decay.tsx    Spatial shrinking-block time display
    ui/               shadcn/ui primitives
  lib/
    engine.ts         Backward-planning math (pure, API-injectable later)
    calibration.ts    Personal medians, calibration score, error trend
    priors.ts         Research-based task duration priors + buffers
    store.ts          localStorage persistence
```

Data lives in localStorage (single-device). Phase 2: graduation-level automation, notification escalation. Phase 3: calendar pull, live traffic, NFC door tag (native wrapper).
