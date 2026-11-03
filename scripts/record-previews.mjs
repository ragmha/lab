// Records a short click-through of each experiment and encodes it as a GIF.
// Usage: bun run build && bun run preview, then `node scripts/record-previews.mjs [baseUrl] [slug...]`. Needs ffmpeg.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:4321'
const only = process.argv.slice(3)
const out = new URL('../public/previews/', import.meta.url).pathname
const size = { width: 1280, height: 800 }

const button = (page, name) => page.getByRole('button', { name, exact: true })
const label = (page, name) => page.locator('label', { hasText: name }).first()

// Super Mona's showcase run: jump presses and holds in seconds of play, checked against the engine to take 1-1's
// opening big with two stars and four stomps at 50 to 240 fps. It pauses before the next bug reaches Mona.
const monaRun = {
  jumps: [[1.631, 0.05], [2.774, 0.05], [4.815, 0.12], [5.398, 0.3], [6.315, 0.3], [6.748, 0.05], [8.456, 0.45], [9.057, 0.3]],
  pause: 9.95,
}

// In the page: start a game holding right, play the jumps on game time so a slow recorded frame shifts nothing,
// then pause. Resolves with the last lives text the HUD drew.
function playMona({ jumps, pause }) {
  const key = (type, code) => dispatchEvent(new KeyboardEvent(type, { code }))
  const proto = CanvasRenderingContext2D.prototype
  const { fillText } = proto
  let hud = ''
  proto.fillText = function (text, ...rest) {
    if (text.startsWith('MONA x')) hud = text
    return fillText.call(this, text, ...rest)
  }
  const keys = jumps.flatMap(([at, hold]) => [[at, 'keydown'], [at + hold, 'keyup']])
  key('keydown', 'Enter')
  key('keyup', 'Enter')
  key('keydown', 'ArrowRight')
  let last = 0
  let t = 0
  return new Promise((resolve) => requestAnimationFrame(function tick(now) {
    // This runs after the game's frame, the same dt the game used; a key sent now counts from its next frame.
    const dt = last ? Math.min(now - last, 50) / 1000 : 0
    last = now
    if (hud) t += dt
    const next = t + Math.min(dt || 1 / 60, 1 / 60)
    while (hud && keys.length && keys[0][0] <= next) key(keys.shift()[1], 'KeyZ')
    if (!hud || next < pause) return requestAnimationFrame(tick)
    key('keyup', 'ArrowRight')
    key('keydown', 'Enter')
    key('keyup', 'Enter')
    proto.fillText = fillText
    resolve(hud)
  }))
}

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
  'super-mona': [
    async (p) => {
      const hud = await p.evaluate(playMona, monaRun)
      if (hud !== 'MONA x3') throw new Error(`Mona lost a life on the recorded run (${hud})`)
    },
  ],
}

mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
for (const [slug, steps] of Object.entries(tours).filter(([slug]) => !only.length || only.includes(slug))) {
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
