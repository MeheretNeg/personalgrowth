---
name: calibration-and-graduation
description: The learning system end-to-end — what gets logged, how the clock score is computed, how graduation levels move, and the data-integrity rules for tuning any of it. Load BEFORE changing calibration math, level thresholds, logging, or anything that feeds them.
---

# Calibration & graduation — the learning system

This is THE priority area of Anchor (owner: training science). The whole app exists to
train one number — the calibration score — and to fade itself as that number climbs.
Every rule below protects the honesty of the training record. Read `anchor-orientation`
first if you don't know what Anchor is; check `architecture-contract` before merging.

Two pure modules hold all the math: `src/lib/calibration.ts` and `src/lib/graduation.ts`.
Neither touches storage or the DOM — pages pass in `loadLogs()` / `loadDebriefs()` arrays.

## 1. What gets logged (the raw material)

`DurationLog` (`src/lib/types.ts`): `{ taskId, guessMinutes, actualMinutes, actualSeconds?, at }`.
Written by exactly one call site: `finish()` in `src/app/execute/page.tsx`, which appends
`{ taskId, guessMinutes: guess ?? 0, actualMinutes: Math.max(1, Math.round(elapsedSec/60)), actualSeconds: Math.round(elapsedSec), at }`
via `appendLog` (`src/lib/store.ts`, key `anchor:logs`, append-only) — but ONLY when all
three hold: `current.startedAt && current.taskId && elapsedSec >= 15`.

- **The 15-second guard**: sub-15s finishes are someone clicking through, not doing the
  task. Logging them would poison medians. Never weaken this.
- **The guess sentinel**: `guessFor()` (`src/app/execute/page.tsx`) returns the user's
  BLIND guess or `null`. `guessMinutes: 0` in a log means "no blind guess existed"
  (quick plan, "Use standard times", or an accepted suggestion). Zero-guess logs still
  feed medians (reality is always measured) but must never be scored as calibration reps.
- **Travel logs**: `lock()` in `src/app/plan/page.tsx` rewrites travel step taskIds to
  `drive:<slug>` / `walk:<slug>` (slug of destination) so each route learns separately.
  `guessFor()` reads `transit.driveGuessMinutes ?? driveMinutes` / `walkGuessMinutes ??
  walkMinutes` for those prefixes — if the guess field is ABSENT (it is optional in
  `TransitDetails`), the PLANNED minutes score as a blind guess. Plan sets the guess field
  to 0 when the user accepted the median suggestion (`driveSuggested` / `walkSuggested`) —
  accepting a suggestion is planning, not estimating. Fixture warning (§7): hand-built
  `anchor:trip` fixtures must set the guess field to 0 to mean "no rep", not omit it.
- Debrief **Skip**, Execute **discard**, and Solo **abandon** log nothing, by design.
- `Debrief` records (`appendDebrief`, key `anchor:debriefs`, append-only) carry
  `deltaMinutes` (negative = early), `causes`, optional `solo: true`.

## 2. Scoring (`src/lib/calibration.ts`)

| Function | Formula (verified) | Window / gate |
|---|---|---|
| `scorableLogs()` | `guessMinutes > 0 && Math.max(guessMinutes, actualMinutes) >= 5` | filters everything below |
| `estimationErrorPct(g, a)` | `round((a − g) / g × 100)`; `g <= 0` → 100. Positive = guessed short | per log |
| `calibrationScore()` | `max(0, round(100 − mean |error%|))` over last 10 scorable logs; `null` if none scorable | window 10 |
| `meanSignedErrorPct()` | rounded mean signed error% over last 10 scorable; `null` if < 3 scorable | window 10, min 3 |
| `errorTrend()` | last 14 scorable logs as `{at, errorPct}`, oldest first | window 14 |

Why the ≥5-minute gate in `scorableLogs`: whole-minute rounding makes short tasks pure
quantization noise — a 2-minute task measured at 1:20 rounds to ±50% "error" that says
nothing about the user's clock. `actualSeconds` exists on newer logs for the same reason.

