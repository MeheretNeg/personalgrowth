---
name: data-model-and-storage
description: The localStorage data model as a public API — every anchor:* key, every persisted shape, the sentinel semantics, and the compatibility rules for evolving schemas without corrupting existing installs. Load before adding, renaming, or reinterpreting any persisted field or key.
---

# Data model & storage

All app state lives in `localStorage` on the user's device (single device, no
account, no backend database). The owner is aiming for public release: treat
every persisted shape below as a **published API with real users**. A schema
change that breaks an existing install silently destroys someone's training
record — there is no server copy to restore from. The one server-side file
(`.data/push.json`) is covered at the end.

## The keys

All keys are defined in `src/lib/store.ts` (`KEYS` const, prefix `anchor:`).

| Key | Shape | Fallback | Writers | Clearers | Lifetime |
|---|---|---|---|---|---|
| `anchor:trip` | `Trip \| null` | `null` | `saveTrip()`: plan `lock()`, lock page (`arm()`, `begin()`, visualizedAt effect), execute `update()`/`toDebrief()`, debrief `save()`/skip | `clearTrip()`: lock `discard()`, execute `discardTrip()` | One active trip; overwritten by the next `lock()`. A `phase:"done"` trip lingers until then. |
| `anchor:logs` | `DurationLog[]` | `[]` | `appendLog()`: execute `finish()` only | **never** | Permanent, append-only training record |
| `anchor:debriefs` | `Debrief[]` | `[]` | `appendDebrief()`: debrief `save()`, solo `arrived()` | **never** | Permanent, append-only training record |
| `anchor:settings` | `Settings` | `DEFAULT_SETTINGS` | `saveSettings()`: plan `choosePlanMode()` (planMode), execute `saveChecklist()` (exitChecklist), debrief/solo (level) | never | Permanent |
| `anchor:lastTasks` | `string[]` | `[]` | `saveLastTaskIds()`: plan `lock()` | never | Overwritten per lock; powers "My usual" |
| `anchor:solo` | `SoloTrip \| null` | `null` | `saveSolo()`: solo `begin()` | `clearSolo()`: solo `arrived()`/`abandon()` | Parallel machine to `anchor:trip`; they never touch each other |

`DEFAULT_SETTINGS = { earlyBufferMinutes: 10, level: 1 }` (`src/lib/store.ts`).

## How reads work — and why that IS the migration system

`read<T>(key, fallback)` in `src/lib/store.ts`:

1. Returns `fallback` during SSR (`typeof window === "undefined"`).
2. Returns `fallback` if the key is absent.
3. Returns `fallback` if `JSON.parse` throws (corrupt value).
4. **Otherwise returns the parsed object as-is** — no shape validation, no
   version field, no deep-merge of defaults.

Consequence: `DEFAULT_SETTINGS` only applies when the *whole key* is missing
or corrupt. A settings object persisted before `planMode` existed comes back
as `{ earlyBufferMinutes, level }` with no `planMode` — and that must keep
working. The repo's mechanism is **optional field + fallback at the read
site**, e.g. `loadSettings().planMode ?? "train"` (`src/app/plan/page.tsx`)
and `loadSettings().exitChecklist ?? DEFAULT_CHECKLIST`
(`src/app/execute/page.tsx`). There is no migration framework; this pattern
is it. Follow it.

## Type reference (annotated)

All in `src/lib/types.ts` except `SoloTrip` (`src/lib/store.ts`).

**`Trip`** — the single active trip.
- `phase: TripPhase` = `"planning" | "locked" | "executing" | "debrief" | "done"`.
  **`"planning"` is declared but never persisted** — plan `lock()` writes
  `phase: "locked"` directly. It exists only in the home dispatcher's
  `PHASE_ROUTE` map (`src/app/page.tsx`). Do not start persisting it, and do
  not remove it from the union without checking `PHASE_ROUTE`.
- `armedAt?` — set by lock `arm()`; presence means the waiting room survives
  a reopen while still `"locked"`.
- `visualizedAt?` — set once by the lock page when the 20s ritual completes;
  its presence is what stops the ritual re-enforcing on reopen (the persist
  effect early-returns on `trip.visualizedAt`).
- `arrivedAt?` — set by execute `toDebrief()`; prefills the debrief delta so
  the level-driving outcome rests on a measurement, not an honor system.
- `timeline: TimelineStep[]`, `currentStepIndex`, `tasks: PlannedTask[]`,
  `transit: TransitDetails`, `lockedAt?`, `earlyBufferMinutes` (copied from
  settings at lock time — a later settings change does not retro-apply).

