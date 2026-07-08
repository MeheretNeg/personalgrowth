---
name: ui-conventions
description: The UI and copy conventions that make new screens look and sound native to Anchor — component kit (Base UI, not Radix), page shell, surface utilities, hydration patterns, accessibility floor, and voice/tone rules. Load before writing or reviewing any JSX, CSS, or user-facing copy.
---

# UI conventions

Read `anchor-orientation` first if you don't know what Anchor is. For framework
rules (App Router, client pages, Next 16 differences) see `nextjs-16-contract`.
After any UI change, prove it by driving per the `verify` skill.

## 1. Component kit: shadcn CLI on Base UI — NOT Radix

`components.json` declares style `"base-nova"`; primitives come from
`@base-ui/react` (see `package.json`). The shadcn components you know from
training data are Radix-based — **these are not**. Differences that bite:

| You expect (Radix shadcn) | This repo (Base UI) — verified |
|---|---|
| `<Accordion type="multiple">` | `<Accordion multiple>` — Root takes `multiple?: boolean` (`node_modules/@base-ui/react/accordion/root/AccordionRoot.d.ts`) |
| `asChild` composition | `render={<Component />}` prop — see `DialogPrimitive.Close render={<Button variant="ghost" size="icon-sm" />}` inside `DialogContent` in `src/components/ui/dialog.tsx` |
| `DialogPrimitive.Overlay` / `.Content` | `DialogPrimitive.Backdrop` / `.Popup` (wrapped; consumers still import `DialogOverlay`/`DialogContent`) |
| `AccordionPrimitive.Content` | `AccordionPrimitive.Panel` |
| `data-state="open"` selectors | `data-open` / `data-closed` boolean attributes (`data-open:animate-in` etc.) |
| plain `<button>` in Button | wraps the `@base-ui/react/button` primitive |

Never hand-write a new primitive from Radix memory. Read the existing wrapper
in `src/components/ui/` first; add new ones with the shadcn CLI so they come
from the base-nova registry.

**What exists in `src/components/ui/`**: `button.tsx`, `dialog.tsx`,
`input.tsx`, `textarea.tsx`, `card.tsx`, `accordion.tsx`. Card and Accordion
are currently unused by pages — pages build cards from plain `div` + surface
utilities (section 2). Prefer that idiom over `<Card>` for consistency.

