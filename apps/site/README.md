# @lab/site

The Astro site behind [lab.raghib.io](https://lab.raghib.io/). Each static lab
is a page in `src/pages/`.

| Lab | What it does |
| --- | --- |
| [Universe Passport](https://lab.raghib.io/universe/passport/) | Learn the Universe 2026 releases, stamp lessons, and check your understanding |
| [Universe field guide](https://lab.raghib.io/universe/) | Read the lessons, optional labs, release inventory, and download the slides |
| [AI Cost](https://lab.raghib.io/ai-cost/) | Explore one organization’s AI-credit billing and Copilot usage |
| [Chess](https://lab.raghib.io/chess/) | Play Stockfish locally |
| [Context Autopsy](https://lab.raghib.io/context-autopsy/) | Inspect agent-session context and token use |
| [Session Flame](https://lab.raghib.io/session-flame/) | Replay sessions as a flame chart |
| [Pixel Platformer](https://lab.raghib.io/platformer/) | Play a 32-stage pixel platformer in the browser |
| [Token Diet](https://lab.raghib.io/token-diet/) | Compare recorded token-use experiments |

Scripts (`dev`, `check`, `build`, `preview`, `test`, `test:browser`) run from
here or from the root. Add new browser suites to the `files` list in
`scripts/test-browser.mjs`.

## Universe progress

Progress stays on your device; the Passport and field guide share it in the
same browser. **Export progress** and **Import** move it between devices or the
[Copilot canvas](../../.github/extensions/universe-passport/), which saves under
`~/.copilot/extensions/universe-passport/artifacts/` (`COPILOT_HOME` overrides
the base). No accounts, sync, or team tracking.

Release availability is a sourced snapshot checked 1–2 November 2026. Lessons
never run agents, change permissions, or spend credits.

## AI cost data

`/ai-cost/` reads only `src/data/ai-cost.json`: daily organization totals,
monthly credit totals, and public product and model names derived from one
unnamed organization's private GitHub exports (AI-credit billing usage and the
Copilot `organization-28-day` and `users-28-day` metrics reports). Raw exports,
logins, and user, organization, and enterprise IDs are never committed. To
regenerate, keep the exports outside the repository and run
`bun scripts/ai-cost/aggregate.ts <folder>` from here; the header comment lists
the expected file names. It refuses to write if an identifier, or a monthly
credit total from fewer than five users, would be published.

The page fits one screen (`SiteLayout`'s opt-in `fit` mode, used only here)
with six tabs. Tabs and the group and month controls are plain CSS, so they
work without JavaScript; a small same-origin inline script only adds `#tab`
deep links, tooltips, and hover highlighting, and makes no requests. On small
phones a tab's panel scrolls inside the fixed frame instead of the page.

The [token-diet reproduction kit](scripts/token-diet/README.md) can consume paid
model credits.
