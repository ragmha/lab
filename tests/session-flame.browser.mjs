import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { chromium, webkit } from 'playwright'

const url = process.env.SESSION_FLAME_TEST_URL
const screenshots = process.env.SESSION_FLAME_SCREENSHOTS
const origin = Date.parse('2026-01-05T09:00:00Z')
const prompt = 'Read <script>window.injected = true</script> as literal text.'
const fixture = [
  [0, 'session.start', { context: { repository: 'example/replay' } }],
  [1000, 'user.message', { content: prompt }],
  [2000, 'assistant.turn_start', {}],
  [3000, 'assistant.message', { content: 'Inspecting the files.' }],
  [4000, 'tool.execution_start', { toolCallId: 'a', toolName: 'bash', arguments: { command: 'bun test' } }],
  [4000, 'tool.execution_start', { toolCallId: 'b', toolName: 'view', arguments: { path: 'example.ts' } }],
  [6000, 'tool.execution_complete', { toolCallId: 'b', success: true, result: { content: 'File contents' } }],
  [7000, 'tool.execution_complete', { toolCallId: 'a', success: false, error: { message: 'One test failed' } }],
  [8000, 'assistant.message', { content: 'The test failed.' }],
  [9000, 'assistant.turn_end', {}],
  [130000, 'user.message', { content: 'Try again.' }],
  [131000, 'assistant.turn_start', {}],
  [132000, 'assistant.message', { content: 'Working on the fix.' }],
  [133000, 'tool.execution_start', { toolCallId: 'c', toolName: 'bash', arguments: { command: 'bun test' } }],
  [135000, 'session.shutdown', {}],
].map(([at, type, data]) => JSON.stringify({
  type, data, timestamp: new Date(origin + at).toISOString(),
})).join('\n')

