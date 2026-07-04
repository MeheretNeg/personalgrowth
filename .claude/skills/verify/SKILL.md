---
name: verify
description: Build, run, and drive the Anchor time-blindness trainer end-to-end in a headless browser with a controlled clock.
---

# Verify Anchor

## Build and run

```bash
npm install
npm run build                      # must pass TypeScript check
npm run lint
npm run start -- --port 3100 &     # serve the production build
curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/   # expect 200
```

## Drive the surface

Use Playwright with the pre-installed Chromium
(`executablePath: '/opt/pw-browsers/chromium'`; do NOT run
`playwright install`). Install the `playwright` npm package next to your
driver script, not in the repo. Use a mobile viewport (412×915) — the app
is mobile-first.

**Control time**: `await page.clock.install({ time: new Date("...") })`
before `goto`, then `page.clock.fastForward("MM:SS")` to burn through
task blocks. Note: install still lets real time flow during script
execution, so actual logged durations drift by a few seconds — assert
approximately.

The full loop to drive (all state in localStorage, no backend):

1. `/` Pulse → "Plan my next arrival"
2. `/plan` step 1: destination, arrival `input[type=time]`, mode button
3. step 2: mode details (drive minutes / transit departure / pickup time)
4. step 3: guess-first tasks — select chip → fill minutes → "Lock my
   guess & compare" → choose Keep/Safe/history. IMPORTANT INVARIANT: the
   prior ("Typical person: N min") must NOT be in the DOM before the
   guess is locked.
5. step 4: review timeline → "Lock timeline"
6. `/lock`: if-then lines → "I saw it" → "Timeline locked — begin"
7. `/execute`: per step "Start" → fastForward → "Done — next". Final
   staging step shows the exit checklist and an "Out the door" button.
   Fast-forwarding past the planned block must flip the decay bar to the
   overtime state ("N min over — wrap it up").
8. "Anchor dropped." → "I've arrived — debrief"
9. `/debrief`: −5/−1/+1/+5 delta steppers, cause chips, "Save the lesson"
10. `/stats`: clock score /100, arrival record, learned-task rows
11. `GET /manifest.webmanifest` → 200, 3 icons, display standalone

## Phase 2 behaviors

- **Graduation**: `anchor:settings` holds `{level: 1..4}`. Levels move ONE
  step per debrief toward the earned level (`src/lib/graduation.ts`
  thresholds). Seed `anchor:logs` / `anchor:debriefs` in localStorage to
  test: 10+ logs with ≤35% error + 3 on-time debriefs → level 2 after the
  next debrief. A late debrief (delta > 0) resets the streak and steps the
  level back down.
- **Level fading in /plan step 3 (tasks)**: L1 always shows the compare
  card after "Lock my guess & compare". L2 auto-accepts guesses within 40%
  of median/prior (no compare card). L3+ button reads "Lock it in" and NO
  prior ever enters the DOM. The guess-first invariant only applies at L1/L2.
- **Notifications**: grant with `context.grantPermissions(["notifications"])`
  and stub `window.Notification` via `addInitScript` to record calls. Cues
  (heads-up ≤2 min before a step, missed-start/overtime nags every 3 min,
  door-critical on the final staging step) fire from `/execute`; L3 fires
  only final-staging cues, L4 none.
- **Behind-plan visibility**: /plan step 4 shows "N min behind" when the
  timeline starts in the past; /execute always shows the drift pill and a
  mono mm:ss countdown (block remaining when running, time-to-start when
  pending).

## Gotchas

- Playwright `browser.newPage()` per call = isolated localStorage; use one
  context to simulate tabs.
- shadcn/ui here is Base UI (`@base-ui/react`), not Radix — Accordion
  takes `multiple`, not `type="multiple"`.
- The eslint rule `react-hooks/set-state-in-effect` is intentionally off:
  localStorage reads happen in mount effects (hydration-safe for
  prerendered pages).
- The time-decay bar animates height over 1s; screenshots right after
  fastForward catch it mid-transition.
