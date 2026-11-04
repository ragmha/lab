# Raghib's Lab

> Small, interactive experiments that run in your browser.

Visit **[lab.raghib.io](https://lab.raghib.io/)**.

| Experiment | What it does |
| --- | --- |
| [Universe Passport](https://lab.raghib.io/universe/passport/) | Learn the Universe 2026 releases, stamp lessons, and check your understanding |
| [Universe field guide](https://lab.raghib.io/universe/) | Read the lessons, optional labs, release inventory, and download the slides |
| [Chess](https://lab.raghib.io/chess/) | Play Stockfish locally |
| [Context Autopsy](https://lab.raghib.io/context-autopsy/) | Inspect agent-session context and token use |
| [Session Flame](https://lab.raghib.io/session-flame/) | Replay sessions as a flame chart |
| [Pixel Platformer](https://lab.raghib.io/platformer/) | Play a 32-stage pixel platformer in the browser |
| [Token Diet](https://lab.raghib.io/token-diet/) | Compare recorded token-use experiments |

## Run locally

Requires Bun 1.3.5 and Node.js 22.12+.

```sh
bun install --frozen-lockfile
bun run dev
```

## Check

```sh
bun run test
bun run build
bunx playwright install chromium webkit
bun run test:browser
```

Pushes to `main` deploy to GitHub Pages after these checks pass.

## Progress

Universe progress stays on your device. The public Passport and field guide
share progress in the same browser. Use **Export progress** and **Import**
to move it between devices or the [Copilot canvas](.github/extensions/universe-passport/).
There are no accounts, automatic cross-device sync, or team tracking.
The canvas saves locally under `~/.copilot/extensions/universe-passport/artifacts/`
(`COPILOT_HOME` overrides the base directory).

> [!NOTE]
> Release availability is a sourced snapshot: launch-day coverage checked
> 1 November 2026, with two release-week additions checked 2 November.
> Lessons never run agents, change permissions, or spend credits.

See [sources and licenses](PROVENANCE.md) and the optional
[reproduction kit](scripts/token-diet/README.md), which can consume paid model credits.
