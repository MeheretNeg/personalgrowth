---
name: research-frontier
description: The training-science foundation of Anchor — which psychological mechanism lives where in the code, what is and is not evidenced, and the method for advancing the science without corrupting the training data. Load before changing any mechanism dose, threshold, prior, or claim, or when designing the next training-science experiment.
---

# Research frontier

Anchor's product claim is a scientific claim: that a scaffolded plan→guess→
measure→debrief→fade loop trains a time-blind person's internal clock. This
skill maps every mechanism to its research basis and its exact code location,
states plainly what is NOT yet evidenced, and gives the method for pushing the
science forward. Training science is the owner's top priority — treat this
file as the map of where the real work is.

## Mechanism → research → code

Every row below is verified against the code. When you change a mechanism,
update the corresponding code location AND re-check this table.

| Mechanism | Research basis (as cited in repo) | Code location |
|---|---|---|
| Backward planning | Park et al. 2017: planning in reverse from the goal outperforms forward planning (header of `src/lib/engine.ts`; README "The loop") | `buildTimeline()` in `src/lib/engine.ts` — walks backward from the anchor; `rebuildRemaining()` replans against the SAME anchor |
| Implementation intentions | Gollwitzer, d≈0.65 (README; comment atop the `Lock` component) | `ifThen` strings ("When the HH:MM alert fires, then I …") generated in `buildTimeline()` / `rebuildRemaining()` (`src/lib/engine.ts`); read aloud on `src/app/lock/page.tsx` ("Read each line. Mean it.") |
| Episodic future thinking + mental contrasting | Oettingen: vivid future + naming the obstacle; positive fantasy alone hurts attainment (comment atop `Lock`) | `src/app/lock/page.tsx`: enforced dose `doseSeconds = behindAtLock ? 5 : 20`; second half (`secondsLeft <= doseSeconds / 2`) switches copy to obstacle-naming; recurring late-cause injects a countermeasure if-then (`COUNTERMEASURES` + `topLeak`, needs the same cause ≥2 times in the last 5 late debriefs) |
| Reference-class forecasting (planning-fallacy fix) | Planning-fallacy literature: people can't self-correct from gut feel; they need a reference class (header of `src/lib/priors.ts`; commit cea6b68) | `TASK_PRIORS` p50/p75 in `src/lib/priors.ts`; `personalMedian()` (needs `MIN_LOGS_FOR_HISTORY = 5`, median of last 5) and `planningMinutes()` (~p75 of last 8 actuals — durations are right-skewed, so planning at p50 means ~50% overrun odds) in `src/lib/calibration.ts` |
| Guess-first calibration training | Blind estimate before any reference number — the guess IS the rep | `src/app/plan/page.tsx`: prior/median rendered only after "Lock my guess & compare"; travel guesses blind too ("the record only appears AFTER a guess exists"); scored via `scorableLogs()` in `src/lib/calibration.ts` (`guessMinutes > 0` AND `max(guess, actual) >= 5` — shorter tasks are quantization noise) |
| Graduated scaffolding fade | Scaffold-and-fade: support is removed as measured skill rises, never self-selected | `src/lib/graduation.ts`: `LEVELS` (L2: score 65/10 reps/streak 3; L3: 80/25/5; L4: 90/50/10), `earnedLevel()`, `stepToward()` (one step per debrief; demotion ONLY on a debrief that was itself late), `guessedReps()` (quick-plan logs feed medians, not levels) |
| Prospective memory support | Prospective memory is the deficit being trained (comment on `planNudgeCue`; commit e2cb264) | `src/lib/push-client.ts`: `planNudgeCue()` — one 20:30 evening nudge after each debrief; `buildPushCues()` — "Did you make it?" loop-closers at arrival +5 and +25 min so the LEARN phase survives the app never being reopened |
| Honest outcome measurement | The record that drives levels must not rest on an honor-system dial defaulting to "on time" (commit d1028f0) | `src/app/debrief/page.tsx`: delta prefilled from the measured `arrivedAt` tap (accepted when \|measured\| ≤ 120 min, still editable); `src/app/solo/page.tsx` `arrived()`: delta computed directly from the tap, no dial at all |

Doses and thresholds in this table (20s/5s, ≥5-min scorability, level gates,
+5/+25, 20:30) are design choices anchored to the cited literature's
direction, not to a specific validated number. Changing them is legitimate
science work — but follow the method below.

