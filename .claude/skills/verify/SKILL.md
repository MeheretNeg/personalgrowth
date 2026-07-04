---
name: verify
description: Build, run, and drive the Personal Growth app to verify changes end-to-end in a headless browser.
---

# Verify the Personal Growth app

## Build and run

```bash
npm install
npm run build                      # must pass TypeScript check
npm run start -- --port 3100 &     # serve the production build
curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/   # expect 200
```

## Drive the surface

The app is a single page at `/`. Use Playwright with the pre-installed
Chromium (`executablePath: '/opt/pw-browsers/chromium'`; do NOT run
`playwright install`). Install the `playwright` npm package next to your
driver script, not in the repo.

Flows worth driving:

- Default dimensions render: Spiritual, Mental, Physical, Relational
  (accordion triggers, selector `[data-slot="accordion-trigger"]`).
- Expand a dimension → fill "Anchor verse or guiding principle" input and
  the note textarea → "Save note" → note card appears with date/time.
- Add a dimension via the top input + Enter or the Add button.
- Reload the page → dimensions, scripture, and notes must persist
  (localStorage key `personal-growth-dimensions`).
- Delete note (aria-label "Delete note") and "Remove dimension".

Probes: whitespace-only dimension name and empty note must be no-ops.

## Gotchas

- Playwright `browser.newPage()` creates an isolated context per call —
  localStorage is NOT shared between pages created that way. Use one
  context (`context.newPage()`) to simulate multiple tabs.
- shadcn/ui here is built on Base UI (`@base-ui/react`), not Radix:
  the Accordion root takes `multiple`, not `type="multiple"`.
