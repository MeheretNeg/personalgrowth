---
name: validation-and-qa
description: The QA doctrine for Anchor — per-subsystem validation matrix, localStorage fixture cookbook, and the pre-done invariant checklist; load before declaring any change verified, or when you need to seed app state for testing.
---

# Validation & QA

This skill defines WHAT to validate and HOW to seed state. The mechanics of
building, serving, and driving the app (Playwright setup, `page.clock`,
notification stubs, the fake push endpoint) live in the `verify` skill — read
it first and do not duplicate or contradict it here.

## Doctrine

1. **There is no unit-test framework, on purpose** (owner-confirmed). Do not
   add jest/vitest/playwright-test configs, `__tests__/` dirs, or a `test`
   npm script as a "fix". Correctness is proven by driving the production
   build (`npm run build` + `npm run start`) in headless Chromium with a
   controlled clock, per the `verify` skill.
2. **Pure-function spot checks are allowed — as throwaways.** `src/lib/engine.ts`,
   `src/lib/calibration.ts`, `src/lib/graduation.ts` are pure (no
   UI/storage imports), and so are `cueForStep` (`src/lib/notify.ts`) and
   `buildPushCues` (`src/lib/push-client.ts`). When a math change needs tight
   input/output checks, write a one-off node script in your session
   scratchpad that imports nothing from the DOM, run it, paste the output —
   then delete it. Never commit test files.
3. **Distrust past green claims.** PR #11 claimed "69/69 headless checks";
   those scripts were session-ephemeral and are NOT in the repo. Every
   verification run starts from zero.
4. Gate sequence for any change: `npm run build` (includes TS check) →
   `npm run lint` → drive the affected flows. See the `change-control` skill
   for the full procedure and per-area review checklists.

## Fixture cookbook — seeding localStorage

All state lives in localStorage under `anchor:*` (`src/lib/store.ts`,
`KEYS`). Seed via Playwright `page.addInitScript` (runs before app JS) or
`page.evaluate` + reload. Two warnings:

- `read()` in `store.ts` swallows JSON parse errors and returns the
  fallback — **a malformed fixture silently looks like a fresh install**.
  Always assert the seeded state actually rendered (e.g. the level badge,
  a log count on /stats) before testing behavior on top of it.
- Install the fake clock (`page.clock.install`) at a time consistent with
  your fixture's ISO timestamps, or drift/phase logic will contradict you.

| Key | Type (`src/lib/types.ts` / `store.ts`) | Notes |
|---|---|---|
| `anchor:trip` | `Trip \| null` | single active trip; phase machine |
| `anchor:logs` | `DurationLog[]` | append-only training record |
| `anchor:debriefs` | `Debrief[]` | append-only; drives streak/level |
| `anchor:settings` | `Settings` | default `{earlyBufferMinutes:10, level:1}` |
| `anchor:lastTasks` | `string[]` | powers "My usual" in /plan |
| `anchor:solo` | `SoloTrip \| null` | parallel machine, no phase |

### Fresh install
Remove all `anchor:*` keys (a new Playwright context is already clean).
Expect: home shows the plan CTA, no solo card, no streak banner; /stats has
no score.

### L2-eligible record (about to graduate)
Thresholds from `LEVELS` in `src/lib/graduation.ts`: level 2 = score ≥ 65,
10 guessed reps, streak ≥ 3. `calibrationScore` (`src/lib/calibration.ts`)
is `100 − mean |errorPct|` over the last 10 *scorable* logs; scorable =
`guessMinutes > 0 && max(guess, actual) ≥ 5` (`scorableLogs`). So:

```js
localStorage.setItem("anchor:logs", JSON.stringify(
  Array.from({ length: 10 }, (_, i) => ({
    taskId: "shower", guessMinutes: 10, actualMinutes: 12,
    at: new Date(Date.now() - (10 - i) * 864e5).toISOString(),
  }))));   // errorPct 20 each → score 80; 10 guessed reps
localStorage.setItem("anchor:debriefs", JSON.stringify(
  Array.from({ length: 3 }, (_, i) => ({
    tripId: "t" + i, destination: "Work", deltaMinutes: -2, causes: [],
    at: new Date(Date.now() - (3 - i) * 864e5).toISOString(),
  }))));   // streak 3 (onTimeStreak counts trailing delta ≤ 0)
```