Stats (`src/app/stats/page.tsx`) shows the bias line only when `|meanSignedErrorPct| >= 10`;
positive bias ("you guess short") renders destructive — it is the time-blindness signature.

## 3. Planning numbers — median vs p75

Both need `MIN_LOGS_FOR_HISTORY = 5` logs for the task, else `null`:

- `personalMedian(logs, taskId)` — median of the last 5 `actualMinutes`. The DISPLAY and
  calibration reference: Plan's compare card ("You, measured: Nm"), the L2 coach
  reference, travel suggestions, and the Stats "really takes Nm" list.
- `planningMinutes(logs, taskId)` — ~p75 of the last 8 actuals
  (`idx = min(len−1, ceil(0.75·len)−1)` on the sorted slice). What plans are BUILT from:
  `standardFor()` / `standardMinutes()` / "Trust my record" in `src/app/plan/page.tsx`,
  falling back to the population prior's `p75` (`src/lib/priors.ts`, `getPrior`).

Why two numbers: durations are right-skewed, so planning at the median gives ~50% overrun
odds per task — the planning fallacy itself. Median tells the truth about the past; p75
buys buffer for the future. Do not "simplify" them into one.

## 4. Graduation (`src/lib/graduation.ts`)

`LEVELS` (`minScore` / `minLogs` / `minStreak`):

| Level | Name | Score | Guessed reps | On-time streak |
|---|---|---|---|---|
| 1 | Scaffold | 0 | 0 | 0 |
| 2 | Coach | 65 | 10 | 3 |
| 3 | Solo | 80 | 25 | 5 |
| 4 | Graduated | 90 | 50 | 10 |

- `earnedLevel(logs, debriefs)`: three-gate AND — `calibrationScore(logs) ?? 0`,
  `guessedReps` (count of logs with `guessMinutes > 0` — note: NOT the ≥5-min scorable
  filter; short guessed logs count as reps but not toward the score), and
  `onTimeStreak(debriefs)` (consecutive most-recent debriefs with `deltaMinutes <= 0`;
  any `> 0` breaks it). Returns the highest level whose all three thresholds are met.
- `stepToward(current, earned, wasLate)`: `earned > current` → `current + 1`;
  `earned < current && wasLate` → `current − 1`; else unchanged. One step per debrief,
  and demotion ONLY when that debrief was itself late (`wasLate = delta > 0`, strictly).
  This gate is the anti-punishment-spiral invariant: without it, one late day zeroes the
  streak and the next on-time debriefs cascade a graduate 4→1. Never change `>` to `>=`.
- `levelProgress(logs, debriefs, current)`: the have/need items Stats renders; `null` at 4.
- Exactly TWO mutation sites for `settings.level`:
  `save()` in `src/app/debrief/page.tsx` and `arrived()` in `src/app/solo/page.tsx` —
  both call `stepToward(settings.level, earnedLevel(loadLogs(), debriefs), delta > 0)`
  and `saveSettings` only on change. Never add a third site or a self-select path.

## 5. What each level changes (enforcement is spread out — keep layers in sync)

| Consumer | Behavior |
|---|---|
| `lockGuess()` in `src/app/plan/page.tsx` | L1: always reveal the compare card. L2: silently accept a guess within `COACH_FLAG_THRESHOLD = 0.4` of `personalMedian ?? prior.p50`, else reveal. L3+: the guess IS the plan ("Lock it in", no compare). Plan also hides the travel median block at `level >= 3`. |
| `src/app/execute/page.tsx` | `TimeDecay hideDigits` when `level >= 2 && guessFor(trip, step) !== null` — digits fade once the block had a blind guess. |
| `cueForStep()` in `src/lib/notify.ts` | L4: no cues at all. L3: only the final-staging leave-door guard. L1–2: full ladder. (`buildPushCues` in `src/lib/push-client.ts` mirrors this — see `notification-pipeline`.) |
| `src/app/page.tsx` (home) | Free-solo entry card only at `level >= 3`. Known gap: `/solo` route itself is NOT gated. |

Full invariant list lives in `architecture-contract`; level gating spans these layers and
they can drift — change all together.

