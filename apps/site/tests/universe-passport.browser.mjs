import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { chromium } from 'playwright'
import { lessons, releases } from '../src/data/universe.mjs'
import { createStore } from '../../../.github/extensions/universe-passport/store.mjs'
import { startServer } from '../../../.github/extensions/universe-passport/server.mjs'

const shots = process.env.LAB_SCREENSHOT_DIR

test('Universe Passport canvas: stamps, status round, board, fallbacks and narrow panels', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'universe-passport-ui-'))
  const file = join(dir, 'progress.json')
  await writeFile(file, '{ unreadable')
  const serverErrors = []
  const store = createStore(file, lessons.length)
  const server = await startServer(store, (error) => serverErrors.push(error))
  const browser = await chromium.launch({ channel: process.env.LAB_BROWSER_CHANNEL })
  if (shots) await mkdir(shots, { recursive: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text())
    })
    const focusedId = () => page.evaluate(() => document.activeElement.id)
    const focusedText = () => page.evaluate(() => document.activeElement.textContent)
    const tally = () => page.locator('.tally').innerText()
    // DOM replaceChildren renders false or null arguments as text, so panels must hold elements only.
    const strayText = () => page.evaluate(() => [...document.querySelectorAll('main > section')]
      .flatMap((panel) => [...panel.childNodes]).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent))
    // Saves are async; the live announcement lands only after the view has re-rendered and moved focus.
    const announced = (message) => page.waitForFunction((text) => document.querySelector('#live').textContent === text, message, { timeout: 5000 })
    const shoot = async (name) => {
      if (!shots) return
      // Let the resized layout paint before capturing, or stale tiles can show.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await page.screenshot({ path: join(shots, `universe-passport-${name}.png`) })
    }
    await page.goto(server.url, { waitUntil: 'networkidle' })

    assert.ok((await page.locator('#storage').innerText()).includes(`moved to ${file.replace(homedir(), '~')}.unreadable-`))
    assert.deepEqual(await strayText(), [])
    assert.match(await page.locator('.scope').innerText(), /checked 1 Nov 2026/)
    assert.equal(await tally(), `0 of 8 stamped · next: step 0, ${lessons[0].short}`)
    const deck = page.getByRole('link', { name: 'Download the 18-slide deck (PPTX)' })
    assert.equal(await deck.getAttribute('download'), '')
    assert.equal((await page.request.get(new URL(await deck.getAttribute('href'), server.origin).href)).status(), 200)

    await page.getByRole('tab', { name: 'Passport' }).focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await focusedId(), 'tab-round')
    assert.equal(await page.locator('#panel-round').isVisible(), true)
    assert.equal(await page.locator('#panel-passport').isVisible(), false)
    await page.keyboard.press('End')
    assert.equal(await page.getByRole('tab', { name: 'Release board' }).getAttribute('aria-selected'), 'true')
    await page.keyboard.press('ArrowRight')
    assert.equal(await focusedId(), 'tab-passport')

    await page.getByRole('button', { name: 'Stamp step 0' }).click()
    await announced('Step 0 stamped.')
    assert.equal(await focusedText(), 'Next stop: step 1')
    assert.match(await page.locator('.slot-mark').first().textContent(), /^Done/)
    await page.keyboard.press('Enter')
    assert.equal(await focusedId(), 'lesson-title')
    assert.equal(await page.locator('#lesson-title').innerText(), lessons[1].title)

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.copied = text } } })
    })
    await page.getByRole('button', { name: 'Copy prompt' }).click()
    assert.equal(await page.evaluate(() => window.copied), lessons[1].prompt)
    assert.equal(await page.locator('.copy-status').innerText(), 'Copied.')
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Denied') } } })
      document.execCommand = () => false
    })
    await page.getByRole('button', { name: 'Copy prompt' }).click()
    assert.match(await page.locator('.copy-status').innerText(), /^Copy is blocked here\. The prompt is selected/)
    assert.equal(await page.evaluate(() => getSelection().toString()), lessons[1].prompt)

    await page.locator('summary', { hasText: 'No access? Practice route' }).click()
    await page.getByRole('button', { name: 'Stamp with practice route' }).click()
    await announced('Step 1 stamped.')
    assert.match(await page.locator('.slot').nth(1).locator('.slot-mark').textContent(), /^Practice/)
    assert.equal(await focusedText(), 'Next stop: step 2')
    await page.getByRole('button', { name: 'Remove stamp' }).click()
    await announced('Stamp removed from step 1.')
    assert.equal(await focusedText(), 'Stamp step 1')
    assert.match(await tally(), /^1 of 8 stamped/)

    await page.route('**/api/progress', (route) => route.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'disk', message: 'Disk full.' } }),
    }))
    await page.getByRole('button', { name: 'Stamp step 1' }).click()
    await page.locator('#notice').waitFor({ timeout: 5000 })
    assert.equal(await page.locator('#notice').innerText(), 'Not saved. Disk full.')
    assert.match(await tally(), /^1 of 8 stamped/)
    await page.unroute('**/api/progress')

    store.notice = null
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await page.locator('#storage').innerText(), `Progress is saved on this computer in ${file.replace(homedir(), '~')}.`)
    assert.equal(await tally(), `1 of 8 stamped · next: step 1, ${lessons[1].short}`)
    assert.equal(await page.locator('#notice').isHidden(), true)
    for (const [width, scheme] of [[1100, 'light'], [1100, 'dark'], [420, 'light'], [420, 'dark']]) {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme: scheme })
      await shoot(`${width}-${scheme}`)
    }
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const dark = await background()
    await page.evaluate(() => { document.documentElement.dataset.colorMode = 'light' })
    assert.notEqual(await background(), dark, 'The host light theme overrides a dark OS preference')
    await page.evaluate(() => { delete document.documentElement.dataset.colorMode })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize({ width: 1100, height: 900 })

    await page.getByRole('tab', { name: 'Status round' }).click()
    await page.getByRole('button', { name: 'Start a round' }).click()
    const official = {}
    for (let card = 1; card <= 8; card += 1) {
      assert.match(await page.locator('.round-progress').innerText(), new RegExp(`^Card ${card} of 8`))
      assert.equal(await focusedId(), 'card-title')
      assert.equal(await page.locator('.reveal').count(), 0, 'The status stays hidden until the reader answers')
      await page.locator('.choice').first().click()
      assert.equal(await focusedId(), 'verdict')
      const label = await page.locator('.choice.is-official').evaluate((node) => node.firstChild.textContent)
      official[label] = (official[label] ?? 0) + 1
      if (card === 1) await shoot('round-1100')
      await page.getByRole('button', { name: card === 8 ? 'See results' : 'Next card' }).click()
    }
    await announced('Round saved: 2 of 8.')
    assert.deepEqual(official, { GA: 2, Preview: 2, 'Available, check access': 2, 'Not confirmed shipped': 2 })
    assert.equal(await focusedId(), 'results-title')
    assert.equal(await page.locator('#results-title').innerText(), 'You read 2 of 8 statuses correctly')
    assert.equal(await page.locator('.round .muted').innerText(), 'Best round: 2 of 8.')
    assert.equal(await page.locator('.misses li').count(), 6)
    const practise = page.locator('.misses .link-button').first()
    const step = Number((await practise.innerText()).match(/\d+$/)[0])
    await practise.click()
    assert.equal(await page.getByRole('tab', { name: 'Passport' }).getAttribute('aria-selected'), 'true')
    assert.equal(await focusedId(), 'lesson-title')
    assert.equal(await page.locator('#lesson-title').innerText(), lessons[step].title)

    await page.getByRole('tab', { name: 'Release board' }).click()
    assert.equal(await page.locator('.count').innerText(), `Showing ${releases.length} of ${releases.length} announcements`)
    await page.locator('#release-search').focus()
    await page.keyboard.type('moderate')
    assert.equal(await focusedId(), 'release-search', 'Typing keeps focus in the search box')
    assert.equal(await page.locator('.release h3').allInnerTexts().then((names) => names.join()), 'Moderate role for GitHub Issues')
    assert.equal(await page.locator('.release .status').innerText(), 'Not yet available')
    await page.locator('#release-status').selectOption('GA')
    assert.equal(await page.locator('.release').count(), 0)
    await page.getByRole('button', { name: 'Clear filters' }).click()
    assert.equal(await page.locator('.release').count(), releases.length)
    assert.equal(await focusedId(), 'release-search')
    await page.locator('#release-search').fill('GitHub Agentic Workflows')
    await page.locator('.release').filter({ has: page.getByRole('heading', { name: 'GitHub Agentic Workflows', exact: true }) })
      .getByRole('button', { name: 'Field lab: Automations, Actions & agent identity', exact: true }).click()
    assert.equal(await page.getByRole('tab', { name: 'Field labs' }).getAttribute('aria-selected'), 'true')
    assert.equal(await page.locator('#lab-automation').getAttribute('open'), '')
    assert.match(await page.locator('#lab-automation').innerText(), /Markdown-to-Actions-YAML/)
    await page.locator('#lab-automation details summary').click()
    assert.match(await page.locator('#lab-automation details').innerText(), /separate controls/)
    await shoot('labs-1100')
    for (const width of [700, 420, 320]) {
      await page.setViewportSize({ width, height: 900 })
      for (const tab of ['Passport', 'Status round', 'Field labs', 'Release board']) {
        await page.getByRole('tab', { name: tab }).click()
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
        assert.ok(scrollWidth <= width, `${tab} overflows to ${scrollWidth}px at ${width}px`)
      }
    }
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 420, height: 900 })
    await page.getByRole('tab', { name: 'Field labs' }).click()
    await shoot('labs-420-dark')
    await page.getByRole('tab', { name: 'Release board' }).click()
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await shoot('board-420-dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize({ width: 1100, height: 900 })

    await page.getByRole('tab', { name: 'Passport' }).click()
    for (let next = 1; next < 7; next += 1) {
      await page.locator('.slot').nth(next).click()
      await page.getByRole('button', { name: `Stamp step ${next}` }).click()
      await announced(`Step ${next} stamped.`)
    }
    await page.locator('.slot').nth(7).click()
    await page.locator('summary', { hasText: 'No access? Practice route' }).click()
    await page.getByRole('button', { name: 'Stamp with practice route' }).click()
    await announced('Step 7 stamped.')
    assert.equal(await focusedId(), 'complete-title')
    assert.match(await page.locator('.complete').innerText(), /All 8 steps stamped, 1 by practice route\. Best status round: 2 of 8\./)
    assert.deepEqual(await strayText(), [])
    await page.evaluate(() => scrollTo(0, 0))
    await shoot('complete-1100')
    await page.close()

    const denied = await browser.newPage({ viewport: { width: 420, height: 900 } })
    await denied.goto(`${server.origin}/?token=wrong`, { waitUntil: 'networkidle' })
    assert.equal(await denied.getByRole('button', { name: 'Try again', includeHidden: true }).count(), 4)
    assert.match(await denied.locator('#panel-passport').innerText(), /^Your passport did not load\./)
    await denied.close()
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
  assert.deepEqual(serverErrors, [])
})