This makes `earnedLevel()` return 2, but `settings.level` is still 1:
**levels only move via `stepToward` inside a debrief save** (one step per
debrief). Drive one more on-time debrief to see 1→2, or seed
`anchor:settings` `{"earlyBufferMinutes":10,"level":2}` directly when you
only need L2 *UI gating*, not the graduation step itself.

### L3 / L4
- UI gating only: seed `settings.level` 3 or 4 directly.
- Earned-level math: L3 = score ≥ 80 / 25 reps / streak 5; L4 = 90 / 50 / 10.
  Use guess 10 / actual 11 logs (errorPct 10 → score 90 satisfies both) and
  scale counts. Reps = ALL logs with `guessMinutes > 0` (`guessedReps`);
  score uses only the last 10 scorable.

### Trip fixtures (behind-schedule, armed, executing)
Prefer **capture-and-mutate** over hand-writing a `Trip`: drive /plan once
per the `verify` skill, dump `localStorage.getItem("anchor:trip")`, save it
in your scratchpad, then re-seed mutated copies. Required fields are in
`Trip` / `TimelineStep` (`src/lib/types.ts`); the home page (`src/app/page.tsx`)
routes by `trip.phase` and each page bounces to `/` on phase mismatch.
- **Behind schedule**: don't edit the JSON — install the fake clock LATER
  than `timeline[0].startsAt`. On /lock this flips `behindAtLock` and the
  dose drops to 5s (`doseSeconds`, `src/app/lock/page.tsx`); on /execute the
  drift pill shows behind.
- **Armed**: phase `"locked"` + `armedAt` set (waiting room survives reopen).
  To produce it live, the first step must start > 20 min out (see the
  `verify` skill, "Lock gate").
- **Executing**: phase `"executing"`, `currentStepIndex` 0, clock at/near
  `timeline[0].startsAt`.

### Solo active
`anchor:solo` = `{"destination":"Gym","arrivalTime":"<ISO future>","startedAt":"<ISO now>"}`
(`SoloTrip`, `src/lib/store.ts`). Leave `anchor:trip` null — solo is a
parallel machine and never touches it.

## Per-subsystem validation matrix

Drive with the `verify` skill's harness; assert at least these per area.