**`TimelineStep`** — planned fields (`startsAt`/`endsAt` ISO,
`plannedMinutes`, `kind`, `ifThen`) plus **runtime fields written during
execution**: `startedAt?` (Start tap, possibly backdated), `finishedAt?`,
`taskId?`. `taskId` for travel steps is rewritten at lock to
`drive:<slug>`/`walk:<slug>` for per-destination learning.

**`DurationLog`** — one silent measurement. `actualMinutes` is
whole-minute; `actualSeconds?` exists **only on newer logs** (added because
whole-minute rounding made short tasks pure noise — see the field comment).
Any consumer must tolerate its absence on old records.

**`Debrief`** — `deltaMinutes` (negative = early), `causes: string[]`,
`note?`, `solo?` (true only for free-solo trips, which write `causes: []`).

**`Settings`** — `earlyBufferMinutes`, `level: 1|2|3|4`, plus optional
`planMode?` and `exitChecklist?` — the two live examples of the additive
optional-field pattern.

**`SoloTrip`** — `{ destination, arrivalTime, startedAt }`; `arrivalTime`
and `startedAt` are ISO strings, `destination` is a free-text name; no phase
and no timeline.

## Sentinel semantics (these values carry meaning — never "fix" them)

| Sentinel | Meaning | Enforced by |
|---|---|---|
| `PlannedTask.guessMinutes === 0` | No blind guess was made (quick plan / "Use standard times"). The rep is unscored. | `guessFor()` in `src/app/execute/page.tsx` returns null; `guessedReps()` in `src/lib/graduation.ts` counts only `guessMinutes > 0`; `calibrationScore()` in `src/lib/calibration.ts` filters them out |
| `driveGuessMinutes === 0` / `walkGuessMinutes === 0` (`TransitDetails`) | User accepted the median suggestion in Plan step 1 (`driveSuggested`/`walkSuggested`). Accepting a suggestion is planning, not estimating — it must never score as a near-perfect rep. | Plan's `transit` memo writes 0 when suggested; `guessFor()` treats 0 as "no rep" |
| `DurationLog.guessMinutes === 0` | Measured actual with nothing to score. **Still feeds personal medians** (medians learn from actuals); excluded from calibration score and rep counts. | Same functions as above |
| `PlannedTask.source` | `"guess"` = user's own number kept; `"prior"` = population number (p75 "slow day" / `standardFor()`); `"history"` = personal `planningMinutes()`/median | Set in plan `choose()`/`lockGuess()`/`standardFor()`; displayed only on the plan page's task list (`src/app/plan/page.tsx`); persisted on the trip but not read by debrief or stats today |
| `TripPhase "planning"` | Declared, routed, never persisted (see above) | plan `lock()` |

The median-honesty chain is interdependent: guess-0 sentinel + sub-15-second
log drop + backdated starts + `guessedReps` must all hold together or
calibration skews. See the `calibration-and-graduation` skill before touching
any of them.

## Append-only: the training record

`anchor:logs` and `anchor:debriefs` are the user's measured history — the
thing the entire app exists to build. Rules:

1. **Never rewrite, dedupe, trim, or "clean up" these arrays** in any
   migration or feature. `appendLog`/`appendDebrief` are the only writers;
   keep it that way.
2. Preserve order — records are appended chronologically and
   `src/lib/calibration.ts` reasons over recent slices.
3. Do not delete guess-0 logs as "junk": they feed `personalMedian()` and
   `planningMinutes()`.
4. If a record shape must evolve, add optional fields to *new* records and
   make consumers tolerate old ones (`actualSeconds?` is the precedent).

## Schema-evolution rules (derived from how the code already behaves)

1. **Additive optional fields only.** New field ⇒ optional in
   `src/lib/types.ts` + `??` fallback at every read site (the
   `exitChecklist ?? DEFAULT_CHECKLIST` pattern). Never add a required field
   to a persisted type — old installs won't have it and `read()` will hand
   you `undefined` where TypeScript promised a value.
2. **Never rename a localStorage key or a persisted field, and never change
   a field's meaning in place.** When minute precision proved too coarse, the
   fix was a *new* field (`actualSeconds`), not a reinterpretation of
   `actualMinutes`. Follow that precedent.
3. **Never repurpose a sentinel.** `0` means "unscored" in every guess
   field; a new numeric field must not use `0` for a real value if it also
   needs an "absent" state — use an optional field instead.
