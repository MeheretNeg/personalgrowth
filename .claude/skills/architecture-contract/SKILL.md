---
name: architecture-contract
description: The invariants that must never break in Anchor — check every diff against this contract before approving or merging any change to planning, logging, graduation, timing, or notifications.
---

# Architecture contract

The load-bearing invariants of Anchor. Each exists because breaking it either
corrupts the training data silently, lies to the user, or punishes them into
abandoning the app. Review every diff against this list. For orientation see the
`anchor-orientation` skill; to prove a change safe, see `validation-and-qa` and
`verify`.

## 1. Guess-first blindness (levels 1–2)

**Statement.** No prior, median, or "typical time" may enter the DOM before the
user's blind guess is locked. The guess IS the training rep; showing the answer
first turns it into copying.

**Enforced in** `src/app/plan/page.tsx`:
- Task cards: the compare card (prior p50/p75 + personal median) renders only
  after `lockGuess()` sets `revealed: true`, and the lock button is disabled
  until `Number(s.guess) > 0`.
- Travel: the drive/walk median block renders only when `level < 3` AND a guess
  is typed (`if (!(Number(driveGuess) > 0)) return null;` — same for walk).
- Quick-plan chips show `standardMinutes()` only when `planMode === "quick"`
  (quick mode is explicitly not a blind rep — see invariant 2).

**Known gap:** the one-tap "My usual" card in step 2 (the `selectUsual` block
in `src/app/plan/page.tsx`) shows an aggregate `standardMinutes()` total
("~N min") before any guess, in train mode too — it is gated only on
`lastTaskIds` and empty selections, not on `planMode` or level. Do not cite it
as precedent for surfacing per-task times pre-guess.

**Silent violation.** Any "helpful" UX change surfacing `personalMedian()`,
`getPrior()`, or `planningMinutes()` earlier in the wizard — a placeholder,
tooltip, autofill, or train-mode chip label — destroys the rep without any
error. Grep new Plan JSX for those three calls and check what gates them.

## 2. `guessMinutes === 0` means "not a blind rep"

**Statement.** A zero guess is a sentinel: the duration was planned, not
estimated. It must never be scored as calibration or counted as a rep, but its
ACTUAL still feeds the medians.

**Writers of the sentinel** (all in `src/app/plan/page.tsx`):
- Accepting a travel suggestion: `driveGuessMinutes: driveSuggested ? 0 : …`
  (same for `walkGuessMinutes`) — "accepting the suggestion is planning, not
  estimating".
- `fillWithStandards()` ("Use standard times" hatch) and quick-plan
  `standardFor()` paths: `guess: ""` → `Number("") || 0` → `guessMinutes: 0`
  in `plannedTasks`.

**Consumers of the sentinel:**
- `guessFor()` in `src/app/execute/page.tsx` returns `null` for 0 → `finish()`
  logs `guessMinutes: 0`.
- `scorableLogs()` in `src/lib/calibration.ts` filters `guessMinutes > 0`
  (feeds `calibrationScore`, `meanSignedErrorPct`, `errorTrend`).
- `guessedReps()` in `src/lib/graduation.ts` filters `guessMinutes > 0`
  (feeds `earnedLevel` and `levelProgress`).

**Silent violation.** A new planning path that forgets to zero the guess (or a
"cleanup" that defaults it to `plannedMinutes`) makes copied numbers look like
near-perfect estimates — score inflates, users graduate on fake reps, nothing
errors. A consumer that drops the `> 0` filter scores unguessed logs as 100%
error. Every new write path into `appendLog` or `PlannedTask` must decide the
sentinel explicitly.

## 3. Graduation is earned, one step per debrief, demotion only on a late day

**Statement.** `settings.level` is never self-selected. It moves at most ONE
step per debrief toward `earnedLevel()`, and moves DOWN only when that debrief
was itself late (`wasLate = delta > 0`, strictly — on-time `delta === 0` must
never demote).

**Enforced in** `src/lib/graduation.ts` `stepToward()` (the `earned < current
&& wasLate` gate) plus exactly two call sites: `save()` in
`src/app/debrief/page.tsx` and `arrived()` in `src/app/solo/page.tsx` — both
pass `delta > 0`. No other code writes `settings.level`.

