---
name: change-control
description: The safe-change procedure for Anchor from branch to push — what to read first, the build/lint/drive gate sequence, and per-area review checklists; load before making, reviewing, or committing any code change.
---

# Change control

How a session ships a change without breaking doctrine. Follow this top to
bottom for every non-trivial edit.

## 1. Before touching any code

1. Read `AGENTS.md` (repo root). It is one paragraph and binding: this is
   Next.js 16 — APIs differ from training data. Read the relevant guide in
   `node_modules/next/dist/docs/` before writing framework code.
2. Load the sibling skill for your task:
   - Zero project context → `anchor-orientation` first.
   - Touching routes, config, ESLint, manifest, instrumentation, caching →
     `nextjs-16-contract`.
   - Touching planning, calibration, graduation, timing, or notifications →
     `architecture-contract` (the invariants your diff will be judged against).
   - Fixing a bug → `debugging-playbook`; unclear why code is weird →
     `failure-archaeology`.

## 2. Branch, commit, push

- Branch off `main`; changes land via PR to `main`. Every push to `main`
  deploys to Vercel (README, "Deploy on Vercel") — `main` is production.
- Commit style (verified against `git log origin/main`): imperative subject
  describing the user-visible change, often with a colon and concrete detail
  (e.g. `Show the projected arrival when behind: 'you'd walk in at HH:MM'`);
  body explains WHY and what behavior changed, bullets for multi-part changes.
- Never commit `.env.local` (VAPID private key; `.gitignore` excludes `.env*`
  except `.env.example`) or `.data/` (server-local push schedule state,
  `.data/push.json`).
- Honest messages: report failures and untested paths plainly. Precedent to
  avoid repeating: PR #11 claimed "Verified: 69/69 headless checks" but the
  check scripts were session-ephemeral and never committed — the claim is
  unreproducible. If you verified something, say how; if you didn't, say so.

## 3. The gate sequence (every change, in order)

1. `npm run build` — Turbopack build, includes the TypeScript check. The
   route table printed at the end lists every app route — it should only
   change when you added or removed one. Build does NOT lint in Next 16.
2. `npm run lint` — runs `eslint` directly against the flat config
   `eslint.config.mjs`. `next lint` no longer exists.
3. Headless-drive the affected loop per the `verify` skill (the canonical
   harness: production server on a port, Playwright with
   `/opt/pw-browsers/chromium`, `page.clock.install` for time control).
   There is no unit-test framework ON PURPOSE (owner doctrine: verify by
   driving the real app). Do not substitute step 3 with jest/vitest.

Map what you touched to the `verify` skill section that exercises it:

| Touched | Drive per `verify` section |
|---|---|
| `src/app/{plan,lock,execute,debrief}/` | "Drive the surface" full loop, plus the matching "Phase 2" / "Audit-round" / "Psychological-loop" items |
| `src/lib/engine.ts` | Plan step 4 timeline + "Midnight anchors roll back" + replan ("Replan from now") |
| `src/lib/calibration.ts`, `priors.ts`, `graduation.ts` | "Phase 2 behaviors": graduation seeding, level fading, plan modes; "Audit-round": p75 planning numbers, logging guard |
| `src/lib/notify.ts`, `push-client.ts`, `push-server.ts`, `src/app/api/push/sync/` | "Notifications" stubs + "Web push (closed-app cues)" fake-subscription drill |
| `public/sw.js`, `next.config.ts` | `/sw.js` → 200 with `Cache-Control: no-store`, worker reaches `activated` |
| `src/lib/store.ts`, `types.ts` | Re-drive any flow that reads seeded `anchor:*` keys; seed old-shape data and confirm it still loads |

## 4. Area-triggered review checklists

Run the checklist for every area your diff touches. These are the recurring
regression classes; `architecture-contract` states the invariants in full —
this is the reviewer's short form.

### plan / execute / debrief (the training loop)
- Guess-first: at levels 1–2 the prior ("Typical person: N min") must not
  enter the DOM before the guess is locked (plan step 3).
- `guessMinutes: 0` is the unscored sentinel — quick-plan, standard-times,
  and accepted travel suggestions log actuals for medians but are excluded
  from calibration scoring (`src/lib/calibration.ts` filters
  `l.guessMinutes > 0 && max(guess, actual) >= 5`). Never score a 0-guess log.
- Logging guard: execute appends a log only when the block ran ≥15s
  (`elapsedSec >= 15` in `src/app/execute/page.tsx`). Don't let a new code
  path append tap-through logs — silent median corruption is a documented
  past failure class.
- Debrief delta prefills from the measured `trip.arrivedAt` — never revert
  to an honor-system default of "on time".
- Replan must keep a running block's `startedAt` (re-logging from replan
  time biased medians short before the #11 fix).

### src/lib/engine.ts
- Stays pure: imports only `./priors` and `./types` — no UI, no storage
  (so a live traffic API can be injected later). Reject any diff adding
  React or `store.ts` imports.
- The anchor never moves: `rebuildRemaining()` rebuilds backward from the
  same chain end; check any timeline math against this.