async function seek(page, at) {
  await page.locator('#replay-position').evaluate((input, value) => {
    input.value = String(value === 'end' ? input.max : value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, at)
}

async function loadFixture(page) {
  await page.locator('#session-file').setInputFiles({
    name: 'replay.jsonl', mimeType: 'application/json', buffer: Buffer.from(fixture),
  })
  await page.waitForFunction(() => document.querySelector('#status')?.textContent?.startsWith('Loaded replay.jsonl'))
}

test('recorded comparisons keep a shared scale, distinguish context from input and export evidence', { skip: !url }, async () => {
  const recorded = (name, model, duration, inputTokens) => ({
    name, mimeType: 'application/json',
    buffer: Buffer.from([
      [0, 'session.start', { selectedModel: model }],
      [1000, 'user.message', { content: 'Build TodoMVC. PRIVATE_PROMPT' }],
      [2000, 'assistant.turn_start', {}],
      [3000, 'assistant.usage', { model, ...(inputTokens === undefined ? {} : { inputTokens }), outputTokens: 300 }],
      [duration, 'assistant.turn_end', {}],
      [duration + 1000, 'session.shutdown', {}],
    ].map(([at, type, data]) => JSON.stringify({
      type, data, timestamp: new Date(origin + at).toISOString(),
    })).join('\n')),
  })
  const files = [
    recorded('claude-small-fixture.jsonl', 'claude-fixture', 10000, 2400),
    recorded('claude-large-fixture.jsonl', 'claude-fixture', 20000, 9600),
    recorded('openai-fixture.jsonl', 'openai-fixture', 30000),
  ]
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      for (const width of [1440, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } })
        const errors = []
        page.on('pageerror', (error) => errors.push(error.message))
        await page.goto(url, { waitUntil: 'networkidle' })
        await page.locator('#compare-open').click()
        assert.equal(await page.locator('#compare-export').isDisabled(), true)
        assert.equal(await page.locator('.transport').isVisible(), false)
        await page.locator('#compare-files').setInputFiles(files)
        await page.waitForFunction(() => document.querySelector('#compare-status').textContent.startsWith('3 logs loaded'))
        assert.match(await page.locator('#compare-a-facts').textContent(), /Input\/call 2.4k tokens · Context snapshots Not recorded/)
        assert.match(await page.locator('#compare-b-facts').textContent(), /Input\/call 9.6k/)
        assert.match(await page.locator('#compare-scale').textContent(), /0:30\.00/)
        assert.equal(await page.locator('#comparison').evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true)

        const rootWidth = (slot) => page.locator(`#compare-${slot}-chart`).evaluate((canvas) => {
          const ctx = canvas.getContext('2d')
          const y = Math.round(30 * devicePixelRatio)
          const { data } = ctx.getImageData(0, y, canvas.width, 1)
          const color = Array.from(data.slice(8, 12)).join(',')
          let pixels = 0
          for (let x = 0; x < canvas.width; x++) {
            if (Array.from(data.slice(x * 4, x * 4 + 4)).join(',') === color) pixels++
          }
          return pixels
        })
        await page.waitForFunction(() => document.querySelector('#compare-a-chart').height > 30)
        const aWidth = await rootWidth('a')
        const bWidth = await rootWidth('b')
        assert.ok(Math.abs(aWidth * 2 - bWidth) <= 3, `10s flame is half the width of 20s flame: ${aWidth}, ${bWidth}`)
        await page.locator('#compare-b').selectOption('2')
        await page.waitForFunction(() => document.querySelector('#compare-b-chart').getAttribute('aria-label').includes('openai-fixture'))
        assert.equal(await rootWidth('a'), aWidth, 'Changing candidates cannot rescale the baseline')
        assert.match(await page.locator('#compare-b-facts').textContent(), /Input\/call Not recorded/)

        const downloadPromise = page.waitForEvent('download')
        await page.locator('#compare-export').click()
        const download = await downloadPromise
        const markdown = await readFile(await download.path(), 'utf8')
        assert.match(markdown, /SHA-256 `[a-f0-9]{64}`/)
        assert.match(markdown, /claude-fixture/)
        assert.match(markdown, /openai-fixture/)
        assert.match(markdown, /not proof/)
        assert.doesNotMatch(markdown, /PRIVATE_PROMPT/)
        assert.equal(download.suggestedFilename(), 'session-comparison.md')

        await page.locator('#compare-files').setInputFiles([files[0], {
          name: 'invalid.jsonl', mimeType: 'application/json', buffer: Buffer.from('not a session'),
        }])
        await page.waitForFunction(() => document.querySelector('#compare-status').textContent.includes('previous comparison is unchanged'))
        assert.equal(await page.locator('#compare-a option').count(), 3)
        assert.equal(await page.locator('#compare-export').isEnabled(), true)
        await page.locator('#compare-files').setInputFiles([files[0], { ...files[0], name: 'duplicate.jsonl' }])
        await page.waitForFunction(() => document.querySelector('#compare-status').textContent.includes('same log'))
        assert.equal(await page.locator('#compare-a option').count(), 3)
        await page.locator('#compare-files').setInputFiles([files[0]])
        assert.match(await page.locator('#compare-status').textContent(), /Choose 2–6/)
        await page.locator('#compare-files').setInputFiles(files)
        await page.waitForFunction(() => document.querySelector('#compare-status').textContent.startsWith('3 logs loaded'))

        if (screenshots && engine === chromium) {
          await mkdir(screenshots, { recursive: true })
          await page.locator('#comparison').evaluate((node) => { node.scrollTop = 0 })
          await page.screenshot({ path: join(screenshots, `comparison-${width}.png`) })
        }
        await page.locator('#compare-a-inspect').click()
        assert.equal(await page.locator('#comparison').isVisible(), false)
        assert.equal(await page.locator('.transport').isVisible(), true)
        assert.match(await page.locator('#coverage').textContent(), /claude-small-fixture/)
        await page.locator('#compare-open').click()
        assert.equal(await page.locator('#compare-a option').count(), 3, 'Comparison survives inspecting a run')
        await page.locator('#compare-close').click()
        assert.equal(await page.locator('#compare-open').evaluate((node) => node === document.activeElement), true)
        assert.deepEqual(errors, [])
        await page.close()
      }
    } finally {
      await browser.close()
    }
  }
})

