# Source provenance and licenses

Migrated from the public [ragmha/raghib.io](https://github.com/ragmha/raghib.io)
repository at commit
[`0eef566691a2af66105390f5b93507e58f801d34`](https://github.com/ragmha/raghib.io/tree/0eef566691a2af66105390f5b93507e58f801d34).
Only tracked files from that commit were copied. The source repository was
not changed by this extraction.

## Migration map

| Original path | Standalone path |
| --- | --- |
| `src/pages/experiments/{index,chess,context-autopsy,session-flame,token-diet}.astro` | `src/pages/` with the same filenames |
| `public/experiments/chess/` | `public/chess/`, all four files |
| `public/experiments/session-flame/runs/` | `public/session-flame/runs/`, all nine published JSONL files |
| `src/lib/{agent-usage,agent-usage.worker,model-pricing,chess,session-flame,session-comparison,token-diet}.ts` | Same paths |
| `src/lib/session-flame-runs.json` | Same path |
| `src/data/token-diet.json`, `src/data/token-diet-2.json` | Same paths |
| `src/scripts/chess.ts`, `src/scripts/theme.js` | Same paths |
| `scripts/token-diet/` | All 31 tracked files, same paths; ignored `.work/` excluded |
| `public/copilot-export.sh`, `public/copilot-export.ps1` | Same paths |
| `public/favicon.svg`, `public/fonts/jetbrains-mono/` | Same paths, including all four fonts and OFL notice |
| `src/components/{SiteHeader,ThemeInit,ThemeToggle}.astro` | Same paths |
| `src/layouts/{BaseLayout,SiteLayout}.astro` | Same paths |
| `src/styles/{global,site,theme,fonts,layout}.css` | Same paths |
| `tests/{agent-usage,chess,token-diet,session-flame,session-comparison,copilot-export}.test.ts`, `tests/theme.test.mjs` | Same paths |
| `tests/{chess,session-flame}.browser.mjs` | Same paths |
| `LICENSE` | Same MIT notice |

The experiments retain their logic, measurements, workers, import/export
features, and page-local styling. Changes are relative imports, root URLs,
the reproduction-kit link, lab navigation/metadata, and standalone build,
deployment, and test setup. The index no longer uses the blog archive
layout. `SeoHead.astro` is a small lab-specific replacement: no blog feed,
social-card assumptions, verification tokens, or analytics.

The blog still needs its shared theme/header components, theme controller,
layouts, styles, fonts, favicon, and its own SEO/nav components. They were
copied, not moved out of the blog. Compatibility download copies may also
remain in the blog. Experiment-only code/data/test cleanup and legacy URL
redirects are maintained in that repository separately.

## Licenses

Original site and experiment code: **MIT**, copyright © 2026 Raghib Hasan;
see [LICENSE](LICENSE). Third-party assets keep their own licenses:

- **Stockfish.js 19.0.1**, lite single-threaded worker and WebAssembly:
  **GPLv3**, not MIT. Copyright includes the Stockfish developers and Nathan
  Rugg. Both distribution files are unmodified. Full license:
  [`public/chess/COPYING.txt`](public/chess/COPYING.txt).
  Matching release, corresponding source archive, build instructions,
  Emscripten version, and SHA-256 hashes:
  [`public/chess/SOURCE.txt`](public/chess/SOURCE.txt).
  Keep these notices and access to corresponding source when distributing
  the engine; the MIT license does not relicense it.
- **JetBrains Mono**: **SIL Open Font License 1.1**, retained in
  [`public/fonts/jetbrains-mono/OFL.txt`](public/fonts/jetbrains-mono/OFL.txt).
  Pinned upstream source is recorded in `src/styles/fonts.css`.
- **chess.js 1.4.0**: BSD-2-Clause, distributed through Bun with its package
  license. Remaining npm dependencies retain their package licenses.
- The reproduction kit refers to separately installed caveman, rtk, and
  Token Optimizer. Those third-party tools are not vendored here. In
  particular, Token Optimizer's noncommercial license still applies to
  anyone choosing to run that optional setup.