## 6. Data-integrity rules when tuning (binding)

1. Never let a `guessMinutes: 0` log into scoring or `guessedReps`. The sentinel means
   "no rep happened"; scoring it either gifts or punishes reps that were never taken.
2. Never reset `startedAt` of a running block. `rebuildRemaining()` in `src/lib/engine.ts`
   deliberately preserves it for the in-flight step (`kept[i] === remaining[0]`) —
   resetting would re-log a 15-minute shower as 2 minutes and bias medians short.
   The backdate buttons in Execute (`start(2|5)`) exist for the same honesty reason.
3. `anchor:logs` and `anchor:debriefs` are append-only (`appendLog`/`appendDebrief` in
   `src/lib/store.ts`; no clearers exist). Do not add deletion, editing, or "cleanup".
4. Keep `wasLate` strictly `delta > 0` and `onTimeStreak` breaking strictly on `> 0`
   ("early is the new on time"; delta 0 is on time).
5. Levels are earned, never self-selected. No settings UI for `level`, no dev shortcut
   left in shipped code.
6. Changing ANY threshold, window, or filter (`LEVELS`, score window 10, `scorableLogs`
   ≥5-min gate, `MIN_LOGS_FOR_HISTORY`, p75 window 8, `COACH_FLAG_THRESHOLD`) changes
   user-visible level movement and planning numbers. Aiming for public release: existing
   installs carry real records in localStorage — a threshold change can silently demote a
   real user on their next debrief. Write down the intended effect ("users with X record
   should now land at level Y") BEFORE coding, then prove it per §7.
7. Schema changes to `DurationLog`/`Debrief` must be backward-compatible with logs already
   in the field (pattern: `actualSeconds` was added optional). See `data-model-and-storage`.

## 7. How to evaluate a proposed tuning change

There is no unit-test framework, on purpose — correctness is proven by driving the real
app (`verify` skill is the canonical harness; `validation-and-qa` has the fixture cookbook).

1. **Compute by hand first.** Build 2–3 small log/debrief arrays on paper and run the
   formulas above manually: expected `calibrationScore`, `earnedLevel`, and the level
   after one `stepToward`. Include edge fixtures: a `guessMinutes: 0` log (must not score),
   a 2-minute log (must not score), a late debrief after an on-time one (streak resets,
   no demotion on the on-time day).
2. **Seed fixtures.** Per the `verify` skill, inject `anchor:logs` / `anchor:debriefs` /
   `anchor:settings` into localStorage before load.
3. **Drive before/after.** On the current code, drive to `/stats` and record score,
   bias, and levelProgress have/need; then drive a debrief save and record the level
   transition. Apply the change; repeat with the SAME fixtures; diff against your
   hand-computed expectations. Any unexplained difference is a bug in the change.
4. Run `npm run build` and `npm run lint` before calling it done (see `change-control`).

## Provenance & maintenance

- Distilled from: `src/lib/calibration.ts`, `src/lib/graduation.ts`, `src/lib/types.ts`,
  `src/lib/store.ts`, `src/lib/engine.ts` (`rebuildRemaining`), `src/lib/notify.ts`
  (`cueForStep`), and pages `src/app/{execute,debrief,plan,stats,solo,page}.tsx`.
- Authored 2026-07-07, verified against HEAD `055b144`.
- Update this skill when any of these change: `LEVELS` thresholds, any window/filter in
  `calibration.ts` (`scorableLogs`, windows 10/14, `MIN_LOGS_FOR_HISTORY`, p75 slice),
  `stepToward`/`earnedLevel` logic, `guessFor()`/`finish()` logging in Execute, the
  `settings.level` mutation sites, or the per-level behavior table in §5.
- Re-verify core claims:
  1. `grep -n "minScore\|minLogs\|minStreak" src/lib/graduation.ts` — thresholds in §4.
  2. `grep -n "guessMinutes > 0\|>= 5\|slice(-" src/lib/calibration.ts` — filters/windows in §2–3.
  3. `grep -rn "stepToward(" src/app` — must list exactly debrief and solo pages.