test('session replay synchronizes playback, event stepping, scrubbing and chart inspection', { skip: !url }, async () => {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(url, { waitUntil: 'networkidle' })
      await loadFixture(page)
      await page.clock.install({ time: new Date(origin) })
      await page.clock.pauseAt(new Date(origin + 1000))

      assert.equal(await page.locator('#replay-previous').isDisabled(), true)
      await page.locator('#replay-next').click()
      assert.equal(await page.locator('#replay-content').textContent(), prompt)
      assert.equal(await page.locator('#replay-phase').textContent(), 'Prompt')
      assert.match(await page.locator('#story-line').textContent(), /^You ask: “/)
      assert.equal(await page.locator('#gauge-text').textContent(), 'Context not measured yet')
      assert.equal(await page.locator('#story-steps [aria-current="step"]').getAttribute('data-phase'), 'prompt')
      assert.equal(await page.evaluate(() => window.injected), undefined, 'Imported content is text, not HTML')
      await page.locator('#replay-next').click()
      assert.match(await page.locator('#replay-content').textContent(), /Waiting for the next recorded/)
      assert.doesNotMatch(await page.locator('#replay-content').textContent(), /failed/)
      await page.locator('#replay-next').click()
      assert.equal(await page.locator('#replay-content').textContent(), 'Inspecting the files.')
      assert.equal(await page.locator('#replay-phase').textContent(), 'Reply')
      await page.locator('#replay-next').click()
      assert.equal(await page.locator('#replay-event-title').textContent(), 'Started bash')
      assert.equal(await page.locator('#replay-phase').textContent(), 'Act')
      assert.match(await page.locator('#story-line').textContent(), /^The agent runs bash/)
      assert.equal(await page.locator('#story-steps [aria-current="step"]').getAttribute('data-phase'), 'act')
      assert.equal(await page.locator('#story-steps [data-phase="reply"]').getAttribute('data-done'), '', 'Earlier steps of this exchange stay lit')
      assert.equal(await page.locator('#replay-event-title .icon').getAttribute('aria-label'), 'Tool call')
      assert.match(await page.locator('#replay-event-meta').textContent(), / · Tool call · tool\.execution_start$/)
      const tiedTime = await page.locator('#replay-clock').textContent()
      await page.locator('#replay-next').click()
      assert.equal(await page.locator('#replay-event-title').textContent(), 'Started view')
      assert.equal(await page.locator('#replay-clock').textContent(), tiedTime)
      await page.locator('#replay-previous').click()
      assert.equal(await page.locator('#replay-event-title').textContent(), 'Started bash')
      assert.match(await page.locator('#replay-content').textContent(), /bun test/)

      await seek(page, 5000)
      assert.match(await page.locator('#replay-running').textContent(), /bash.*view/)
      assert.doesNotMatch(await page.locator('#replay-content').textContent(), /One test failed/)
      const chart = await page.locator('#chart').boundingBox()
      assert.ok(chart)
      const length = Number(await page.locator('#replay-position').getAttribute('max'))
      await page.locator('#chart').click({ position: { x: chart.width * 7100 / length, y: 5 } })
      assert.equal(await page.locator('#replay-event-title').textContent(), 'Failed bash')
      assert.match(await page.locator('#replay-content').textContent(), /One test failed/)
      const inspectedAt = await page.locator('#replay-clock').textContent()
      await page.locator('#replay-inspect').click()
      assert.match(await page.locator('#span-title').textContent(), /bash/)
      assert.equal(await page.locator('#replay-clock').textContent(), inspectedAt, 'Inspecting a result does not rewind it')

      await seek(page, 0)
      const observeLane = 26 + 3 * 12 + 6
      await page.locator('#chart').click({ position: { x: chart.width * 7000 / length, y: observeLane } })
      assert.equal(await page.locator('#replay-event-title').textContent(), 'Failed bash', 'Event lanes seek to their events')
      assert.equal(await page.locator('#replay-phase').textContent(), 'Observe')

      await seek(page, 0)
      assert.equal(await page.locator('#replay-position').isVisible(), false, 'The scrubber starts tucked away')
      await page.locator('#timeline-toggle').click()
      assert.equal(await page.locator('#timeline-toggle').getAttribute('aria-expanded'), 'true')
      await page.locator('#replay-speed').selectOption('1')
      await page.locator('#replay-play').click()
      await page.clock.runFor(1500)
      assert.equal(await page.locator('#replay-event-title').textContent(), 'You', JSON.stringify(await page.evaluate(() => ({
        clock: document.querySelector('#replay-clock').textContent,
        state: document.querySelector('#replay-state').textContent,
        hidden: document.hidden,
        performanceNow: performance.now(),
      }))))
      await page.locator('#replay-play').click()
      const paused = await page.locator('#replay-position').inputValue()
      await page.clock.runFor(1500)
      assert.equal(await page.locator('#replay-position').inputValue(), paused)

      await seek(page, 8000)
      await page.locator('#replay-play').click()
      await page.clock.runFor(2200)
      await page.locator('#replay-play').click()
      assert.match(await page.locator('#replay-clock').textContent(), /^2:11\./, 'Playback skips the long idle gap')
      await seek(page, 8000)
      await page.locator('#replay-skip-idle').uncheck()
      await page.locator('#replay-play').click()
      await page.clock.runFor(2200)
      await page.locator('#replay-play').click()
      assert.match(await page.locator('#replay-clock').textContent(), /^0:10\./, 'Wall-time playback retains idle gaps')
      assert.equal(await page.locator('#replay-running').textContent(), 'Idle between prompts')

      await seek(page, 0)
      await page.locator('#replay-skip-idle').check()
      await page.locator('#replay-speed').selectOption('16')
      await page.locator('#chart').press('Space')
      await page.clock.runFor(2200)
      assert.equal(await page.locator('#replay-state').textContent(), 'End of session')
      assert.equal(await page.locator('#replay-play').textContent(), 'Play again')
      assert.equal(await page.locator('#replay-next').isDisabled(), true)
      await page.locator('#replay-play').click()
      await page.clock.runFor(64)
      assert.equal(await page.locator('#replay-play').textContent(), 'Pause')
      assert.notEqual(await page.locator('#replay-position').inputValue(), String(length))
      await seek(page, 4000)
      assert.equal(await page.locator('#replay-play').textContent(), 'Play', 'Scrubbing pauses playback')
      await page.locator('#replay-position').press('End')
      assert.equal(await page.locator('#replay-state').textContent(), 'End of session')
      await page.locator('#replay-position').press('Home')
      assert.equal(await page.locator('#replay-position').inputValue(), '0')

      await page.locator('#replay-play').click()
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true })
        document.dispatchEvent(new Event('visibilitychange'))
        delete document.hidden
      })
      assert.equal(await page.locator('#replay-play').textContent(), 'Play')
      await page.locator('#replay-play').click()
      await page.locator('#help-button').click()
      assert.equal(await page.locator('#help').evaluate(dialog => dialog.open), true)
      await page.locator('#sample-button').click()
      assert.equal(await page.locator('#help').evaluate(dialog => dialog.open), false, 'Loading closes the help dialog')
      assert.equal(await page.locator('#tab-flame').getAttribute('aria-selected'), 'true')
      assert.equal(await page.locator('#replay-play').textContent(), 'Play')
      assert.equal(await page.locator('#replay-position').inputValue(), '0')
      assert.match(await page.locator('#replay-count').textContent(), /^1 \/ 106/)
      await seek(page, 'end')
      await page.locator('#tab-flame').focus()
      await page.keyboard.press('ArrowRight')
      assert.equal(await page.locator('#tab-transcript').evaluate(tab => tab === document.activeElement && tab.getAttribute('aria-selected') === 'true'), true)
      assert.equal(await page.locator('#panel-flame').isHidden(), true)
      await page.keyboard.press('End')
      assert.equal(await page.locator('#tab-breakdown').getAttribute('aria-selected'), 'true')
      await page.keyboard.press('ArrowRight')
      assert.equal(await page.locator('#tab-flame').getAttribute('aria-selected'), 'true', 'Arrow keys wrap')
      await page.locator('#tab-transcript').click()
      assert.equal(await page.locator('#replay-events li').count(), 100, 'Long histories stay bounded')
      assert.equal(await page.locator('#replay-events .icon[aria-label]').count(), 100, 'Every transcript row names its kind of work')
      const observe = page.locator('#phase-filter button', { hasText: 'Observe' })
      const observed = page.locator('#replay-events .phase', { hasText: /^observe$/i })
      assert.ok(await observed.count() > 0)
      await observe.click()
      assert.equal(await observe.getAttribute('aria-pressed'), 'false')
      assert.equal(await observed.count(), 0, 'Hidden categories leave the transcript')
      assert.match(await page.locator('#replay-count').textContent(), / hidden/)
      await observe.click()
      assert.ok(await observed.count() > 0)
      await page.locator('#replay-events button').first().focus()
      await page.locator('#replay-events button').first().press('Enter')
      assert.equal(await page.locator('#replay-events button[aria-current]').evaluate(node => node === document.activeElement), true)
      assert.deepEqual(errors, [], engine.name())
    } finally {
      await browser.close()
    }
  }
})