**Props actually used in pages** (match these, don't invent):
- `Button`: `size="lg"` plus a className override for the big primary CTA —
  `className="h-14 rounded-2xl bg-primary text-lg font-bold tracking-tight text-primary-foreground hover:bg-primary/90"`
  (h-16 on Execute's Start/Done). Secondary actions use `variant="secondary"`,
  usually with `className="rounded-full"` — Plan's inline choice chips add
  `size="sm"` (`src/app/plan/page.tsx`, e.g. the "Keep Nm" / "Slow day Nm"
  estimate buttons), Debrief's ±1/±5 delta buttons use the default size, and
  Lock's Arm button pairs it with `size="lg"` (`src/app/lock/page.tsx`). Variants
  `ghost`/`outline` + `icon-sm` appear only inside `dialog.tsx`. Full cva sets:
  variants default/outline/secondary/ghost/destructive/link; sizes
  default/xs/sm/lg/icon/icon-xs/icon-sm/icon-lg.
- `Dialog`: always controlled — `<Dialog open={x} onOpenChange={setX}>` with
  `DialogContent/DialogHeader/DialogTitle/DialogDescription` (see the replan
  and checklist dialogs in `src/app/execute/page.tsx`).
- `Input`: numeric fields use `type="number" inputMode="numeric"` so mobile
  gets a number pad (`src/app/plan/page.tsx`). Input renders `text-base` on
  mobile, `md:text-sm` — do not shrink it (iOS zooms sub-16px inputs).
- `Textarea`: the checklist editor in Execute and the optional note field in Debrief.

Icons: `lucide-react` (only inside ui/*); pages use inline SVG or text glyphs
(✓, ✎) — see `voice-input.tsx` for the inline-SVG pattern.

## 2. Page shell and styling idioms

Every page is one centered mobile column:

```tsx
<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-5 py-8">
```

(`gap`/`justify`/`py` vary slightly per page — Home uses `justify-center py-10`.)
Use `min-h-dvh`, never `min-h-screen`/`100vh` — mobile browser chrome.

**Surface utilities** — defined as `@utility` blocks in `src/app/globals.css`
(with a design-intent comment at the top of the `:root` section). Dark-only
theme, oklch tokens:

| Utility | Meaning | Use for |
|---|---|---|
| `surface` | default card (hairline border, soft shadow) | ordinary cards |
| `surface-active` | amber border + glow — "the one thing that matters now" | the current step, primary CTA cards |
| `surface-alert` | red tint + border — lateness | final-staging step, overdue states |
| `surface-soft` | flat 4% white — passive rows/chips | chips, list rows, secondary buttons |

Pick by meaning, not looks. `surface-alert` is reserved for time pressure —
never use it for validation errors or generic warnings.

**Semantic color tokens** (never hardcode hex/oklch in JSX):
`text-primary` = warm amber, the active/positive thing (bank, on-pace, score);
`text-accent` = desaturated blue, passive info (section eyebrows, nav links);
`text-destructive` = alarm red, **reserved for lateness**;
`text-muted-foreground` for everything secondary.

**Ticking digits**: any mm:ss or countdown gets `font-mono … tabular-nums`
(Execute's countdown, `formatCountdown` output, stat numbers) so digits don't
jiggle at 1 Hz. Section eyebrows are
`text-[11px] font-semibold uppercase tracking-[0.2em]` (0.3em for page titles).

**`animate-anchor-pulse`** (globals.css keyframes) marks the urgent thing:
overtime decay bar, overdue Start digits, live mic. It is disabled under
`@media (prefers-reduced-motion: reduce)` in globals.css — never re-implement
a pulse inline or you lose that.

**Chips** are `rounded-full px-4 py-2 text-sm font-semibold` buttons; selected
state flips to `bg-foreground text-background` (checklist) or `bg-primary/12
text-primary` (banners). Escape hatches (discard/skip) are small underlined
muted-text links at the bottom; where discarding silently drops training data,
the copy discloses it — Execute's "This trip isn't happening — discard
(nothing gets logged)" (`src/app/execute/page.tsx`).

**Class composition**: pages use raw template-literal ternaries —
`` className={`rounded-full ${behind ? "bg-destructive/15" : "surface-soft"}`} ``.
`cn()` (`src/lib/utils.ts`) is used **only inside `src/components/ui/*`**;
there are zero `cn(` calls under `src/app/`. Keep it that way — don't import
`cn` into a page, and don't add tailwind-merge overhead where a ternary reads fine.

## 3. Hydration patterns (all state is in localStorage)

Every page except `src/app/layout.tsx` is `"use client"`, but pages are still
statically prerendered — localStorage does not exist at build time. Two
sanctioned patterns:

**(a) Mount-effect + sentinel** — for primary page state:
```tsx
const [trip, setTrip] = useState<Trip | null>(null);
useEffect(() => {
  const t = loadTrip();
  if (!t || t.phase !== "executing") { router.replace("/"); return; }
  setTrip(t);
}, [router]);
if (!trip) return null;   // sentinel — REQUIRED
```
Home uses a `ready` boolean instead (`if (!ready) return null` in
`src/app/page.tsx` `Pulse()`). The `return null` sentinel is load-bearing:
remove it and the prerendered HTML disagrees with the first client render →
hydration error / blank page (see `debugging-playbook`). Every phase page also
enforces its own phase guard and bounces to `/` — keep that in new pages.

**(b) Lazy initializer with a window guard** — for secondary values:
```tsx
const [level] = useState(() => (typeof window === "undefined" ? 1 : loadSettings().level));
```
(Execute's `level`/`checklist`; Plan uses it too.) The fallback must render
identically to the server output.

**Why the lint rule is off**: `eslint.config.mjs` disables
`react-hooks/set-state-in-effect` with an in-file comment — reading
localStorage in a mount effect IS the hydration-safe pattern here (a plain
useState initializer would run during prerender and mismatch). Do not
"fix" the config or refactor pattern (a) into initializers.

**1s tick caution**: Lock and Execute run
`setInterval(() => setNow(new Date()), 1000)` — the whole page re-renders
every second. Compute derived values inline only if cheap; memoize anything
expensive. Plan deliberately does NOT tick (it snapshots `now` per step).
The TimeDecay fill animates `transition-[height] duration-1000 ease-linear`,
so screenshots right after a clock fast-forward catch it mid-transition.

## 4. Accessibility floor (do not ship below this)

- Every toggle chip gets `aria-pressed` — plan task/mode chips, Execute's
  checklist chips and replan keep/cut rows, the VoiceInput mic.
- The decay bar is `role="progressbar"` + `aria-valuenow` + `aria-label`
  (`src/components/time-decay.tsx` `TimeDecay`).
- Live status text (the drift pill in Execute) gets
  `role="status" aria-live="polite"`; reward flashes get `role="status"`.
- Countdown digits sit on a scrim (`bg-black/45` rounded box) so they stay
  readable over the amber fill — the WCAG comment in `time-decay.tsx` marks
  it. Any new text over a colored fill needs the same treatment.
- Deliberately masked future steps use `aria-hidden` + `select-none` +
  `blur-[2px] opacity-55` (Execute) — hide from AT what you hide visually.
- Motion respects `prefers-reduced-motion` via globals.css (section 2).
- Icon-only buttons get `aria-label` (mic, ✎ edit chip) and dialogs keep the
  `sr-only` Close text.

## 5. Copy and tone rules (with the code that proves them)

Established/hardened in the 26-agent audit, commit `d1028f0` (PR #11 —
"correctness, training validity, honesty, recovery"). Second person, verb-first
buttons ("Plan my next arrival", "I've arrived — debrief", "Out the door").

1. **Urgency without shame.** Lateness is stated as a number plus a next
   action, never a judgment: "7 min behind plan · on pace for 9:12 — replan
   below" (`src/app/execute/page.tsx`); overtime reads "over — wrap it up"
   (`src/components/time-decay.tsx` `TimeDecay`); replan CTA is "Replan from
   now — make it winnable again" (`src/app/execute/page.tsx`). Failure routes
   back into the loop; there is no punishment framing anywhere. Don't add any.
2. **Success belongs to the user, not the app.** "Called it. That's a
   calibrated rep — the real win." / "+N min banked. That's your lead —
   protect it." (Execute `finish()`); "…that was the hard part, and you did
   it early." (Lock armed screen); "the record's still yours" (Home).
3. **Never promise what isn't verified.** The armed screen branches on
   `pushOk`, set by `arm()` in `src/app/lock/page.tsx`: on `pushOk === false`
   it says keep the screen open or set a phone alarm; otherwise (successful
   sync — or reopening an already-armed plan, where the mount effect leaves
   `pushOk` null) it says "You can close the app — Anchor will call you". Any
   new copy that claims background behavior must be gated the same way (see
   `notification-pipeline`).
4. **Human labels, never slugs.** Stats' `labelFor()` reverses `drive:`/
   `walk:` taskIds into "Drive → coffee shop" and falls back to the prior's
   label — with the comment "show the label the user chose, not an internal
   slug" (`src/app/stats/page.tsx`). Never render a taskId raw.
5. **Escape hatches disclose their cost**: "This trip isn't happening —
   discard (nothing gets logged)".

Copy is doctrine-adjacent: honesty and no-shame framing are established design
principles (see `architecture-contract`). A copy "polish" that adds shame or
an unverified promise is a regression, not a style choice.

## 6. Voice input and mobile-first constraints

- `VoiceInput` (`src/components/voice-input.tsx`): Web Speech API, one
  utterance per tap, transcript via `onResult`; `lang` follows
  `navigator.language || "en-US"`. It **renders null when unsupported**
  (notably iOS Safari PWAs) — so voice must only ever be an accelerator next
  to a text input, never the sole path. While listening it turns
  `bg-destructive … animate-anchor-pulse` with `aria-pressed`.
- Design and test at 412×915 (the `verify` skill's mandated viewport). The
  `max-w-md` shell means desktop is just a centered phone — never add
  desktop-only layouts.
- Touch targets: primary CTAs are full-width `h-14`/`h-16`; chips are at
  least `px-4 py-2` (≈36px tall); the mic is `h-9 w-9`. Nothing tappable
  smaller than that.
- Execute holds a screen wake lock and re-acquires it on `visibilitychange`
  (best-effort try/catch) — time must stay visible, like turn-by-turn nav.

## Provenance & maintenance

- **Distilled from**: `src/app/globals.css`, `src/components/ui/{button,dialog,accordion,card,input,textarea}.tsx`,
  `src/components/{time-decay,voice-input}.tsx`, `src/app/{page,execute/page,lock/page,stats/page}.tsx`,
  `components.json`, `package.json`, `eslint.config.mjs`,
  `node_modules/@base-ui/react/accordion/root/AccordionRoot.d.ts`, and commit
  `d1028f0` (PR #11 audit batch). Authored 2026-07-07 against HEAD `055b144`.
- **Update this skill when**: a new component lands in `src/components/ui/`;
  globals.css surface utilities or tokens change; the shadcn style/registry in
  `components.json` changes; the hydration pattern or the
  `react-hooks/set-state-in-effect` override changes; or a copy audit revises
  tone rules.
- **Re-verify core claims**:
  1. `grep -rn '"@base-ui/react' src/components/ui/ && grep '"style"' components.json` — kit is Base UI / base-nova.
  2. `grep -n '@utility surface' src/app/globals.css && grep -rn 'cn(' src/app/ | wc -l` — four surface utilities exist; expect 0 `cn(` calls in pages.
  3. `npm run build && npm run lint` — both must pass; then drive per the `verify` skill.
