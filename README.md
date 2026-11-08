# Raghib's Lab

Small, interactive experiments. Static labs are live at
**[lab.raghib.io](https://lab.raghib.io/)**; fullstack labs run on your machine.

A [Bun workspaces](https://bun.com/guides/install/workspaces) monorepo.

```text
apps/site/        Astro site with every static lab → GitHub Pages
apps/<name>/      Fullstack lab: Bun server + frontend, runs locally
packages/<name>/  Shared code, once two apps need it
.github/          CI and the Universe Passport Copilot canvas
```

## Setup

Requires Bun 1.3.5 and Node.js 22.12+.

```sh
bun install
```

## Commands

Run from the root.

| Command | Does |
| --- | --- |
| `bun run dev` | Start the site at <http://localhost:4321> |
| `bun run test` | Run every workspace's `test` script |
| `bun run build` | Type-check and build the site to `apps/site/dist` |
| `bun run test:browser` | Browser tests against the built site |
| `bun run --filter <name> <script>` | Run any script in one workspace |

Browser tests need `cd apps/site && bunx playwright install chromium webkit` once.

## Add a lab

**Static** (deploys with the site): add `apps/site/src/pages/<slug>.astro`
and an entry in the `experiments` list in `apps/site/src/pages/index.astro`.

**Fullstack** (runs locally): create `apps/<name>/` with its own
`package.json`, then `bun install` from the root.

```json
{
  "name": "@lab/<name>",
  "private": true,
  "type": "module",
  "scripts": { "dev": "bun --hot server.ts" }
}
```

```ts
// apps/<name>/server.ts: index.html can load .ts/.tsx; Bun bundles it.
import index from './index.html'

Bun.serve({
  hostname: '127.0.0.1',
  port: 3001,
  routes: {
    '/': index,
    '/api/hello': () => Response.json({ hello: 'lab' }),
  },
})
```

Run it with `bun run --filter @lab/<name> dev`. Add dependencies with
`bun add` inside the app folder; share code through `packages/<name>` and
`"@lab/<name>": "workspace:*"`. Keep one `bun.lock` at the root.

## Writing links

`apps/site/src/data/content-links.json` lists published lab routes. Add an optional
`"writing": "writing-slug"` only for an editorially confirmed match; that lab
then links to `https://raghib.io/writing/writing-slug/`. The writing's frontmatter
must carry `lab: lab-slug` linking back to `https://lab.raghib.io/lab-slug/`.
Slugs are lowercase and hyphenated; nested lab routes such as `universe/passport`
are supported. Do not copy articles or synchronize Git histories between sites.

Both sites publish `/content-links.json`: this site exposes
`{"labs":[{"slug":"token-diet","writing":"writing-slug"}]}` and raghib.io
exposes `{"writings":[{"slug":"writing-slug","lab":"token-diet"}]}`.
Inventories must include unpaired published entries, not just linked ones.

```sh
bun run check:links
# Before both sites deploy, pass an exported raghib.io inventory instead:
bun run check:links /path/to/writing-content-links.json
```

Missing counterparts, invalid slugs, duplicates and non-reciprocal pairs fail
the check. Unpaired entries print `GAP` for editorial review without failing.
Unavailable inventories fail explicitly. Run after either site's content changes;
the remote check is deliberately not a build prerequisite, so independently
deployed sites do not block each other while a counterpart is still shipping.

## Performance

```sh
cd apps/site && bunx playwright install chromium && cd ../..
bun run measure:performance
# Or measure a running local preview:
LAB_TEST_URL=http://127.0.0.1:4321 bun run measure:performance
```

The installed Playwright records a cold mobile-sized, throttled Chromium visit
to every lab route in `.checks/performance.json`: TTFB, load time, LCP, CLS and
observed transfer bytes. CI measures its checked preview after browser tests
and saves the `lab-performance` artifact for each run, including pull requests.
Compare the same route and conditions before/after a change. Local-preview
results exclude production hosting and DNS; run against production for those.
These are single synthetic samples, not audience traffic, real-user percentiles
or a fabricated performance score. The report records conditions and limitations.

Cloudflare Web Analytics is not configured by this repository. Real-user
measurement needs the site owner to enable it and supply the public beacon
configuration; no account settings or credentials are changed here.

## Deploy

Pushes to `main` run CI and publish `apps/site/dist` to GitHub Pages.
Fullstack labs are not deployed.

See [sources and licenses](PROVENANCE.md).