test('model and context menus load recorded runs on one shared scale', { skip: !url }, async () => {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' })
      await page.goto(url, { waitUntil: 'networkidle' })
      const context = page.locator('#run-context')
      const status = (text) => page.waitForFunction(
        (expected) => document.querySelector('#status')?.textContent === expected, text, { timeout: 5000 })
      assert.equal(await context.isDisabled(), true)

      await page.locator('#run-model').selectOption('claude-sonnet-5.5')
      await status('Showing the recorded Claude Sonnet 5.5 run with the default context tier.')
      assert.equal(await context.isDisabled(), false)
      assert.deepEqual(await context.locator('option').allTextContents(), ['Default · 200k', 'Long · 872k'])
      assert.match(await page.locator('#coverage').textContent(), /Claude Sonnet 5\.5 · default context, 200k prompt limit/)
      await page.waitForFunction(() => /^Whole run on the shared .+ scale$/.test(document.querySelector('#view-range')?.textContent ?? ''))
      const sonnet = Number(await page.locator('#replay-position').getAttribute('max'))

      await context.selectOption('long_context')
      await status('Showing the recorded Claude Sonnet 5.5 run with the long context tier.')

      await page.locator('#run-model').selectOption('hydrafusion')
      await status('Showing the recorded HydraFusion run with the default context tier.')
      assert.deepEqual(await context.locator('option').allTextContents(), ['Default · 272k', 'Long · not offered'])
      assert.equal(await context.locator('option[value="long_context"]').evaluate((option) => option.disabled), true)
      assert.ok(Number(await page.locator('#replay-position').getAttribute('max')) > sonnet)

      await page.locator('#run-model').selectOption('sample')
      await status('Showing the illustrative sample.')
      assert.equal(await context.isDisabled(), true)
      await page.waitForFunction(() => document.querySelector('#view-range')?.textContent === 'Whole session')

      await loadFixture(page)
      assert.equal(await page.locator('#run-model').inputValue(), 'file')
    } finally {
      await browser.close()
    }
  }
})

