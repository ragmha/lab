import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { chromium, webkit } from 'playwright'
import { createHash } from 'node:crypto'
import { createStore } from '../../../.github/extensions/universe-passport/store.mjs'
import { startServer } from '../../../.github/extensions/universe-passport/server.mjs'
import { exportProgress } from '../src/data/universe-progress.mjs'

const base = process.env.LAB_TEST_URL
const key = 'universe-2026-progress-v1'

test('Universe guide: ordered practice, inventory, persistence, fallbacks and responsive reading', { skip: !base, timeout: 90_000 }, async () => {
  const browser = await chromium.launch({ channel: process.env.LAB_BROWSER_CHANNEL })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(new URL('/universe/', base).href, { waitUntil: 'networkidle' })
    assert.equal((await page.locator('.edition p').nth(1).innerText()).replace(/\s+/g, ' '),
      'Overview + official recap + 31 launch-day changelog posts. Not every conference session.')
    assert.equal(await page.locator('.lesson:visible').count(), 1)
    assert.equal(await page.locator('#lesson-0').isVisible(), true)
    assert.equal(await page.locator('.lesson-nav a').count(), 8)
    assert.equal(await page.locator('.field-lab').count(), 4)
    const slides = page.getByRole('link', { name: 'Download the 18-slide deck (PPTX)' })
    assert.equal(await slides.isVisible(), true)
    assert.equal(await slides.getAttribute('download'), '')
    const slidesResponse = await page.request.get(new URL(await slides.getAttribute('href'), base).href)
    assert.equal(slidesResponse.status(), 200)
    assert.equal(createHash('sha256').update(await slidesResponse.body()).digest('hex'), 'd6b028ad04f0c9e9d20c0f223bbe2be48bcc623ee3840b61a47caf7d34924fa8')
    const inventoryCount = await page.locator('.release').count()
    assert.ok(inventoryCount >= 50, 'All independently named launch-day additions should be discoverable')
    assert.equal(await page.locator('.release h3').evaluateAll((nodes) => new Set(nodes.map((node) => node.textContent)).size), inventoryCount)
    for (const title of ['Copilot Memory', 'Copilot Dreaming', 'GitHub Agentic Workflows', 'Microsoft Copilot SDK transition', 'Moderate role for GitHub Issues']) {
      assert.equal(await page.getByRole('heading', { name: title, exact: true }).count(), 1)
    }
    const moderate = page.locator('.release').filter({ has: page.getByRole('heading', { name: 'Moderate role for GitHub Issues', exact: true }) })
    assert.equal(await moderate.getAttribute('data-status'), 'Not yet available')
    assert.match(await moderate.innerText(), /despite the GA headline/)
    assert.equal(await page.locator('.release').filter({ hasText: 'Copilot automations & shared workflows' }).getAttribute('data-status'), 'Restricted access')
    assert.match(await page.locator('.release').filter({ hasText: 'Copilot automations & shared workflows' }).innerText(), /Source ambiguity/)
    for (const url of await page.locator('main a[href^="https:"]').evaluateAll((links) => links.map((link) => link.href))) {
      assert.ok(['github.com', 'docs.github.com', 'github.blog'].includes(new URL(url).hostname))
    }
    for (const href of await page.locator('a[href^="#"]').evaluateAll((links) => links.map((link) => link.getAttribute('href')))) {
      assert.equal(await page.locator(href).count(), 1, `Anchor ${href} has a target`)
    }
    await page.locator('[data-complete="0"]').check()
    assert.equal(await page.locator('#progress-label').innerText(), '1 of 8 lessons complete')
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await page.locator('[data-complete="0"]').isChecked(), true)
    assert.equal(await page.locator('.nav-done:visible').count(), 1)
    await page.locator('.lesson-nav [data-lesson-link="1"]').focus()
    await page.keyboard.press('Enter')
    await page.waitForURL('**/#lesson-1')
    assert.equal(await page.locator('#lesson-1').isVisible(), true)
    assert.equal(await page.locator('.lesson-nav [aria-current="step"]').getAttribute('data-lesson-link'), '1')
    assert.equal(await page.locator('#lesson-content').evaluate((node) => node === document.activeElement), true)
    await page.locator('#lesson-1 details').first().locator('summary').click()
    assert.equal(await page.locator('#lesson-1 details').first().getAttribute('open'), '')
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.copiedPrompt = text } } })
    })

    await page.locator('[data-copy="1"]').click()
    assert.equal(await page.evaluate(() => window.copiedPrompt), 'Explain this repository and suggest one small improvement. Do not change files.')
    assert.match(await page.locator('#copy-status').innerText(), /Prompt copied/)
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Denied') } } })
    })
    await page.locator('[data-copy="1"]').click()
    assert.match(await page.locator('#copy-status').innerText(), /copy it manually/)
    assert.equal(await page.evaluate(() => window.getSelection().toString()), await page.locator('#prompt-1').innerText())
    await page.locator('#release-search').fill('unstructured-secret')
    assert.equal(await page.locator('.release:visible').count(), 1)
    await page.locator('#release-group').selectOption('Platform')
    assert.equal(await page.locator('.release:visible').count(), 0)
    assert.equal(await page.locator('#empty-results').isVisible(), true)
    await page.locator('#clear-filters').click()
    assert.equal(await page.locator('.release:visible').count(), inventoryCount)
    await page.locator('#release-group').selectOption('Security')
    await page.locator('#release-status').selectOption('Public preview')
    assert.ok(await page.locator('.release:visible').count() >= 5)
    assert.ok(await page.locator('.release:visible').evaluateAll((nodes) => nodes.every((node) => node.dataset.group === 'Security' && node.dataset.status === 'Public preview')))
    await page.locator('#clear-filters').click()
    await page.goto(new URL('/universe/#lesson-7', base).href, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('#lesson-7').isVisible(), true)
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.locator('#reset-progress').click()
    assert.equal(await page.locator('#guide-progress').getAttribute('value'), '1')
    page.once('dialog', (dialog) => dialog.accept())
    await page.locator('#reset-progress').click()
    assert.equal(await page.locator('#guide-progress').getAttribute('value'), '0')
    assert.equal(await page.locator('#reset-progress').isDisabled(), true)
    if (process.env.LAB_SCREENSHOT_DIR) await mkdir(process.env.LAB_SCREENSHOT_DIR, { recursive: true })
    for (const width of [1440, 900, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(new URL('/universe/', base).href, { waitUntil: 'networkidle' })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No page overflow at ${width}px`)
      assert.ok(await page.locator('.lesson-nav a').evaluateAll((links) => links.every((link) => link.getBoundingClientRect().height >= 44)))
      await page.locator('.lesson-nav [data-lesson-link="1"]').click()
      assert.equal(await page.locator('#lesson-1').isVisible(), true)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      if (process.env.LAB_SCREENSHOT_DIR && [1440, 390].includes(width)) {
        await page.goto(new URL('/universe/', base).href, { waitUntil: 'networkidle' })
        await page.screenshot({ path: join(process.env.LAB_SCREENSHOT_DIR, `universe-${width}.png`), fullPage: false })
        await page.goto(new URL('/universe/#lesson-1', base).href, { waitUntil: 'networkidle' })
        await page.screenshot({ path: join(process.env.LAB_SCREENSHOT_DIR, `universe-lesson-${width}.png`), fullPage: false })
      }
    }
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto(new URL('/universe/', base).href, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.close()
    for (const failure of ['get', 'set', 'corrupt']) {
      const context = await browser.newContext()
      await context.addInitScript(({ failure, key }) => {
        if (failure === 'corrupt') localStorage.setItem(key, '{invalid json')
        else Object.defineProperty(Storage.prototype, `${failure}Item`, { value: () => { throw new Error('Storage denied') } })
      }, { failure, key })
      const fallback = await context.newPage()
      await fallback.goto(new URL('/universe/', base).href, { waitUntil: 'networkidle' })
      assert.match(await fallback.locator('#storage-status').innerText(), /this tab only/)
      await fallback.locator('[data-complete="0"]').check()
      assert.equal(await fallback.locator('#progress-label').innerText(), '1 of 8 lessons complete')
      await context.close()
    }
    const plain = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 900 } })
    await plain.goto(new URL('/universe/', base).href, { waitUntil: 'networkidle' })
    assert.equal(await plain.locator('.lesson:visible').count(), 8)
    assert.equal(await plain.locator('.release:visible').count(), inventoryCount)
    assert.equal(await plain.locator('#release-search').isDisabled(), true)
    assert.equal(await plain.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await plain.close()
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
})

test('public Passport: mobile reading, device persistence, guide sharing, and canvas transfer', { skip: !base, timeout: 90_000 }, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'universe-transfer-'))
      const store = createStore(join(dir, 'progress.json'), 8)
      const serverErrors = []
      const canvas = await startServer(store, (error) => serverErrors.push(error))
      const browser = await chromium.launch({ channel: process.env.LAB_BROWSER_CHANNEL })
      const url = new URL('/universe/passport/', base).href
      try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
        const errors = []
        const apiCalls = []
        page.on('pageerror', (error) => errors.push(error.message))
        page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url()) })
        await page.goto(url, { waitUntil: 'networkidle' })
        await page.locator('.tally').waitFor()
        await page.getByRole('button', { name: 'Stamp step 0', exact: true }).click()
        await page.waitForFunction(() => document.querySelector('.tally').textContent.startsWith('1 of 8'))
        await page.reload({ waitUntil: 'networkidle' })
        assert.match(await page.locator('.tally').innerText(), /^1 of 8/)
        await page.getByRole('link', { name: 'Read the full field guide' }).click()
        await page.waitForFunction(() => document.querySelector('[data-complete="0"]')?.disabled === false)
        assert.equal(await page.locator('[data-complete="0"]').isChecked(), true)
        await page.locator('.lesson-nav [data-lesson-link="1"]').click()
        await page.locator('[data-complete="1"]').check()
        await page.getByRole('link', { name: 'Open the interactive Passport' }).click()
        assert.match(await page.locator('.tally').innerText(), /^2 of 8/)
        await page.getByRole('tab', { name: 'Status round' }).click()
        await page.getByRole('button', { name: 'Start a round' }).click()
        for (let card = 0; card < 8; card++) {
          await page.locator('.choice').first().click()
          await page.getByRole('button', { name: card === 7 ? 'See results' : 'Next card', exact: true }).click()
        }
        await page.waitForFunction(() => document.querySelector('#results-title')?.textContent.includes('2 of 8'))
        await page.locator('.transfer summary').click()
        const downloaded = page.waitForEvent('download')
        await page.getByRole('button', { name: 'Export progress', exact: true }).click()
        const download = await downloaded
        const text = await readFile(await download.path(), 'utf8')
        const saved = JSON.parse(text).progress
        assert.equal(saved.stamps[0].route, 'exercise')
        assert.equal(saved.stamps[1].route, 'recorded')
        assert.equal(saved.bestRound.score, 2)
        assert.deepEqual(apiCalls, [], 'the published Passport needs no server API')

        await store.update({ type: 'stamp', lesson: 0, route: 'practice' })
        const existing = (await store.read()).stamps[0]
        const panel = await browser.newPage()
        await panel.goto(canvas.url, { waitUntil: 'networkidle' })
        await panel.locator('.transfer summary').click()
        await panel.locator('#import-progress').setInputFiles({ name: 'progress.json', mimeType: 'application/json', buffer: Buffer.from(text) })
        await panel.waitForFunction(() => document.querySelector('#transfer-status').textContent.startsWith('Progress imported'))
        assert.deepEqual((await store.read()).stamps[0], existing, 'destination evidence is not overwritten')
        assert.equal((await store.read()).stamps[1].route, 'recorded')
        await panel.getByRole('tab', { name: 'Passport', exact: true }).click()
        await panel.locator('.slot').nth(2).click()
        await panel.getByRole('button', { name: 'Stamp step 2', exact: true }).click()
        await panel.waitForFunction(() => document.querySelector('.tally').textContent.startsWith('3 of 8'))

        const secondDevice = await browser.newContext({ viewport: { width: 390, height: 844 } })
        const phone = await secondDevice.newPage()
        await phone.goto(url, { waitUntil: 'networkidle' })
        await phone.locator('.transfer summary').click()
        await phone.locator('#import-progress').setInputFiles({ name: 'progress.json', mimeType: 'application/json', buffer: Buffer.from(exportProgress(await store.read())) })
        await phone.waitForFunction(() => document.querySelector('#transfer-status').textContent.startsWith('Progress imported'))
        await phone.reload({ waitUntil: 'networkidle' })
        assert.match(await phone.locator('.tally').innerText(), /^3 of 8/)
        await phone.locator('.transfer summary').click()
        await phone.locator('#import-progress').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"wrong":true}') })
        await phone.waitForFunction(() => document.querySelector('#transfer-status').textContent.startsWith('Import failed'))
        assert.match(await phone.locator('.tally').innerText(), /^3 of 8/)
        for (const width of [320, 390, 768, 1280]) {
          await phone.setViewportSize({ width, height: 900 })
          for (const name of ['Passport', 'Field labs', 'Status round', 'Release board']) {
            await phone.getByRole('tab', { name, exact: true }).click()
            if (name === 'Field labs') await phone.locator('#lab-security').evaluate((node) => { node.open = true })
            assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} fits ${width}px`)
          }
        }
        if (process.env.LAB_SCREENSHOT_DIR) {
          await mkdir(process.env.LAB_SCREENSHOT_DIR, { recursive: true })
          for (const width of [390, 1280]) {
            await phone.setViewportSize({ width, height: 900 })
            await phone.getByRole('tab', { name: 'Passport', exact: true }).click()
            await phone.evaluate(() => scrollTo(0, 0))
            await phone.screenshot({ path: join(process.env.LAB_SCREENSHOT_DIR, `universe-public-${width}.png`) })
          }
        }
        await secondDevice.close()
        await panel.close()
        assert.deepEqual(errors, [])
        for (const failure of ['get', 'set', 'corrupt']) {
          const context = await browser.newContext()
          await context.addInitScript(({ failure, key }) => {
            if (failure === 'corrupt') localStorage.setItem(key, '{corrupt')
            else Object.defineProperty(Storage.prototype, `${failure}Item`, { value: () => { throw new Error('Storage denied') } })
          }, { failure, key })
          const fallback = await context.newPage()
          await fallback.goto(url, { waitUntil: 'networkidle' })
          assert.match(await fallback.locator('#storage').innerText(), /this tab only/)
          await fallback.getByRole('button', { name: 'Stamp step 0', exact: true }).click()
          await fallback.waitForFunction(() => document.querySelector('.tally').textContent.startsWith('1 of 8'))
          await context.close()
        }
      } finally {
        await browser.close()
        await canvas.close()
        await rm(dir, { recursive: true, force: true })
      }
      assert.deepEqual(serverErrors, [])
    })

    test('public Passport works on mobile WebKit', { skip: !base, timeout: 45_000 }, async () => {
      const browser = await webkit.launch()
      try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
        await page.goto(new URL('/universe/passport/', base).href, { waitUntil: 'networkidle' })
        await page.getByRole('button', { name: 'Stamp step 0', exact: true }).click()
        await page.waitForFunction(() => document.querySelector('.tally').textContent.startsWith('1 of 8'))
        await page.reload({ waitUntil: 'networkidle' })
        assert.match(await page.locator('.tally').innerText(), /^1 of 8/)
        await page.getByRole('tab', { name: 'Field labs', exact: true }).click()
        await page.locator('#lab-automation > summary').click()
        assert.match(await page.locator('#lab-automation').innerText(), /Markdown-to-Actions-YAML/)
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      } finally { await browser.close() }
    })
