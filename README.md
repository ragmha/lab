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

## Deploy

Pushes to `main` run CI and publish `apps/site/dist` to GitHub Pages.
Fullstack labs are not deployed.

See [sources and licenses](PROVENANCE.md).