**Why.** Without the `wasLate` gate, one late day zeroes `onTimeStreak` and the
next two ON-TIME debriefs each step a level-4 user down — a 4→1 cascade for one
slip, the punishment spiral that makes this population abandon tools (comment
above `stepToward`).

**Silent violation.** A settings screen with a level picker; a third
`stepToward` call site; `delta > 0` becoming `>= 0`; or "simplifying" to
`level = earnedLevel(...)` (jumps multiple levels). Check any diff touching
`saveSettings` for `level` writes.

## 4. The anchor never moves

**Statement.** Replanning mid-execution rebuilds the remaining timeline
backward from the ORIGINAL chain end. The required arrival (or transit
departure / pickup time) is not negotiable; a block already running keeps its
real `startedAt`.

**Enforced in** `src/lib/engine.ts` `rebuildRemaining()`: `end = new
Date(remaining[remaining.length - 1].endsAt)` (immovable anchor), and
`startedAt: kept[i] === remaining[0] ? s.startedAt : undefined` — resetting a
running block's start "would re-log a 15-minute shower as 2 minutes and bias
the medians short" (median-honesty, invariant 6). Called from `confirmReplan()`
in `src/app/execute/page.tsx`, which also clears the `firedCues` ref so the new
schedule can cue.

**Silent violation.** Rebuilding forward from `now`, or copying steps without
the `startedAt` preservation, produces a plausible-looking timeline that
quietly moves the arrival or corrupts duration logs.

## 5. The engine stays pure

**Statement.** `src/lib/engine.ts` imports only `./priors` and `./types` — no
React, no store, no window, no fetch. All functions are pure `(input) → output`.

**Why.** A live traffic/transit API is meant to be injected later by swapping
inputs, without touching any screen (header comment in `engine.ts`); purity also
makes the timeline math testable by direct invocation.

**Silent violation.** Importing `loadSettings()` "for convenience" inside
`buildTimeline`, or reading `Date.now()` instead of taking dates as parameters.
Check the import list of any `engine.ts` diff. Details in the `timeline-engine`
skill.

## 6. The median-honesty set (all links must hold together)

The personal medians and calibration score are only as honest as the
measurements. Five interlocking rules, all load-bearing:

| Rule | Enforced in |
|---|---|
| Log only if the block really ran: `startedAt && taskId && elapsedSec >= 15` (sub-15s = clicking through, never logged) | `finish()` in `src/app/execute/page.tsx` |
| Late Start tap must not under-count: backdate buttons `start(2)` / `start(5)` ("Already doing it — started ~Nm ago"); Lock `begin()` auto-starts step 0 when `startDue` | `src/app/execute/page.tsx`, `src/app/lock/page.tsx` |
| Record `actualSeconds` alongside rounded `actualMinutes` (whole-minute rounding made short tasks pure noise) | `finish()`; field on `DurationLog` in `src/lib/types.ts` |
| Score only real signal: `scorableLogs()` requires `guessMinutes > 0` AND `max(guess, actual) >= 5` min (quantization-noise guard) | `src/lib/calibration.ts` |
| Plan at ~p75, display/calibrate at the median: `planningMinutes()` (p75 of last 8) vs `personalMedian()` (median of last 5, needs `MIN_LOGS_FOR_HISTORY = 5`) | `src/lib/calibration.ts`; used in `standardFor()` in `src/app/plan/page.tsx` |

Break any one link and calibration skews with zero errors — e.g. removing the
15s guard floods logs with 1-minute "tasks"; swapping p75 and median makes every
plan a coin-flip overrun. See the `calibration-and-graduation` skill.

## 7. Drift is projected, never instantaneous

**Statement.** While a block runs, ahead/behind = `max(now, startedAt +
plannedMinutes)` minus the scheduled `endsAt`. Tapping Start late must never
flip the pill to "ahead".

**Enforced in** the `driftMin` computation in `src/app/execute/page.tsx`
(comment: "measured against the locked plan, not vibes"). Pending blocks use
`-minutesUntil(step.startsAt, now)`; `farFuture` (≤ −120 min) swaps the pill
text to the neutral "Starts much later" copy — only the wording changes, the
styling still follows the `ahead` branch. Overtime cues likewise measure from
the ACTUAL `startedAt` in both
`cueForStep()` (`src/lib/notify.ts`) and `buildPushCues()`
(`src/lib/push-client.ts`).

