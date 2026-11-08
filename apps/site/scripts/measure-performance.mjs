import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import inventory from '../src/data/content-links.json' with { type: 'json' }

const base = process.env.LAB_TEST_URL ?? 'https://lab.raghib.io'
const browser = await chromium.launch()
const pages = []
try {
  for (const path of ['/', ...inventory.labs.map(({ slug }) => `/${slug}/`)]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' })
    try {
      const page = await context.newPage()
      const client = await context.newCDPSession(page)
      await client.send('Network.enable')
      await client.send('Network.emulateNetworkConditions', {
        offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 93_750,
      })
      await client.send('Emulation.setCPUThrottlingRate', { rate: 4 })
      await page.addInitScript(() => {
        window.labMetrics = { lcp: null, cls: 0 }
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.labMetrics.lcp = entry.startTime
        }).observe({ type: 'largest-contentful-paint', buffered: true })
        let sessionStart = 0
        let previous = -Infinity
        let sessionValue = 0
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.hadRecentInput) continue
            if (entry.startTime - previous < 1000 && entry.startTime - sessionStart < 5000) sessionValue += entry.value
            else { sessionStart = entry.startTime; sessionValue = entry.value }
            previous = entry.startTime
            window.labMetrics.cls = Math.max(window.labMetrics.cls, sessionValue)
          }
        }).observe({ type: 'layout-shift', buffered: true })
      })
      const response = await page.goto(new URL(path, base).href, { waitUntil: 'networkidle', timeout: 90_000 })
      if (!response?.ok()) throw new Error(`${path} returned HTTP ${response?.status()}`)
      await page.waitForTimeout(3000)
      pages.push(await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0]
        return {
          url: location.href,
          ttfbMs: navigation.responseStart - navigation.requestStart,
          loadMs: navigation.loadEventEnd,
          lcpMs: window.labMetrics.lcp,
          cls: window.labMetrics.cls,
          observedTransferBytes: navigation.transferSize + performance.getEntriesByType('resource')
            .reduce((sum, resource) => sum + resource.transferSize, 0),
        }
      }))
    } finally {
      await context.close()
    }
  }
  assert.equal(pages.length, inventory.labs.length + 1)
  for (const page of pages) {
    for (const metric of ['ttfbMs', 'loadMs', 'cls', 'observedTransferBytes']) {
      assert.ok(Number.isFinite(page[metric]) && page[metric] >= 0, `${page.url}: invalid ${metric}`)
    }
    assert.ok(page.lcpMs === null || (Number.isFinite(page.lcpMs) && page.lcpMs >= 0), `${page.url}: invalid LCP`)
  }
  const report = new URL('../../../.checks/performance.json', import.meta.url)
  await mkdir(new URL('.', report), { recursive: true })
  await writeFile(report, JSON.stringify({
    measuredAt: new Date().toISOString(), base,
    conditions: 'One cold Chromium visit per page; 390x844, default motion, 4x CPU slowdown, 150ms latency, 1.6Mbps download; observed through 3s after network idle.',
    limitations: 'Synthetic snapshot, not real-user percentiles or a score. Cross-origin resources without Timing-Allow-Origin report zero transfer bytes; offscreen and interactive work is not measured.',
    pages,
  }, null, 2))
  console.log(`Measured ${pages.length} pages; report: .checks/performance.json`)
} finally {
  await browser.close()
}
