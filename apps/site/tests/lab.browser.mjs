import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright'

const base = process.env.LAB_TEST_URL
const paths = ['/', '/ai-cost/', '/chess/', '/context-autopsy/', '/session-flame/', '/platformer/', '/token-diet/']
const recorded = JSON.parse(await readFile(new URL('../src/lib/session-flame-runs.json', import.meta.url), 'utf8'))
const languages = JSON.parse(await readFile(new URL('../src/data/languages.json', import.meta.url), 'utf8'))

test('homepage terminal grid keeps native keyboard links and works without JavaScript', { skip: !base }, async () => {
  const browser = await chromium.launch()
  try {
    for (const width of [1440, 900, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, javaScriptEnabled: false, reducedMotion: 'reduce' })
      await page.goto(base, { waitUntil: 'networkidle' })
      const panels = page.locator('.experiment-grid a')
      assert.deepEqual(await panels.evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
        ['/session-flame/', '/context-autopsy/', '/token-diet/', '/chess/', '/platformer/'])
      assert.equal(await page.locator('h1').innerText(), 'Raghib’s Lab — Experiments')
      const total = languages.reduce((sum, language) => sum + language.size, 0)
      assert.deepEqual(await page.locator('.language-legend li').allTextContents(), languages.map(({ node, size }) => `${node.name} ${(size / total * 100).toFixed(1)}%`))
      const percentages = await page.locator('.language-bar span').evaluateAll((segments) => segments.map((segment) => Number.parseFloat(segment.style.width)))
      assert.equal(percentages.length, languages.length)
      percentages.forEach((percentage, index) => assert.ok(Math.abs(percentage - languages[index].size / total * 100) < 0.001))
      assert.equal(await page.locator('#flask-toggle').isDisabled(), true)
      const baselineGap = await page.evaluate(() => {
        const wordmark = document.querySelector('.wordmark').getBoundingClientRect()
        const glass = document.querySelector('.glass-edge').getBoundingClientRect()
        const scale = document.querySelector('#flask-toggle svg').getScreenCTM().d
        return Math.abs(wordmark.bottom - (glass.bottom + 1.5 * scale))
      })
      assert.ok(baselineGap < 1, `Visible flask and LAB baselines differ by ${baselineGap}px at ${width}px`)
      assert.equal(await page.locator('.experiment-grid').evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length), width > 1088 ? 3 : width > 672 ? 2 : 1)
      assert.equal(await page.locator('.experiment-preview img').count(), 5)
      assert.doesNotMatch(await page.locator('.experiment-preview img').first().evaluate((img) => img.currentSrc), /\.gif$/)
      if (width > 1088) assert.equal(await panels.evaluateAll((links) => new Set(links.slice(0, 3).map((link) => link.getBoundingClientRect().height)).size), 1)
      assert.ok(await page.locator('.experiment-grid').evaluate((grid) => [...grid.querySelectorAll('a')].every((link) => link.getBoundingClientRect().height >= 44)))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await panels.first().focus()
      assert.equal(await panels.first().evaluate((link) => link.matches(':focus-visible')), true)
      await page.keyboard.press('Tab')
      assert.equal(await panels.nth(1).evaluate((link) => link === document.activeElement), true)
      await page.keyboard.press('Enter')
      await page.waitForURL(new URL('/context-autopsy/', base).href)
      await page.close()
    }
    const motion = await browser.newPage({ reducedMotion: 'no-preference' })
    await motion.goto(base, { waitUntil: 'networkidle' })
    assert.deepEqual(await motion.locator('.experiment-preview img').evaluateAll((images) => images.map((img) => new URL(img.currentSrc).pathname)),
      ['/previews/session-flame.gif', '/previews/context-autopsy.gif', '/previews/token-diet.gif', '/previews/chess.gif', '/previews/platformer.gif'])
  } finally {
    await browser.close()
  }
})

test('pixel platformer presentation is generic and keeps its controls discoverable', { skip: !base }, async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(new URL('/platformer/', base).href, { waitUntil: 'networkidle' })
    assert.equal(await page.title(), 'Pixel Platformer: A 32-Stage Browser Game — Raghib’s Lab')
    assert.equal(await page.locator('h1').innerText(), 'Can You Reach the Last Flag?')
    assert.equal(await page.locator('#game-screen').getAttribute('aria-label'), 'Pixel platformer game screen')
    const copy = await page.locator('body').innerText()
    assert.doesNotMatch(copy, /GitHub|Mona|Woodward|Pimoroni|badger/i)
    assert.match(copy, /Gamepads work too/)
    assert.equal(await page.locator('#sound-toggle').innerText(), 'ENABLE SOUND')
    await page.locator('#sound-toggle').click()
    await page.waitForFunction(() => document.querySelector('#sound-toggle').textContent === 'MUTE')
    await page.keyboard.press('m')
    assert.equal(await page.locator('#sound-toggle').innerText(), 'UNMUTE')
    await page.close()
  } finally {
    await browser.close()
  }
})