- `rollBeforeArrival()`: transit departures / pickup times are placed
  within 24h BEFORE the arrival, using `setDate` (DST-safe), never
  `+24 * 3600_000` ms arithmetic. Preserve both properties.

### src/lib/notify.ts / push path
- Level fade: `cueForStep()` returns `null` at level ≥4 and at level 3 for
  everything except the final staging step. New cues must respect the fade.
- Sync/clear lifecycle: every trip mutation on `/execute` goes through
  `update()`, which calls `syncPushSchedule()`; `toDebrief()` and
  `discardTrip()` call `clearPushSchedule()`; debrief save schedules the
  evening `planNudgeCue()` via `syncCues()`. A new trip-state transition
  that skips these leaks stale closed-app pushes.
- Without VAPID keys, `/api/push/sync` returns 503 and the client no-ops —
  keep that degradation silent server-side but HONEST in copy (the armed
  screen only says "you can close the app" after a verified sync).

### src/lib/store.ts / types.ts
- These schemas already live in users' localStorage, and the owner is
  aiming for public release: evolve them compatibly. New `Settings`/`Trip`/
  log fields must be optional or defaulted so old stored JSON still parses;
  never rename the `anchor:*` keys (`KEYS` in `store.ts`) without a
  migration. `read()` swallows parse errors and returns the fallback — a
  shape change can silently wipe a user's training record. See
  `data-model-and-storage` for the full rules.

### public/sw.js
- Bump the cache name (`const CACHE = "anchor-v1"`) whenever cached shell
  assets change, or installed PWAs keep serving the old shell.
- `/sw.js` must keep its `Cache-Control: no-cache, no-store, must-revalidate`
  header (set in `next.config.ts` `headers()`). Re-check the header after
  any `next.config.ts` edit. See `release-and-deploy`.

## 5. Skill-library maintenance

When your change invalidates a claim in any `.claude/skills/*/SKILL.md`,
update that skill in the SAME PR. Each skill (except the pre-existing
`verify` harness) lists its update triggers in its "Provenance &
maintenance" section — after editing a file, grep the skill library for
the paths and symbols you changed.

The `verify` skill's section headings ("Drive the surface", "Phase 2
behaviors", "Audit-round behaviors", "Web push (closed-app cues)", …) are a
stable API — several sibling skills route to them by name (including the
table in §3 above). Before renaming or restructuring anything in
`verify/SKILL.md`, grep `.claude/skills/*/SKILL.md` for the old heading
text and update every referrer in the same PR.

## 6. Do NOT

- Do not add jest/vitest or any unit-test framework — verify-by-driving is
  owner-confirmed doctrine, not an oversight.
- Do not add a `webpack` block to `next.config.ts` — Turbopack is the
  default builder and the build fails with one.
- Do not create `.eslintrc*` or use `extends` — flat config
  (`eslint.config.mjs`) only. Do not re-enable
  `react-hooks/set-state-in-effect`; it is off intentionally for the
  mount-effect localStorage hydration pattern (comment in the config).
- Do not create `middleware.ts` — deprecated in Next 16 (`proxy.ts` is the
  replacement if ever needed); the `/sw.js` headers already live in
  `next.config.ts` `headers()`, the right place.
- Do not weaken an established design-principle invariant (guess-first,
  earned graduation, honest copy, anchor immobility, no-shame framing) to
  smooth a UX edge — these are evidenced throughout the code and commit
  history; that trade-off needs explicit owner sign-off, in the PR
  description.

## 7. Definition of done

- [ ] `npm run build` and `npm run lint` pass.
- [ ] The affected loop drives green headlessly per the `verify` skill,
      and the driver script's key assertions are stated in the PR.
- [ ] Area checklists above walked for every touched area.
- [ ] README and any invalidated skills updated if behavior changed.
- [ ] `.env.local` and `.data/` absent from the diff.
- [ ] Commit message: imperative subject, why in the body, failures and
      unverified paths reported plainly.
- [ ] If this merges to `main` it deploys to production within minutes —
      know the rollback path first (`release-and-deploy`, "When a deploy
      goes bad").

## Provenance & maintenance

- Distilled from: `AGENTS.md`, `README.md`, `.gitignore`,
  `eslint.config.mjs`, `next.config.ts`, `package.json` scripts,
  `.claude/skills/verify/SKILL.md`, `src/lib/{engine,store,calibration,notify,push-client}.ts`,
  `src/app/execute/page.tsx`, and `git log origin/main` (#5–#12).
- Authored 2026-07-07; verified against HEAD `055b144`.
- Update this skill when: npm scripts change; the gate sequence gains a
  step (CI, test runner — would also mean doctrine changed); branch/deploy
  flow moves off Vercel-from-main; any listed symbol is renamed
  (`rollBeforeArrival`, `rebuildRemaining`, `cueForStep`,
  `syncPushSchedule`/`clearPushSchedule`, `KEYS`, `CACHE`); or the skill
  library gains/loses members.
- Re-verify core claims: (1) `npm run build && npm run lint`;
  (2) `git log --format="%h %s" origin/main -5` for commit style;
  (3) `grep -n "rollBeforeArrival\|rebuildRemaining" src/lib/engine.ts && grep -n "anchor-v" public/sw.js`.