## What is NOT evidenced — say this plainly

The core claim — that this loop transfers to un-cued, real-world timeliness —
is a **hypothesis, not a demonstrated result**. No study of Anchor exists.
The individual mechanisms have literature behind them (in their original lab
and field contexts); their composition into this loop, on this population,
via a PWA, does not. The app is honest about this internally (it measures
instead of promising) and every piece of user-facing copy must stay honest
about it too: never write "proven", "clinically shown", or "guaranteed" about
the loop itself. This is a public-release product; strangers will read the
copy literally. See the `ui-conventions` skill for voice rules.

Commit d1028f0 (the 26-agent audit) named "training validity (the product's
core claim)" as its own workstream — that framing is correct and permanent.

## Measurement assets already in the data

The append-only records are the experiment. Do not add analytics
infrastructure before exhausting what is already logged:

- `appendLog()` / `appendDebrief()` in `src/lib/store.ts` never overwrite —
  the full history is available for before/after analysis on-device.
- `DurationLog` (`src/lib/types.ts`): `guessMinutes` (0 = unscored sentinel),
  `actualMinutes`, `actualSeconds` (newer logs), timestamp.
- `errorTrend()`, `calibrationScore()`, `meanSignedErrorPct()` in
  `src/lib/calibration.ts`: improvement-over-time, the trained metric, and
  the signed bias (positive = guesses short — the time-blindness signature).
- `onTimeRate()` / `onTimeStreak()` in `src/lib/graduation.ts`: outcome rate.
- `Debrief.solo: true` marks free-solo trips — **free solo
  (`src/app/solo/page.tsx`, Level 3+) is the built-in transfer probe**:
  destination and required time only, no timeline, no cues, delta measured
  from the arrive tap. Solo debriefs vs scaffolded debriefs over time is the
  closest thing to a transfer measurement the data already supports.

### Getting the record out for analysis

There is no export UI. To analyze real distributions (e.g. validating the
`LEVELS` gates), extract the record manually:

1. **Desktop browser:** DevTools console on the app origin →
   `copy(localStorage.getItem("anchor:logs"))` (same for `anchor:debriefs`,
   `anchor:settings`) — the JSON is now on the clipboard.
2. **Installed Android PWA:** enable USB debugging on the phone, open
   `chrome://inspect#devices` on a desktop Chrome, inspect the PWA's window,
   then run the same console command.
3. **Analyze** with throwaway Node scripts in your scratchpad that import
   nothing from the app — re-implement or copy the pure formulas from
   `src/lib/calibration.ts` / `src/lib/graduation.ts` against the exported
   JSON. Never commit analysis scripts (verify-by-driving doctrine — see
   `validation-and-qa`).

A user-facing export/backup feature is a legitimate frontier candidate
(it is also a public-release gap — see `release-and-deploy`), but it must
follow the schema rules in `data-model-and-storage` and honest-copy review.

## Frontier directions (SPECULATIVE — none of this exists in code)

Each of these is a legitimate next experiment. Each must go through the
method in the next section before a line of code changes.

1. **Adaptive difficulty** — bias task selection/prompting toward the tasks
   where the per-task error is worst (the data per `taskId` already exists in
   the logs; nothing consumes it for targeting yet).
2. **Spacing/consolidation** — the plan nudge is a single one-shot cue
   scheduled once per debrief, always at the next 20:30, regardless of the
   record; spaced-practice literature suggests rep scheduling could adapt to
   consolidation rather than pure recency.
3. **Per-context priors** — `personalMedian()` pools the last 5 logs per
   task across all contexts; morning-shower vs evening-shower, weekday vs
   weekend medians may differ.
   Requires more logs per cell — check `MIN_LOGS_FOR_HISTORY` math first.
4. **Bias-corrected planning** — `meanSignedErrorPct()` is computed and
   displayed but never applied; a measured "+30% short" bias could adjust
   planning numbers directly. Danger: must never leak into the guess-first
   flow (see invariants below).
5. **Transfer measurement design** — a deliberate solo-rate vs
   scaffolded-rate comparison over time, surfaced on stats. The `solo` flag
   makes this a pure read-side feature.
6. **Graduation-threshold validation** — the `LEVELS` gates (65/80/90 score,
   10/25/50 reps, 3/5/10 streak) are designed, not fitted. Real distributions
   of clock scores could validate or move them.