4. **Compat shims live at load/read time, not as destructive write-backs.**
   Do not write a "migration" that loops over stored records rewriting them;
   if it has a bug you corrupt the record with no undo. Old persisted trips
   must keep parsing forever.
5. **Test evolution by seeding an old-shape record and driving.** Seed
   localStorage with a fixture missing your new field (the
   `validation-and-qa` skill has the fixture cookbook), then drive the full
   loop headlessly per the `verify` skill. There is no unit-test framework
   in this repo, on purpose — verification means driving the real app.

## Inspecting / resetting a live device

Inspect: DevTools → Application → Local Storage → the app origin; or in the
console: `JSON.parse(localStorage.getItem("anchor:logs"))`.

What clearing each key destroys — say this out loud before doing it:

| Remove | You lose |
|---|---|
| `anchor:trip` | The active trip mid-loop. **Does not clear the server push schedule** — hand-deleting skips `clearPushSchedule()`, so already-synced closed-app cues can still fire (the server drops cues only once 10+ min stale). |
| `anchor:logs` | All duration history: medians, calibration score, rep counts. `earnedLevel()` collapses, though `settings.level` itself only steps down later via a late debrief. Irreversible. |
| `anchor:debriefs` | All arrival history: streaks, on-time rate, topLeak input, level evidence. Irreversible. |
| `anchor:settings` | Level resets to 1, buffer to 10; `planMode` and custom `exitChecklist` gone. |
| `anchor:lastTasks` | Only the "My usual" one-tap. Cheapest key to lose. |
| `anchor:solo` | An in-flight free-solo trip (nothing was going to be logged until arrival anyway). |

Never wipe `anchor:logs`/`anchor:debriefs`/`anchor:settings` on a real user's
device as a debugging step. For test devices, seed known fixtures instead
(`validation-and-qa`).

## Server-side state: `.data/push.json`

The one piece of state not in the browser (`src/lib/push-server.ts`):

- **Shape**: a JSON array of `Entry { subscription: webpush.PushSubscription,
  cues: PushCue[] }`, keyed in memory by `subscription.endpoint`.
  `PushCue = { at /* ISO */, title, body, tag, requireInteraction? }` — the
  `tag` shares the in-page cue namespace so the OS collapses duplicates.
- **Lifecycle is independent of localStorage.** The client re-posts its full
  remaining cue list to `POST /api/push/sync`
  (`src/app/api/push/sync/route.ts`) on every trip transition —
  replace-not-merge, empty list clears, at most `MAX_CUES = 60` soonest kept.
  `setSchedule()`/`persist()` write the file; `ensurePushLoop()` reloads it
  on boot and runs a tick every 30s by default (`TICK_MS` in
  `src/lib/push-server.ts`, overridable via the `PUSH_TICK_MS` env var) that
  sends due cues, drops
  cues 10+ minutes stale, and deletes subscriptions on 404/410.
- The file is gitignored (`/.data/` in `.gitignore`) and only exists after a
  first sync with VAPID keys configured (`pushEnabled()`); without keys the
  route returns 503 and everything no-ops.
- Deleting `.data/push.json` loses only pending closed-app cues — no
  training data. It needs a persistent `next start` host; on serverless the
  loop runs only while an instance is warm. See the `notification-pipeline`
  skill for the full cue system.

## Provenance & maintenance

- **Distilled from**: `src/lib/store.ts`, `src/lib/types.ts`,
  `src/lib/push-server.ts`, `src/app/plan/page.tsx`,
  `src/app/execute/page.tsx`, `src/app/lock/page.tsx`,
  `src/app/api/push/sync/route.ts`, plus writer/clearer call sites in
  `src/app/{page,debrief/page,solo/page,stats/page}.tsx`; `.gitignore`.
- **Authored** 2026-07-07, verified against HEAD `055b144`.
- **Update this skill when**: a key is added to `KEYS` or
  `DEFAULT_SETTINGS` changes (`src/lib/store.ts`); any interface in
  `src/lib/types.ts` gains/loses a field; a sentinel value's meaning moves;
  `PushCue`/`Entry` or the sync route contract changes; a new writer or
  clearer of any `anchor:*` key appears.
- **Re-verify in 3 steps**: (1) read `src/lib/store.ts` and diff its `KEYS`,
  `DEFAULT_SETTINGS`, and exported functions against the table above;
  (2) read `src/lib/types.ts` and check each annotated field still exists
  with the same optionality; (3) `grep -rn "saveTrip\|appendLog\|appendDebrief\|saveSettings\|clearTrip\|saveSolo" src/` and confirm the
  writers/clearers columns, then `npm run build`.
