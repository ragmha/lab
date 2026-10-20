# Raghib’s Lab

Independent, browser-only experiments by [Raghib Hasan](https://raghib.io/).
The canonical site is **https://lab.raghib.io**, hosted on free GitHub Pages.
Pushes to `main` deploy the checked build once the repository's Pages settings
and custom domain are configured.

| Path | Experiment |
| --- | --- |
| `/` | Experiment index |
| `/chess/` | Stockfish chess, live search details, and context-window illustration |
| `/context-autopsy/` | Local agent-session usage, cache, context, and cost analysis |
| `/session-flame/` | Session replay, flame charts, recorded comparisons, evidence export |
| `/token-diet/` | Two recorded token-use experiments and their reproduction kit |

## Develop and verify

Install Bun 1.3.5 and Node.js 22.12 or later:

```sh
bun install --frozen-lockfile
bun run dev
bun run test
bun run build
bunx playwright install chromium webkit
bun run test:browser
```

`build` runs Astro checking **and TypeScript checking**, including the
reproduction scripts, before generating `dist/`. `test:browser` starts its
own production preview on `127.0.0.1:4397`, runs all browser suites fail-fast,
and stops the preview. Build first. Set `LAB_TEST_URL` to check an already
running server instead. Browser suites use Node's native test runner with
fail-fast cancellation; unit tests use Bun. CI installs browser OS dependencies and runs unit
tests, the typechecked build, and the same browser checks.

The browser checks cover the real Stockfish worker/WASM (including offline
play), session replay and comparison downloads in Chromium and WebKit,
all nine published fixture selections, offline context import through its
worker, token-diet round switching, themes, small screens, and local links.

The homepage uses a responsive terminal-style grid (four, two, or one column),
with a pausable SVG flask that starts still for reduced-motion preferences.
Its language bar shows GitHub Linguist's source-byte breakdown, not usage or
traffic. CI refreshes the data from GitHub on each main-branch deployment;
local and PR builds use the checked-in `src/data/languages.json` snapshot,
so building locally does not require network access or credentials. GitHub's
language analysis can lag the latest commit. The browser makes no GitHub API calls.

## Privacy and source data

Imported sessions are parsed on the device, not uploaded. There are no
analytics, server handlers, accounts, databases, or third-party runtime
requests. The theme choice alone is stored in local storage. Downloadable
Copilot helpers copy local files or capture a new CLI invocation; inspect
raw logs before sharing them.

Only previously published experiment fixtures and measurements were
imported. No private `.work/` trees, personal session logs, credentials,
or local configuration were copied. Hash tests preserve the nine recorded
TodoMVC fixtures and both unmodified Stockfish distribution files.

See [source provenance and licenses](PROVENANCE.md) and the
[token-diet reproduction kit](scripts/token-diet/README.md). The kit is
optional: it requires separately authenticated agent tooling and may consume
paid model credits. Normal installation, builds, and tests do not run it.
Its seeded Python fixture intentionally contains bugs; it is not a passing
application test suite.

## Hosting: GitHub Pages

This public repository uses GitHub Pages for free static hosting. The
existing CI job installs from the lockfile, runs unit tests, typechecks and
builds Astro, and runs the browser suites. Only a successful push to `main`
uploads `dist/` as a Pages artifact and deploys that exact build. Pull requests
run the checks but never deploy. Deployment uses GitHub's built-in token and
OIDC permissions; no deployment secrets or external hosting account are needed.

### One-time repository and domain setup

1. In `ragmha/lab` → **Settings → Pages**, select **GitHub Actions** as the
   build and deployment source.
2. Set the custom domain to **lab.raghib.io** in those Pages settings.
   `public/CNAME` also records this domain and is copied to `dist/CNAME`;
   the file does not replace the custom-domain setting for Actions deployments.
3. In **Namecheap → Advanced DNS**, add or update this record:

   | Type | Host | Value |
   | --- | --- | --- |
   | CNAME | `lab` | `ragmha.github.io` |

   Remove conflicting records for `lab` only. Do not include `https://` or
   `/lab` in the value. Keep Namecheap nameservers and the blog's existing
   apex/`www` DNS records unchanged. **raghib.io stays on GitHub Pages** in its
   own repository; it does not move with the experiments.
4. Wait for GitHub's domain check and certificate issuance, then enable
   **Enforce HTTPS**. If the initial deployment ran before Pages was enabled,
   rerun the workflow after completing the repository setup.

The workflow publishes the site but does not configure Pages settings or DNS.
Repository administrators handle the one-time setup above.

The original blog’s `/experiments/` and `/experiments/<name>/` redirects
belong in the **raghib.io repository**, not here. Old blog download URLs may
remain there as compatibility copies.

### If an experiment needs a backend later

Today's experiments run entirely in the browser. GitHub Pages serves static
files, not server-side functions, and that is all they currently need. Add
a separate backend or move hosts only when an actual server-side feature
requires it; no API endpoints, databases, or paid services are provisioned.

The build remains portable: `dist/` can be served by another static host with
directory indexes, JavaScript, JSONL, fonts, and `.wasm` (`application/wasm`).
Keep the same asset paths and custom domain. If the domain changes, update
`site` in `astro.config.mjs`, `public/CNAME`, and the canonical assertions in
the tests, then rebuild.