test('clicking a bar expands it and the trail steps back out', { skip: !url }, async () => {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' })
      await page.goto(url, { waitUntil: 'networkidle' })
      await loadFixture(page)
      const chart = await page.locator('#chart').boundingBox()
      assert.ok(chart)
      const length = Number(await page.locator('#replay-position').getAttribute('max'))
      const rowY = (row) => 26 + 6 * 12 + row * 18 + 9
      const range = (pattern) => page.waitForFunction(
        (source) => new RegExp(source).test(document.querySelector('#view-range')?.textContent ?? ''), pattern.source, { timeout: 2000 })

      // Rows: session, prompt, model turn, then the two parallel tool calls.
      await page.locator('#chart').click({ position: { x: chart.width * 5000 / length, y: rowY(2) } })
      await range(/^Inside model turn · 0:02\.00 – 0:09\.00$/)
      assert.match(await page.locator('#span-title').textContent(), /Inspecting the files/)
      await page.locator('#chart').click({ position: { x: chart.width / 2, y: rowY(4) } })
      await range(/^Inside tool call · /)
      await page.locator('#chart').press('Escape')
      await range(/^Inside model turn · /)
      // The wheel zooms at the pointer; zooming out past the expanded bar steps back out.
      await page.mouse.move(chart.x + chart.width / 2, chart.y + rowY(2))
      await page.mouse.wheel(0, -300)
      await range(/^Inside model turn · 0:0[3-4]/)
      await page.mouse.wheel(0, 900)
      await range(/^0:00/)
      await page.locator('#chart').click({ position: { x: chart.width / 2, y: rowY(0) } })
      await range(/^Whole session$/)
      await page.locator('#chart').click({ position: { x: chart.width * 5000 / length, y: rowY(2) } })
      await page.locator('#zoom-fit').click()
      await range(/^Whole session$/)
    } finally {
      await browser.close()
    }
  }
})