| Subsystem | Must hold |
|---|---|
| /plan | Guess-first: the prior ("Typical person: N min") is NOT in the DOM before the guess is locked (L1–L2). L≥3: button reads "Lock it in" and no prior EVER renders (`src/app/plan/page.tsx`, `lockGuess`). L2 auto-accepts within `COACH_FLAG_THRESHOLD` 0.4 of median/prior — no compare card. `unplannedCount > 0` blocks step advance (no silent zero-minute task). |
| /lock | Dose = 20s, 5s when `behindAtLock`; the begin button stays hidden until the countdown elapses. `visualizedAt` persists once and is NOT re-enforced on reopen (the persist effect in `src/app/lock/page.tsx` bails on `trip.visualizedAt`). |
| /execute | `finish()` logs only when `startedAt && taskId && elapsedSec ≥ 15`, and writes `actualSeconds`. Drift is projected (late start never shows "ahead"); pending ≤ −120 min shows the neutral pill. "Replan from now" appears only when behind ≥ 3 min with prep remaining (`canReplan`); confirm keeps the anchor fixed. Cues fire and dedupe per the `verify` skill's Notifications section. |
| /debrief | Delta prefills from `arrivedAt` only when \|measured\| ≤ 120 min. `save()` runs `stepToward(level, earnedLevel(...), delta > 0)` — exactly one level step, demotion only if THIS debrief was late. Save schedules the 20:30 plan-nudge via `syncCues([planNudgeCue(...)])`. Skip logs nothing. |
| /stats | Score matches `calibrationScore` of seeded logs. Bias line renders only when \|`meanSignedErrorPct`\| ≥ 10; positive bias ("guess short") uses the destructive color. `levelProgress` have/need matches `LEVELS` thresholds. |
| /solo | Home entry card renders only at `level ≥ 3` (`src/app/page.tsx`); the /solo route itself is NOT gated (known gap — don't "fix" it silently, flag it). Arrive writes a `Debrief{solo:true}` and runs the same `stepToward`. |
| Push API | No VAPID env: `POST /api/push/sync` → 503 `{enabled:false}`. With keys: 200 `{enabled:true, scheduled:n}`; bad JSON / missing endpoint / invalid cues → 400 (`src/app/api/push/sync/route.ts`). End-to-end send: fake-endpoint recipe in the `verify` skill, "Web push". |
| SW / PWA | `GET /manifest.webmanifest` → 200 (3 icons, standalone). `/sw.js` → 200 with `Cache-Control: no-store` and reaches state `activated` (`navigator.serviceWorker.ready`). |

## Invariant checklist — run before declaring done

Binary checks; a change is "done" only when every row touched by it passes.
Column 2 is the how (verify-skill section or one-line assertion).

1. `npm run build` exits 0 — build gate (includes TS check).
2. `npm run lint` exits 0.
3. Fresh context: `GET /` 200 and the Pulse renders (no hydration blank).
4. Prior text absent from /plan DOM pre-lock at L1 — verify skill, step 4.
5. L≥3 /plan shows "Lock it in", no compare card — verify skill, Phase 2.
6. Lock dose enforced: begin button absent until 20s (5s behind) elapses —
   verify skill, "Lock gate".
7. Sub-15s block leaves `anchor:logs` unchanged; ≥15s block appends a log
   with `actualSeconds` — read localStorage after each finish.
8. Late-started block never shows an "ahead" drift pill on /execute.
9. Replan keeps the anchor: last `timeline` step's `startsAt` identical
   before/after confirm.
10. One on-time debrief on an L2-eligible record moves `settings.level`
    1→2; a LATE debrief with earned < current moves it down exactly 1;
    an on-time debrief never demotes (`stepToward`).
11. Debrief prefill ignores \|delta\| > 120 min (steppers start at 0).
12. Cue stubs record ≥1 call when fast-forwarding into a step window at
    L1–L2; ZERO calls at L4 — verify skill, Notifications.
13. `/api/push/sync` returns 503 without VAPID keys, 200 with them.
14. Exit paths (discard, out-the-door → debrief) call `clearPushSchedule` —
    after exit, a sync-inspecting stub or `.data/push.json` shows no stale
    cues for the trip.
15. `/manifest.webmanifest` 200 and `/sw.js` 200 + `no-store` + activated.

## Honest reporting

- **The fake clock is not airtight.** `page.clock.install` lets real time
  flow while your script executes, so logged `actualMinutes`/`actualSeconds`
  drift by a few seconds past what you fast-forwarded. Assert
  approximately (ranges or ±1 min), never exact equality on durations.
- **Never report a check as passing without having run it in this
  session.** Paste the actual command output / assertion results. If a
  check was skipped (e.g. no VAPID keys available for the push send path),
  say "not run" — do not fold it into a green summary.
- Report per-check, not in aggregate: "checks 1–11, 15 pass; 12–14 not run
  (no notification stubs wired)" is honest; "all good" is not.
- If a check fails, the failure output belongs in the report verbatim.
  See the `debugging-playbook` skill to diagnose, and the
  `failure-archaeology` skill before touching calibration/graduation math.

## Provenance & maintenance

- Distilled from: `.claude/skills/verify/SKILL.md`, `src/lib/types.ts`,
  `src/lib/store.ts`, `src/lib/graduation.ts`, `src/lib/calibration.ts`,
  `src/app/plan/page.tsx`, `src/app/lock/page.tsx`,
  `src/app/execute/page.tsx`, `src/app/debrief/page.tsx`,
  `src/app/stats/page.tsx`, `src/app/solo/page.tsx`, `src/app/page.tsx`,
  `src/app/api/push/sync/route.ts`; owner interview 2026-07-07 (no-unit-test
  doctrine).
- Authored 2026-07-07, verified against HEAD `055b144`.
- Update this skill when any of these change: `LEVELS` thresholds or
  `stepToward` semantics (`graduation.ts`); `scorableLogs`/`calibrationScore`
  rules (`calibration.ts`); localStorage keys or shapes
  (`store.ts`/`types.ts`); the 15s logging guard or replan gate
  (`execute/page.tsx`); dose seconds (`lock/page.tsx`); prefill bound or
  plan-nudge (`debrief/page.tsx`); push sync status codes (`route.ts`);
  or anything in the `verify` skill this file cross-references.
- Re-verify core claims:
  1. `grep -n "minScore\|minLogs\|minStreak" src/lib/graduation.ts` — L2/3/4
     thresholds still 65/10/3, 80/25/5, 90/50/10.
  2. `grep -n "elapsedSec >= 15\|doseSeconds\|<= 120" src/app/execute/page.tsx src/app/lock/page.tsx src/app/debrief/page.tsx` — guards unchanged.
  3. `npm run build && npm run lint` — gates still work.