test('pixel platformer gamepad play exposes audio activation and basic pause/title controls', { skip: !base }, async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.addInitScript(() => {
      window.pad = { mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) }
      navigator.getGamepads = () => [window.pad]
      window.gameText = []
      const { setTransform, fillText } = CanvasRenderingContext2D.prototype
      CanvasRenderingContext2D.prototype.setTransform = function (...args) {
        if (this.canvas.id === 'game-screen') window.gameText = []
        return setTransform.apply(this, args)
      }
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        if (this.canvas.id === 'game-screen') window.gameText.push(text)
        return fillText.call(this, text, ...args)
      }
      const NativeAudioContext = window.AudioContext
      window.AudioContext = class extends NativeAudioContext {
        constructor(...args) { super(...args); window.gameAudio = this }
      }
    })
    await page.goto(new URL('/platformer/', base).href, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.gameText.includes('PIXEL PLATFORMER'))
    await page.waitForTimeout(10_500)
    assert.equal(await page.evaluate(() => window.gameText.includes('PIXEL PLATFORMER')), true)
    const pressPad = async (button) => {
      await page.evaluate((i) => { window.pad.buttons[i].pressed = true }, button)
      await page.waitForTimeout(100)
      await page.evaluate((i) => { window.pad.buttons[i].pressed = false }, button)
      await page.waitForTimeout(100)
    }
    await page.evaluate(() => dispatchEvent(new Event('gamepadconnected')))
    await pressPad(9)
    await page.waitForFunction(() => window.gameText.includes('PLAYER 1 x3'))
    assert.equal(await page.locator('#sound-toggle').innerText(), 'ENABLE SOUND')
    assert.equal(await page.evaluate(() => window.gameAudio === undefined), true)
    await page.locator('#sound-toggle').click()
    await page.waitForFunction(() => window.gameAudio?.state === 'running' && document.querySelector('#sound-toggle').textContent === 'MUTE')
    await page.locator('#sound-toggle').click()
    assert.equal(await page.locator('#sound-toggle').innerText(), 'UNMUTE')
    await page.keyboard.press('m')
    await page.waitForFunction(() => document.querySelector('#sound-toggle').textContent === 'MUTE')
    await page.evaluate(() => window.gameAudio.suspend())
    await page.waitForFunction(() => document.querySelector('#sound-toggle').textContent === 'ENABLE SOUND')
    await page.keyboard.press('m')
    await page.waitForFunction(() => window.gameAudio.state === 'running' && document.querySelector('#sound-toggle').textContent === 'MUTE')
    await pressPad(9)
    await page.waitForFunction(() => window.gameText.includes('PAUSED'))
    await pressPad(15)
    assert.equal(await page.evaluate(() => window.gameText.includes('PAUSED')), true)
    await pressPad(1)
    await page.waitForFunction(() => !window.gameText.includes('PAUSED') && window.gameText.includes('PLAYER 1 x3'))
    await pressPad(8)
    await page.waitForFunction(() => window.gameText.includes('PIXEL PLATFORMER'))
    await page.close()
  } finally {
    await browser.close()
  }
})

test('pixel platformer touch controls fit narrow portrait and landscape screens', { skip: !base }, async () => {
  const browser = await chromium.launch()
  try {
    for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
      const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true })
      const page = await context.newPage()
      await page.goto(new URL('/platformer/', base).href, { waitUntil: 'networkidle' })
      const buttons = await page.locator('.pad button').evaluateAll((els) => els.map((el) => {
        const { left, top, right, bottom } = el.getBoundingClientRect()
        return { visible: getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none', left, top, right, bottom }
      }))
      assert.equal(buttons.length, 8)
      for (const button of buttons) {
        assert.equal(button.visible, true)
        assert.ok(button.left >= 0 && button.top >= 0 && button.right <= viewport.width && button.bottom <= viewport.height, `${JSON.stringify({ viewport, button })}`)
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await context.close()
    }
  } finally {
    await browser.close()
  }
})

test('homepage flask can pause and respects reduced motion and offscreen visibility', { skip: !base }, async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 600 }, reducedMotion: 'no-preference' })
    await page.goto(base, { waitUntil: 'networkidle' })
    const flask = page.getByRole('button', { name: 'Animate flask', exact: true })
    await page.waitForFunction(() => document.querySelector('#flask-toggle').classList.contains('is-running'))
    await flask.click()
    assert.equal(await flask.getAttribute('aria-pressed'), 'false')
    assert.equal(await page.locator('.liquid').evaluate((liquid) => getComputedStyle(liquid).animationPlayState), 'paused')
    await flask.press('Enter')
    assert.equal(await flask.getAttribute('aria-pressed'), 'true')
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }))
    await page.waitForFunction(() => !document.querySelector('#flask-toggle').classList.contains('is-running'))
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.waitForFunction(() => document.querySelector('#flask-toggle').classList.contains('is-running'))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForFunction(() => document.querySelector('#flask-toggle').getAttribute('aria-pressed') === 'false')
    assert.equal(await page.locator('.liquid').evaluate((liquid) => getComputedStyle(liquid).animationPlayState), 'paused')
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await flask.getAttribute('aria-pressed'), 'false')
  } finally {
    await browser.close()
  }
})

