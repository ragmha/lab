# @lab/site

The Astro site behind [lab.raghib.io](https://lab.raghib.io/). Each static lab
is a page in `src/pages/`.

| Lab | What it does |
| --- | --- |
| [Universe Passport](https://lab.raghib.io/universe/passport/) | Learn the Universe 2026 releases, stamp lessons, and check your understanding |
| [Universe field guide](https://lab.raghib.io/universe/) | Read the lessons, optional labs, release inventory, and download the slides |
| [Chess](https://lab.raghib.io/chess/) | Play Stockfish locally |
| [Context Autopsy](https://lab.raghib.io/context-autopsy/) | Inspect agent-session context and token use |
| [Session Flame](https://lab.raghib.io/session-flame/) | Replay sessions as a flame chart |
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

The [token-diet reproduction kit](scripts/token-diet/README.md) can consume paid
model credits.
