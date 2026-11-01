import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { chromium } from 'playwright'
import { createHash } from 'node:crypto'

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
    const slides = page.getByRole('link', { name: 'Download the 18-slide deck (PPTX)' })
    assert.equal(await slides.isVisible(), true)
    assert.equal(await slides.getAttribute('download'), '')
    const slidesResponse = await page.request.get(new URL(await slides.getAttribute('href'), base).href)
    assert.equal(slidesResponse.status(), 200)
    assert.equal(createHash('sha256').update(await slidesResponse.body()).digest('hex'), 'de012abe634ab7f21bdd18c3aef3c213cebebe818e7781ea66feffa948bddb32')
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