test('a held click pauses live playback', { skip: !url }, async () => {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage()
      await page.goto(url, { waitUntil: 'networkidle' })
      await page.locator('#replay-play').click()
      await page.waitForTimeout(300)
      await page.locator('#replay-play').click({ delay: 150 })
      const paused = await page.locator('#replay-position').inputValue()
      await page.waitForTimeout(300)
      assert.equal(await page.locator('#replay-position').inputValue(), paused, engine.name())
      assert.equal(await page.locator('#replay-play').textContent(), 'Play', engine.name())
    } finally {
      await browser.close()
    }
  }
})

test('session replay fits desktop and touch layouts in both themes', { skip: !url }, async () => {
  const browser = await chromium.launch()
  try {
    if (screenshots) await mkdir(screenshots, { recursive: true })
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      for (const theme of ['dark', 'light']) {
        const page = await browser.newPage({
          viewport: { width, height }, hasTouch: width === 390, reducedMotion: 'reduce',
        })
        try {
          await page.addInitScript(value => localStorage.setItem('theme', value), theme)
          await page.goto(url, { waitUntil: 'networkidle' })
          await page.locator('#timeline-toggle').click()
          await seek(page, 39500)
          assert.equal(await page.evaluate(() => {
            const page = document.querySelector('.flame-page').getBoundingClientRect()
            return page.right <= innerWidth + 1 && page.bottom <= innerHeight + 1
          }), true, `The app fits the viewport, ${width}px ${theme}`)
          assert.ok(await page.locator('#chart-scroll').evaluate(node => node.clientHeight) >= 120, `Chart keeps room, ${width}px ${theme}`)
          for (const selector of ['.app-bar', '.transport', '#panel-flame', '.app-aside']) {
            assert.equal(await page.locator(selector).evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, `${selector}, ${width}px ${theme}`)
          }
          const chartHeight = () => page.locator('#chart-scroll').evaluate(node => node.clientHeight)
          const withBar = await chartHeight()
          await page.locator('#replay-toggle').click()
          assert.equal(await page.locator('#replay-toggle').getAttribute('aria-expanded'), 'false')
          assert.equal(await page.locator('#transport').isHidden(), true, `Replay bar hides, ${width}px ${theme}`)
          await page.waitForFunction(height => document.querySelector('#chart-scroll').clientHeight > height, withBar)
          if (screenshots && theme === 'dark') await page.screenshot({ path: join(screenshots, `replay-${width}-collapsed.png`) })
          await page.locator('#replay-toggle').click()
          assert.equal(await page.locator('#transport').isVisible(), true, `Replay bar returns, ${width}px ${theme}`)
          assert.equal(await chartHeight(), withBar)
          if (width === 390) {
            await page.locator('#replay-position').tap()
            assert.notEqual(await page.locator('#replay-position').inputValue(), '39500')
          }
          if (screenshots) {
            await page.screenshot({ path: join(screenshots, `replay-${width}-${theme}.png`) })
            if (theme === 'dark') {
              for (const tab of ['transcript', 'breakdown']) {
                await page.locator(`#tab-${tab}`).click()
                await page.screenshot({ path: join(screenshots, `replay-${width}-${tab}.png`) })
              }
            }
          }
          await page.locator('#help-button').click()
          assert.equal(await page.locator('#help').evaluate(node => node.open && node.scrollWidth <= node.clientWidth + 1
            && node.getBoundingClientRect().right <= innerWidth), true, `Help fits, ${width}px ${theme}`)
          if (screenshots && theme === 'dark') await page.screenshot({ path: join(screenshots, `replay-${width}-help.png`) })
          await page.keyboard.press('Escape')
          assert.equal(await page.locator('#help').evaluate(node => node.open), false, 'Escape closes help')
        } finally {
          await page.close()
        }
      }
    }
  } finally {
    await browser.close()
  }
})
