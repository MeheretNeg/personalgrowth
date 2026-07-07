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
   (driving / walking / transit / pickup / pickingUp)
3. step 2: mode details (drive or walk minutes / transit departure /
   pickup time). Drive and walk blocks carry taskId `drive:`/`walk:` +
   destination slug, so they're silently measured and learned per route.
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
- **Plan modes**: /plan step 3 has a Train-my-clock / Quick-plan toggle
  (persisted as settings.planMode, default "train"). Quick plan fills each
  task the moment its chip is tapped (personal median else p50) — no time
  inputs at all. Execute logs actuals for EVERY task (guessMinutes 0 when
  no guess), so medians keep learning; calibrationScore/errorTrend only
  count logs with guessMinutes > 0.
- **Standard-times escape hatch** (train mode only): in /plan step 3, "Use standard times"
  fills every un-guessed task with the personal median (source "your
  history") or the international-average p50 (source "typical"). Those
  tasks carry guessMinutes 0 and are excluded from calibration logging in
  /execute. The guess-first invariant doesn't apply to hatch-filled tasks
  (the user explicitly skipped the rep); the compare card still never
  appears for them.
- **Notifications**: grant with `context.grantPermissions(["notifications"])`.
  Cues prefer the service worker path — stub BOTH
  `ServiceWorkerRegistration.prototype.showNotification` and
  `window.Notification` via `addInitScript` to record calls. `/sw.js` must
  serve 200 with `Cache-Control: no-store` and reach state `activated`
  (`navigator.serviceWorker.ready`). Cues
  (heads-up ≤2 min before a step, missed-start/overtime nags every 3 min,
  door-critical on the final staging step) fire from `/execute`; L3 fires
  only final-staging cues, L4 none.
- **Behind-plan visibility**: /plan step 4 shows "N min behind" when the
  timeline starts in the past; /execute always shows the drift pill and a
  mono mm:ss countdown (block remaining when running, time-to-start when
  pending).

## Audit-round behaviors (Phase 5)

- **Planning numbers are p75**, not p50: quick plan/standards/"My usual"
  fill shower=15, get-dressed=15, brush=4 (prior.p75), or planningMinutes()
  (p75 of last 8 actuals) once 5+ measured. Medians remain display-only.
- **Logging guard**: execute only appendLogs blocks with ≥15s elapsed
  (fake-clock fastForward "00:20" inside each block when driving tests);
  logs now carry actualSeconds. calibrationScore/errorTrend exclude logs
  where max(guess, actual) < 5 min AND all guess-0 logs (scorableLogs).
- **Drift while running** = projected finish (startedAt + planned, or now)
  vs scheduled end — starting a late block never shows "ahead". Pending
  blocks >120 min out show a neutral "Starts much later" pill.
- **Graduation**: minLogs counts GUESSED reps only; demotion happens only
  on a debrief that was itself late (stepToward takes wasLate).
- **Debrief delta prefills** from trip.arrivedAt (capped ±120 min);
  steppers read "5 earlier"/"1 later". Skip-debrief link logs nothing.
- **Lock ritual**: dose is 20s normally, 5s when the timeline is already
  behind — match buttons with /start the \d+ seconds/i. Second half of the
  20s swaps to obstacle-naming copy (mental contrasting). Ritual completion
  and armed state persist on the trip (visualizedAt/armedAt) across reopen.
  arm() is async — wait for the waiting-room text after clicking.
- **Armed screen is honest**: without a verified push path it says keep
  the screen open / set an alarm instead of "You can close the app".
- **Travel guesses are blind**: the drive/walk median hint appears only
  AFTER a guess is typed; accepting "Plan with N min" stores
  driveGuessMinutes/walkGuessMinutes = 0 so the rep is unscored.
- **Midnight anchors roll back**: a transit departure/pickup time is always
  placed within 24h BEFORE the arrival (engine rollBeforeArrival).
- **Free solo** (/solo, unlocked at level ≥3, entry on home): destination +
  time only, delta measured from the arrive tap, saved as Debrief{solo}.
- **Execute extras**: "Already doing it — started ~2/5m ago" backdate
  buttons when past start; discard link (logs nothing); mm:ss digits hidden
  (~ ~ ~) on guessed blocks at level ≥2 (drain bar only).

## Psychological-loop features (Phase 4)

- **Lock gate**: the 20s visualization is enforced — click "Start the 20
  seconds", then `page.clock.fastForward("00:25")` before "Timeline
  locked — begin" appears. When the first block is >20 min away an
  "Arm it — wake me at HH:MM" option appears: trip stays phase "locked"
  (the waiting room shows a countdown + "Start now instead"), and push
  cues are synced for the locked phase too.
- **Replan from now**: on /execute, behind ≥3 min with prep remaining
  shows "Replan from now". Dialog lists remaining prep with tap-to-cut,
  live fits/over indicator (anchor never moves), confirm rebuilds
  remaining steps backward from the anchor and resets startedAt.
- **Rewards**: finishing a block under plan flashes "+N min banked" (5s);
  debrief + Pulse surface the on-time streak at ≥2.
- **Debrief loop-closer**: buildPushCues adds "Did you make it?" pushes at
  arrival +5/+25 (survive out-the-door; cleared on debrief). Debrief save
  schedules one evening plan-nudge cue (20:30 local) via syncCues.
- **Exit checklist** is editable (✎ chip on the final staging step),
  stored in settings.exitChecklist.

## Anchor Coach (conversational AI)

Gated on ANTHROPIC_API_KEY: `GET /api/coach` → {enabled}; POST 503s
without it and /coach shows a setup screen; the home entry hides. The
client sends chat turns with an `<app_state>` JSON block (calibration,
bias, medians, history, level) embedded in the FIRST user turn only
(keeps the server-side prompt cache stable). The model (claude-opus-4-8,
adaptive thinking, cached system prompt) may call the propose_plan tool;
the client's coachPlanToTrip() validates it and builds a locked Trip via
the same engine as the wizard (guessMinutes 0 = unscored quick-plan
semantics; travel taskIds get the drive:/walk: destination slug). Test by
stubbing `**/api/coach` with page.route — assert the app_state block is
present in the request and that "lock it" lands on /lock with a real
timeline. Debrief fires a best-effort one-turn insight request after save.

## Web push (closed-app cues)

Disabled without VAPID env keys (`/api/push/sync` → 503; client no-ops).
To test the send path end-to-end without a browser push service: generate
keys with `web-push`'s `generateVAPIDKeys()`, start the server with them
plus `PUSH_TICK_MS=1000`, then POST a fake subscription (endpoint →
a local HTTP listener; p256dh = base64url of an uncompressed P-256 public
key from `crypto.createECDH("prime256v1")`; auth = 16 random bytes
base64url) with one cue whose `at` is now. Within ~2s the listener gets a
POST with `content-encoding: aes128gcm` and a `vapid` Authorization
header. Cues with `at` in the past are dropped at build time by the
client but sent immediately by the server loop. State file: `.data/push.json`.

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