**Silent violation.** "Fixing" drift to `now - endsAt` reports a late-started
block as on time until the clock physically passes the deadline — the lie the
app exists to break.

## 8. Calendar-day rollover, never +24h of milliseconds

**Statement.** Rolling a time to tomorrow/yesterday uses `setDate(d.getDate()
± 1)`, never `± 24 * 3600_000` ms. A DST weekend makes those differ by an hour.

**Enforced in:** `arrivalDate` in `src/app/plan/page.tsx`, `begin()` in
`src/app/solo/page.tsx`, `planNudgeCue()` in `src/lib/push-client.ts`, and
`rollBeforeArrival()` in `src/lib/engine.ts` — which additionally guarantees a
transit-departure/pickup clock time lands within the 24h BEFORE the arrival it
serves (planning at 23:00 for a 00:30 arrival must not put the 23:45 bus a day
late).

## 9. Cue/schedule coherence

**Statement.** The in-page cue ladder and the closed-app push schedule describe
the same plan, always. Three rules:
1. Every mutation of the active trip re-syncs push: `update()` in
   `src/app/execute/page.tsx` and `begin()`/`arm()` in `src/app/lock/page.tsx`
   call `syncPushSchedule(trip, level)` (replace-not-merge).
2. Every exit path clears it: `toDebrief()`, `discardTrip()` (execute) and
   `discard()` (lock) call `clearPushSchedule()`. `save()` in
   `src/app/debrief/page.tsx` replaces the schedule with just
   `planNudgeCue()`.
3. In-page dedup keys (`headsup-<stepId>`, `missed-<stepId>-<nag>`,
   `overtime-<stepId>-<nag>`) double as push `tag`s in `buildPushCues()`, so
   the OS collapses duplicates when both paths fire.

Three `saveTrip` sites deliberately do NOT sync or clear: trip creation in
`src/app/plan/page.tsx` and the `visualizedAt` stamp effect in
`src/app/lock/page.tsx` (no schedule is armed yet / the timeline is
unchanged), and the debrief Skip button (`toDebrief()` already cleared the
schedule). Do not copy them as precedent for a new mutation of an armed or
executing trip.

**Silent violation.** A new exit path or trip mutation that forgets its
sync/clear call leaves stale "OUT THE DOOR" pushes firing hours after the trip
died — fire-and-forget, nothing errors. Check any diff adding a
`saveTrip`/`clearTrip` call in a page against this list. Full pipeline in the
`notification-pipeline` skill.

## 10. Hydration sentinels and the disabled lint rule

**Statement.** All state lives in localStorage; every page is a prerendered
client component. Two sanctioned patterns: (a) mount-effect load + `if (!trip)
return null` / `if (!ready) return null` sentinel (execute, lock, debrief,
solo, home); (b) lazy `useState(() => typeof window === "undefined" ? fallback
: loadX())` initializers (plan, and secondary values elsewhere).
`react-hooks/set-state-in-effect` is turned OFF in `eslint.config.mjs` ON
PURPOSE to permit pattern (a).

**Silent violation.** Re-enabling the rule "to fix lint debt", removing a
`return null` sentinel, or moving a `loadX()` call to module scope — all
produce SSR/hydration mismatches or prerender crashes. See the
`nextjs-16-contract` and `ui-conventions` skills.

## 11. Level gating lives in three layers — change them together

`GraduationLevel` fading is duplicated by design in:
1. Page JSX: `lockGuess()` branches and travel-median `level < 3` gates in
   `src/app/plan/page.tsx`; `hideDigits={level >= 2 && guessFor(...) !== null}`
   in `src/app/execute/page.tsx`; solo entry card `level >= 3` in
   `src/app/page.tsx`.
2. `cueForStep()` in `src/lib/notify.ts`: `level >= 4` → null; `level === 3` →
   final-staging only.
3. `buildPushCues()` in `src/lib/push-client.ts`: same two gates mirrored.

Changing fading semantics in one layer only makes the app contradict itself
(e.g. silent in-page but nagging by push). **Known gap:** the `/solo` route
itself is NOT level-gated — only the home entry card is; do not "fix" other
gates by copying that pattern.

