# Raghib’s Lab

Independent, browser-only experiments by [Raghib Hasan](https://raghib.io/).
The canonical site is **https://lab.raghib.io**. Deployment and domain setup
are separate from this repository; creating it does not publish the site.

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

## Hosting: any static host

Upload `dist/` to any static host that serves directory indexes, JavaScript,
JSONL, fonts, and `.wasm` (`application/wasm`). Keep the same asset paths.
Astro generates the pages; no Node.js or Bun server is needed in production.
If the public domain changes, update `site` in `astro.config.mjs` and the
canonical assertions in `tests/lab.browser.mjs`, then rebuild.

The original blog’s `/experiments/` and `/experiments/<name>/` redirects
belong in the **raghib.io repository**, not here. Old blog download URLs may
remain there as compatibility copies.

### Optional: Cloudflare Pages Free

Cloudflare is **not required** for repository separation or any current
experiment. The included Wrangler tooling is an optional deployment path
if Pages is selected. No Cloudflare credentials are needed by CI.

Choose a Pages project name in `wrangler.toml` (`lab` is the initial
suggestion, not a claim that the project exists). A one-time direct-upload
setup, only after choosing the host and account:

```sh
bunx wrangler login
bunx wrangler pages project create lab --production-branch main
bun run deploy
```

`deploy` builds before invoking `wrangler pages deploy dist`. The account
must have permission to create/deploy that Pages project. Alternatively,
connect this GitHub repository in Pages, with production branch `main`,
build command `bun run build`, output `dist`, and Bun 1.3.5 / Node 22.
Keep Free billing; no paid product is needed for the current static apps.

For the custom subdomain, add **lab.raghib.io** in the Pages project's
custom-domain settings first. Once Cloudflare provides the actual project
hostname, add this record in Namecheap Advanced DNS:

| Type | Host | Value |
| --- | --- | --- |
| CNAME | `lab` | the actual `<project>.pages.dev` hostname |

Do not guess the hostname, include `https://`, move nameservers, or change
the apex/blog records. Domain validation and TLS must finish before the
custom domain works. This repository does not change DNS or deploy itself.

### Optional future Pages Functions

There are deliberately **no Functions today**. When a real server-side
feature is needed, add Pages Functions under a root `functions/` directory
and test using `bun run build && bun run pages:dev`. Wrangler deploys that
directory alongside `dist/`; dashboard drag-and-drop does not compile
Functions. Scope Function routes to only the new server-side feature so
existing static apps stay static. Review current Workers Free request/CPU
limits before enabling it. Add bindings/secrets only for actual needs,
never commit `.dev.vars`, and do not assume a database or paid plan.