test('standalone pages have working local links, assets and lab canonicals', { skip: !base }, async () => {
  const browser = await chromium.launch()
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      const errors = []
      const badResponses = []
      const requests = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('response', (response) => { if (response.status() >= 400) badResponses.push(response.url()) })
      page.on('request', (request) => requests.push(request))
      for (const path of paths) {
        await page.goto(new URL(path, base).href, { waitUntil: 'networkidle' })
        assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `https://lab.raghib.io${path}`)
        assert.equal(await page.locator('h1').count(), 1)
        assert.equal(await page.locator('#theme-toggle').isVisible(), true)
        const dark = await page.locator('html').getAttribute('data-theme')
        await page.locator('#theme-toggle').click()
        assert.notEqual(await page.locator('html').getAttribute('data-theme'), dark)
        await page.locator('#theme-toggle').click()
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${path} at ${width}px`)
        const links = await page.locator('a[href^="/"], script[src^="/"], link[href^="/"]').evaluateAll(
          (nodes) => nodes.map((node) => node.getAttribute('href') ?? node.getAttribute('src')),
        )
        for (const link of new Set(links)) {
          assert.doesNotMatch(link, /^\/(?:experiments|writing|projects|social-card)/)
          assert.equal((await page.request.get(new URL(link, base).href)).ok(), true, `${path} → ${link}`)
        }
      }
      assert.deepEqual(errors, [])
      assert.deepEqual(badResponses, [])
      assert.equal(requests.every((request) => new URL(request.url()).origin === new URL(base).origin), true, 'No analytics or third-party runtime requests')
      assert.equal(requests.every((request) => request.method() === 'GET'), true)
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test('all nine published flame fixtures load from the new asset paths', { skip: !base }, async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(new URL('/session-flame/', base).href, { waitUntil: 'networkidle' })
    for (const run of recorded.runs) {
      await page.locator('#run-model').selectOption('sample')
      await page.locator('#run-model').selectOption(run.model)
      const loaded = page.waitForResponse((response) => response.url().endsWith(`/session-flame/runs/${run.file}`))
      await page.locator('#run-context').selectOption(run.tier)
      assert.equal((await loaded).status(), 200)
      await page.waitForFunction(({ label, tier }) => document.querySelector('#status')?.textContent ===
        `Showing the recorded ${label} run with the ${tier === 'long_context' ? 'long' : 'default'} context tier.`, run)
      assert.ok(Number(await page.locator('#replay-position').getAttribute('max')) > 0)
    }
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
})

test('context autopsy imports through its worker offline; token diet controls retain both rounds', { skip: !base }, async () => {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors = []
    const mutations = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => { if (request.method() !== 'GET') mutations.push(request.url()) })
    await page.goto(new URL('/context-autopsy/', base).href, { waitUntil: 'networkidle' })
    await context.setOffline(true)
    await page.locator('#data-tab').click()
    await page.locator('#session-files').setInputFiles({
      name: 'usage.jsonl', mimeType: 'application/json',
      buffer: Buffer.from([
        { type: 'session.start', data: { sessionId: 'synthetic-lab-check' } },
        { type: 'assistant.usage', data: { model: 'claude-sonnet-4.5', inputTokens: 1200, outputTokens: 100 } },
      ].map((event) => JSON.stringify(event)).join('\n')),
    })
    await page.waitForFunction(() => !document.querySelector('#clear-button').hidden)
    assert.match(await page.locator('#coverage').textContent(), /1 session/)
    await page.locator('#data-tab').click()
    await page.locator('#clear-button').click()
    assert.equal(await page.locator('#clear-button').isHidden(), true)
    await context.setOffline(false)
    await page.goto(new URL('/token-diet/', base).href, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('.replay').count(), 1)
    await page.locator('.replay').click()
    await page.locator('label[for="tab-round-two"]').click()
    assert.equal(await page.locator('#round-two-title').isVisible(), true)
    assert.ok(await page.locator('.round-two-race .waterfall').count() >= 5)
    await page.locator('label[for="tab-calls"]').click()
    assert.equal(await page.locator('.replay').isVisible(), true)
    assert.deepEqual(errors, [])
    assert.deepEqual(mutations, [])
  } finally {
    await browser.close()
  }
})