Phase-3 feature ideas (calendar pull, live traffic, NFC door tag — README)
are explicitly secondary to the above per the owner.

## The method for any science change

Follow all five steps, in order. Skipping step 2 is how training data gets
silently corrupted — one of the four documented failure classes in this
repo's history (see the `failure-archaeology` skill).

1. **Write the hypothesis and its metric first.** One sentence: "Changing X
   will move metric Y (as computed by `<function>` in `src/lib/calibration.ts`
   or `src/lib/graduation.ts`) in direction Z." If you cannot name the
   function that computes the metric, you are not ready to code.
2. **Check against the `architecture-contract` skill invariants.** The two
   most at risk from science changes: **guess-first sanctity** (no prior,
   median, or bias-corrected number may enter the DOM before the blind guess
   is locked at levels 1–2) and **sentinel honesty** (`guessMinutes: 0` means
   unscored — it must never be counted by `scorableLogs()` or `guessedReps()`
   or invented retroactively).
3. **Hand-compute the expected metric movement on seeded fixtures.** Build a
   localStorage fixture (cookbook in the `validation-and-qa` skill), compute
   the before/after score by hand, then confirm the code agrees. A formula
   change you can't hand-verify on 5 logs is a formula change you don't
   understand.
4. **Drive it headlessly.** No unit-test framework exists ON PURPOSE
   (owner-confirmed doctrine): prove behavior by driving the real app with a
   controlled clock per the `verify` skill. Do not add jest/vitest.
5. **Never oversell in copy.** Any UI claim must match what is measured. The
   precedent: the arming flow records whether `syncPushSchedule()` returned
   true (`src/app/lock/page.tsx`, `pushOk`), and the armed screen downgrades
   to an honest "set a phone alarm" warning whenever it verifiably failed
   (`pushOk === false`). Apply the same standard to every science-adjacent
   sentence.

## Reading list (only what the repo actually cites)

The repo cites informally, in comments and the README — there is no
bibliography file. These are the named sources; do not invent others:

- **Park et al. 2017** — backward planning outperforms forward planning
  (`src/lib/engine.ts` header; README).
- **Gollwitzer** — implementation intentions, d≈0.65 (README;
  `src/app/lock/page.tsx` comment).
- **Oettingen** — mental contrasting; positive fantasy alone hurts goal
  attainment (`src/app/lock/page.tsx` comment).
- **Planning-fallacy / reference-class forecasting literature** — cited as a
  body, no named author (`src/lib/priors.ts`, `src/lib/calibration.ts`
  headers; commits cea6b68, d1028f0).
- **Duration-prior sources** — Nielsen global grooming survey,
  UnitedHealthcare/hygiene surveys, BLS American Time Use Survey
  (`src/lib/priors.ts` header; these justify the `TASK_PRIORS` numbers).

If you add a mechanism, cite its source in a code comment at the mechanism's
home (the pattern above), and add the row to this file's table.

## Provenance & maintenance

- **Distilled from**: `README.md`; `src/lib/engine.ts`, `priors.ts`,
  `calibration.ts`, `graduation.ts`, `push-client.ts`, `store.ts`,
  `types.ts`; `src/app/lock/page.tsx`, `debrief/page.tsx`, `solo/page.tsx`,
  `plan/page.tsx`; commit bodies cea6b68 (#8), e2cb264 (#10), d1028f0 (#11).
- **Authored** 2026-07-07, verified against HEAD `055b144`.
- **Update this skill when**: any dose/threshold in the mechanism table
  changes (visualization seconds, `LEVELS` gates, `MIN_LOGS_FOR_HISTORY`,
  scorability floor, nudge times, p75 window); a new mechanism or citation
  is added; a frontier direction from §Frontier actually ships (move it into
  the table); or the transfer claim gains real evidence (rewrite §Not
  evidenced).
- **Re-verify core claims**:
  1. `grep -rn "Park et al\|Gollwitzer\|Oettingen\|planning.fallacy\|fallacy research" src/ README.md` — citations still where the table says (the `src/lib/priors.ts` citation wraps across lines; `fallacy research` is what matches it).
  2. `grep -n "doseSeconds\|minScore\|MIN_LOGS_FOR_HISTORY\|setHours(20, 30" src/app/lock/page.tsx src/lib/graduation.ts src/lib/calibration.ts src/lib/push-client.ts` — doses and gates unchanged.
  3. `npm run build && npm run lint` — repo still in the state this skill assumes.