## 12. Honest copy, no shame

**Statement.** Never promise a closed-app wake-up unless the push path is
verified. `syncPushSchedule()` returns `false` when no closed-app path exists;
`arm()` in `src/app/lock/page.tsx` stores that as `pushOk`, and the armed
screen swaps to "set a phone alarm" copy when `pushOk === false`. (Caveat:
reopening an armed trip resets `pushOk` to `null` and shows the optimistic
copy — do not widen this gap.) Debrief and solo copy frames lateness as data
("the gap is the lesson"), never as failure; demotion copy is "Scaffold
returns", not punishment. Keep that register in any new user-facing string —
dishonest promises and shame framing are two of the four documented
failure classes (see the `failure-archaeology` skill).

## 13. localStorage is the only user state

**Statement.** There is no backend database, no accounts, and no server-side
copy of logs, debriefs, or settings. `src/lib/store.ts` is the sole
persistence module; the only server state is the ephemeral push schedule
(`.data/push.json`), which is delivery plumbing, never training data.

**Why.** The training record lives on the device (README: "Data lives in
localStorage (single-device)"), and every schema rule in
`data-model-and-storage` assumes it. This is an established design principle
evidenced throughout the code — not owner-decreed law — so changing it is an
owner-sign-off proposal, not a fix. The tempting month-one violation is
"solve serverless push loss with a database" — see `release-and-deploy` §4
for why that must stay a labeled proposal.

**Silent violation.** Any diff that POSTs user training data to a route
handler, adds an ORM/DB dependency, or stores logs/debriefs/settings
anywhere but `localStorage` via `store.ts`.

## Reviewer checklist (every diff)

1. Does it surface `personalMedian`/`getPrior`/`planningMinutes` before a
   locked guess in Plan? (inv. 1)
2. Does it write `PlannedTask`/`DurationLog` or read `guessMinutes` without
   handling the 0 sentinel? (inv. 2, 6)
3. Does it write `settings.level` outside Debrief `save()` / Solo `arrived()`,
   or touch `stepToward`'s strict `delta > 0`? (inv. 3)
4. Does it move the anchor, reset a running block's `startedAt`, or add
   impure imports to `engine.ts`? (inv. 4, 5)
5. Does it compute drift/overtime from `now` instead of projected finish, or
   roll days by ±24h ms? (inv. 7, 8)
6. Does it add a trip mutation or exit path without
   `syncPushSchedule`/`clearPushSchedule`, or change level fading in fewer
   than all three layers? (inv. 9, 11)
7. Does it remove a hydration sentinel or re-enable the disabled lint rule?
   (inv. 10)
8. Does new copy promise unverified wake-ups or shame the user? (inv. 12)
9. Does it introduce server-side user state, a database, or a second
   persistence path around `store.ts`? (inv. 13)

Prove any non-trivial change by driving the built app — see the `verify` skill.

## Provenance & maintenance

- **Distilled from:** `src/lib/{engine,calibration,graduation,types,store,notify,push-client}.ts`,
  `src/app/{plan,lock,execute,debrief,solo}/page.tsx`, `src/app/page.tsx`,
  `eslint.config.mjs`; history context from PRs #10–#12.
- **Authored:** 2026-07-07, verified against HEAD `055b144`.
- **Update this skill when** a diff touches: `stepToward`/`earnedLevel`
  signatures or thresholds; `scorableLogs`/`guessFor`/the `guessMinutes`
  sentinel; `rebuildRemaining`; drift math in the execute page; any
  `syncPushSchedule`/`clearPushSchedule` call site; level-gating in any of the
  three layers; or the ESLint rule block.
- **Re-verify core claims:**
  1. `grep -n "guessMinutes > 0" src/lib/calibration.ts src/lib/graduation.ts`
     and `grep -n "guessFor" src/app/execute/page.tsx` — sentinel consumers.
  2. `grep -rn "stepToward(" src/` — exactly two page call sites, both passing
     `delta > 0`.
  3. `grep -rn "clearPushSchedule\|syncPushSchedule" src/app/` — every trip
     mutation/exit path accounted for; then `npm run build && npm run lint`.
