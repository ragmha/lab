// Records a short click-through of each experiment and encodes it as a GIF.
// Usage: bun run build && bun run preview, then `node scripts/record-previews.mjs [baseUrl]`. Needs ffmpeg.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:4321'
const out = new URL('../public/previews/', import.meta.url).pathname
const size = { width: 1280, height: 800 }

const button = (page, name) => page.getByRole('button', { name, exact: true })
const label = (page, name) => page.locator('label', { hasText: name }).first()

const tours = {
  'session-flame': [
    (p) => p.locator('#replay-play').click(),
    (p) => p.waitForTimeout(2500),
    (p) => p.locator('#tab-transcript').click(),
    (p) => p.locator('#tab-breakdown').click(),
    (p) => p.locator('#tab-flame').click(),
  ],
  'context-autopsy': [
    (p) => p.locator('#models-tab').click(),
    (p) => p.locator('#tools-tab').click(),
    (p) => p.locator('#data-tab').click(),
    (p) => p.locator('#overview-tab').click(),
  ],
  'token-diet': [
    (p) => label(p, 'caveman').click(),
    (p) => label(p, 'rtk').click(),
    (p) => label(p, 'All three').click(),
    (p) => p.locator('label[for="tab-tokens"]').click(),
    (p) => p.locator('label[for="tab-round-two"]').click(),
  ],
  chess: [
    (p) => p.locator('[data-square="e2"]:not([disabled])').waitFor({ timeout: 60000 }),
    ...['e2', 'e4', 'g1', 'f3', 'f1', 'c4'].map((square) => (p) =>
      p.locator(`[data-square="${square}"]:not([disabled])`).click({ timeout: 60000 })),
    (p) => p.waitForTimeout(1500),
  ],
}

mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
for (const [slug, steps] of Object.entries(tours)) {
  const dir = mkdtempSync(join(tmpdir(), `preview-${slug}-`))
  const context = await browser.newContext({ viewport: size, colorScheme: 'dark', recordVideo: { dir, size } })
  const page = await context.newPage()
  await page.goto(`${base}/${slug}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  for (const step of steps) {
    await step(page)
    await page.waitForTimeout(1300)
  }
  await context.close()
  const video = join(dir, readdirSync(dir).find((file) => file.endsWith('.webm')))
  // Skip the blank first second while the page loads.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1', '-i', video, '-vf',
    'fps=8,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
    '-loop', '0', join(out, `${slug}.gif`)])
  rmSync(dir, { recursive: true })
  console.log(`✓ ${slug}.gif`)
}
await browser.close()
