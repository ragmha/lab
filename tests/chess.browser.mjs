import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { chromium } from 'playwright'

const url = process.env.CHESS_TEST_URL
const screenshots = process.env.CHESS_SCREENSHOTS
const square = (page, name) => page.locator(`#chess-board [data-square="${name}"]`)

async function play(page, from, to) {
  await square(page, from).click()
  await square(page, to).click()
}

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#chess-status').textContent === 'Your move.')
}

async function completed(page) {
  await page.waitForFunction(() => document.querySelector('[data-step="reply"] [data-state]').textContent === 'Played')
}

async function mockEngine(page, options = {}) {
  await page.addInitScript(({ replies = ['e7e5'], failFirst = false, delayed = false, silent = false }) => {
    let generation = 0
    let index = 0
    window.chessCommands = []
    window.Worker = class {
      constructor() { this.generation = ++generation }
      postMessage(command) {
        window.chessCommands.push(command)
        const emit = (data) => this.onmessage?.({ data })
        if (command === 'uci') {
          if (silent && this.generation === 1) return
          if (failFirst && this.generation === 1) {
            setTimeout(() => this.onerror?.(new Event('error')), 5)
            return
          }
          setTimeout(() => emit('uciok'), 5)
        }
        if (command === 'isready') setTimeout(() => emit('readyok'), 5)
        if (command.startsWith('go ')) {
          const move = replies[index++ % replies.length]
          setTimeout(() => {
            emit(`info depth 7 multipv 1 score cp 10 nodes 1234 time 25 pv ${move}`)
            emit(`bestmove ${move}`)
          }, delayed ? 500 : 25)
        }
      }
      // Deliberately deliver stale callbacks: the app must guard worker identity.
      terminate() {}
    }
  }, options)
}

test('real WASM engine updates the diagram, works offline, and fits the viewport in both layouts', { skip: !url }, async () => {
  const browser = await chromium.launch()
  try {
    for (const [width, height] of [[1366, 768], [360, 640]]) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
      const page = await context.newPage()
      const errors = []
      const engineRequests = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('request', (request) => {
        if (request.url().includes('stockfish-')) engineRequests.push(request.url())
      })
      await page.goto(url)
      await ready(page)
      assert.equal(engineRequests.length, 0, 'Engine download is lazy')
      assert.equal(await page.locator('#chess-turn').isDisabled(), true)
      assert.equal(await page.locator('#chess-details').isHidden(), true)
      assert.equal(await page.locator('#chess-history').isVisible(), true)
      await square(page, 'e2').focus()
      await page.keyboard.press('Enter')
      assert.equal(await square(page, 'e4').getAttribute('data-legal'), 'true')
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('Enter')
      await completed(page)
      assert.equal(await page.locator('#chess-timeline > li').count(), 2)
      assert.equal(await page.locator('#chess-timeline [data-move-title]').first().textContent(), '1. e4')
      assert.match(await page.locator('[data-step="player"] [data-copy]').textContent(), /e4.*e2 → e4/)
      assert.match(await page.locator('[data-step="validate"] [data-copy]').textContent(), /20 legal replies/)
      assert.ok(Number((await page.locator('#search-nodes').textContent()).replaceAll(',', '')) > 0)
      assert.ok(Number(await page.locator('#search-depth').textContent()) > 0)
      assert.match(await page.locator('#search-candidate').textContent(), /^Top search line:/)
      assert.match(await page.locator('#chess-commands').textContent(), /position startpos moves e2e4/)
      assert.match(await page.locator('#chess-commands').textContent(), /← bestmove/)
      assert.equal(await square(page, 'e4').getAttribute('data-color'), 'w')
      assert.equal(engineRequests.length, 2, 'Only worker and matching WASM are downloaded')
      await context.setOffline(true)
      await play(page, 'g1', 'f3')
      await completed(page)
      assert.equal(await page.locator('#chess-turn option').count(), 2)
      assert.equal(await page.locator('#chess-timeline > li').count(), 4)
      const scoreSheet = await page.locator('#chess-moves').textContent()
      await page.locator('[data-view="context"]').click()
      assert.match(await page.locator('#chess-context-blocks').textContent(), /analyze → depth \d+, best [a-h][1-8][a-h][1-8]/, 'The context shows real engine output')
      assert.match(await page.locator('#chess-context-blocks').textContent(), /2\. Nf3/)
      await page.locator('[data-view="details"]').click()
      assert.equal(await page.locator('[data-view="details"]').getAttribute('aria-pressed'), 'true')
      assert.equal(await page.locator('#chess-context').isHidden(), true)
      assert.equal(await page.locator('#chess-history').isHidden(), true)
      await page.locator('#chess-turn').selectOption('0')
      assert.match(await page.locator('[data-step="player"] [data-copy]').textContent(), /^e4/)
      assert.equal(await page.locator('#chess-moves').textContent(), scoreSheet)
      await page.locator('#chess-turn').selectOption('1')
      assert.match(await page.locator('[data-step="player"] [data-copy]').textContent(), /^Nf3/)
      await page.locator('[data-view="history"]').click()
      assert.equal(await page.locator('#chess-timeline > li').count(), 4, 'Switching views preserves the history')
      const boardBox = await page.locator('.board-frame').boundingBox()
      const traceBox = await page.locator('.trace').boundingBox()
      assert.ok(width === 1366 ? traceBox.x >= boardBox.x + boardBox.width : traceBox.y > boardBox.y + boardBox.height)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), false, 'The page fits the viewport')
      assert.ok(boardBox.y + boardBox.height <= height, 'The whole board is on screen')
      assert.ok(traceBox.y + traceBox.height <= height, 'The trace fits on screen')
      assert.equal(await page.locator('.trace').evaluate((node) => getComputedStyle(node).overflowY), 'auto')
      assert.equal(await page.locator('.trace').evaluate((node) => node.scrollWidth > node.clientWidth), false)
      const shades = () => page.evaluate(() => [
        getComputedStyle(document.querySelector('#trace-title')).color,
        getComputedStyle(document.querySelector('[data-square=a1]')).backgroundColor,
        getComputedStyle(document.querySelector('[data-square=h1]')).backgroundColor
      ])
      assert.deepEqual(await shades(), ['rgb(155, 188, 15)', 'rgb(30, 60, 30)', 'rgb(95, 143, 31)'], 'Night palette by default; dark squares stay darker')
      assert.deepEqual(errors, [])
      if (screenshots) {
        await mkdir(screenshots, { recursive: true })
        await page.screenshot({ path: join(screenshots, `chess-${width}.png`), fullPage: true })
      }
      await page.locator('#theme-toggle').click()
      assert.deepEqual(await shades(), ['rgb(15, 56, 15)', 'rgb(48, 98, 48)', 'rgb(155, 188, 15)'], 'Light mode uses the classic Game Boy palette')
      if (screenshots) await page.screenshot({ path: join(screenshots, `chess-${width}-light.png`), fullPage: true })
      await page.locator('#theme-toggle').click()
      await page.getByRole('button', { name: 'New game', exact: true }).click()
      assert.equal(await page.locator('#chess-moves').textContent(), 'No moves yet.')
      assert.equal(await page.locator('#search-nodes').textContent(), '—')
      assert.equal(await page.locator('#chess-timeline > li').count(), 0)
      assert.equal(await page.locator('#chess-history-empty').isVisible(), true)
      assert.equal(await square(page, 'e2').getAttribute('data-color'), 'w')
      await context.close()
    }
  } finally {
    await browser.close()
  }
})

test('move boxes accumulate, follow live replies, and preserve history while inspecting a turn', { skip: !url }, async () => {
  const browser = await chromium.launch()
  try {
    for (const [width, height] of [[1366, 768], [626, 754], [360, 640]]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
      await mockEngine(page, { replies: ['e7e5', 'b8c6', 'g8f6', 'f8c5'], delayed: true })
      await page.goto(url)
      await ready(page)
      const entries = page.locator('#chess-timeline > li')
      const titles = page.locator('#chess-timeline [data-move-title]')
      await square(page, 'e2').click()
      await square(page, 'e5').click()
      assert.equal(await entries.count(), 0, 'Selecting a piece or an illegal destination adds no move')
      await play(page, 'e2', 'e4')
      assert.equal(await entries.count(), 2)
      assert.equal(await entries.last().getAttribute('data-pending'), 'true')
      assert.equal(await titles.last().textContent(), 'Finding a reply…')
      await completed(page)
      assert.deepEqual(await titles.allTextContents(), ['1. e4', '1... e5'])
      assert.equal(await entries.last().getAttribute('data-pending'), 'false')
      assert.match(await entries.last().textContent(), /Depth 7 · 1,234 nodes · 25 ms/)
      await page.evaluate(() => { window.firstMoveNode = document.querySelector('#chess-timeline > li') })

      await play(page, 'g1', 'f3')
      await completed(page)
      await page.locator('[data-view="details"]').focus()
      await page.keyboard.press('Enter')
      assert.equal(await page.locator('#chess-details').isVisible(), true)
      await page.locator('#chess-turn').selectOption('0')
      const firstDetail = await page.locator('#chess-flow').textContent()
      // A reply must still update the history while the reader inspects an older turn.
      await play(page, 'f1', 'c4')
      await page.locator('#chess-turn').selectOption('0')
      await page.waitForFunction(() => document.querySelector('#chess-moves').textContent.endsWith('Nf6'))
      assert.equal(await page.locator('#chess-flow').textContent(), firstDetail)
      assert.deepEqual(await titles.allTextContents(), ['1. e4', '1... e5', '2. Nf3', '2... Nc6', '3. Bc4', '3... Nf6'])
      await page.locator('[data-view="history"]').click()
      const latest = await entries.last().boundingBox()
      const panel = await page.locator('.trace').boundingBox()
      const heading = await page.locator('.trace-heading').boundingBox()
      assert.ok(latest.y >= heading.y + heading.height, 'The sticky toolbar does not cover the latest move')
      assert.ok(latest.y + latest.height <= panel.y + panel.height, 'Returning to history reveals the latest reply')
      assert.equal(await page.locator('.trace').evaluate((node) => node.scrollHeight > node.clientHeight), true)

      await play(page, 'd2', 'd3')
      await page.locator('.trace').evaluate((node) => { node.scrollTop = 0 })
      await completed(page)
      assert.equal(await page.locator('.trace').evaluate((node) => node.scrollTop), 0, 'Engine updates do not pull the reader away from older moves')
      assert.equal(await entries.count(), 8)
      assert.equal(await page.evaluate(() => document.querySelector('#chess-timeline > li') === window.firstMoveNode), true, 'Earlier boxes are not rebuilt')
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth), false)
      assert.equal(await page.locator('.play').evaluate((node) => node.scrollHeight > node.clientHeight), false, 'The board stays fully visible as the history grows')
      if (screenshots) {
        await mkdir(screenshots, { recursive: true })
        await page.screenshot({ path: join(screenshots, `chess-history-${width}.png`) })
      }

      await page.locator('[data-view="context"]').click()
      const blocks = page.locator('#chess-context-blocks > li')
      assert.deepEqual(await blocks.evaluateAll((items) => items.map((item) => item.dataset.policy)),
        ['Pinned', 'Pinned', 'Replaced', 'Summary', 'Window', 'Tool result', 'Tool result'])
      assert.match(await blocks.nth(2).textContent(), /FEN r1bqkb1r\/pppp1ppp\/2n2n2\/4p3\/2B1P3\/3P1N2\/PPP2PPP\/RNBQK2R b KQkq - 0 4/)
      assert.match(await page.locator('#context-used').textContent(), /^≈ \d+ \/ 512 tokens$/)
      assert.match(await page.locator('#context-transcript').textContent(), /over budget/)
      assert.match(await page.locator('#context-dropped').textContent(), /3 earlier turns/)
      assert.equal(await page.locator('.trace').evaluate((node) => node.scrollWidth > node.clientWidth), false)
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth), false)
      if (screenshots) await page.screenshot({ path: join(screenshots, `chess-context-${width}.png`) })
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test('failures are visible, invalid replies do not move pieces, and retry recovers', { skip: !url }, async () => {
  const browser = await chromium.launch()
  try {
    for (const options of [{ replies: ['a1a8', 'e7e5'] }, { failFirst: true }, { silent: true }]) {
      const page = await browser.newPage()
      if (options.silent) await page.clock.install()
      await mockEngine(page, options)
      await page.goto(url)
      await ready(page)
      await play(page, 'e2', 'e4')
      if (options.silent) await page.clock.runFor(20_001)
      await page.locator('#chess-retry').waitFor({ state: 'visible' })
      assert.match(await page.locator('#chess-status').textContent(), /Retry engine/)
      assert.equal(await square(page, 'e7').getAttribute('data-color'), 'b')
      assert.equal(await page.locator('#chess-moves').textContent(), '1. e4')
      assert.equal(await page.locator('#chess-timeline > li').count(), 2)
      assert.equal(await page.locator('#chess-timeline > li').last().getAttribute('data-failed'), 'true')
      assert.equal(await page.locator('#chess-timeline [data-move-title]').last().textContent(), 'No reply played')
      await page.locator('#chess-retry').click()
      await completed(page)
      assert.equal(await page.locator('#chess-timeline > li').count(), 2, 'Retry updates the pending reply instead of duplicating it')
      assert.equal(await page.locator('#chess-timeline [data-move-title]').last().textContent(), '1... e5')
      assert.equal(await page.locator('#chess-timeline > li').last().getAttribute('data-failed'), 'false')
      assert.equal(await square(page, 'e5').getAttribute('data-color'), 'b')
      assert.equal(await page.locator('#search-nodes').textContent(), '1,234')
      assert.equal(await page.locator('#chess-retry').isHidden(), true)
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test('reset ignores stale workers and terminal player moves skip the engine', { skip: !url }, async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await mockEngine(page, { delayed: true })
    await page.goto(url)
    await ready(page)
    await play(page, 'e2', 'e4')
    await page.waitForFunction(() => window.chessCommands.some((command) => command.startsWith('go ')))
    await page.locator('#chess-reset').click()
    await page.waitForTimeout(650)
    assert.equal(await page.locator('#chess-moves').textContent(), 'No moves yet.')
    assert.equal(await page.locator('#chess-timeline > li').count(), 0)
    assert.equal(await square(page, 'e7').getAttribute('data-color'), 'b')
    await play(page, 'e2', 'e4')
    await completed(page)
    assert.equal(await page.locator('#search-nodes').textContent(), '1,234', 'Reset keeps trace references live')
    await page.close()

    const mate = await browser.newPage()
    await mockEngine(mate, { replies: ['e7e5', 'b8c6', 'g8f6'] })
    await mate.goto(url)
    await ready(mate)
    for (const [from, to] of [['e2', 'e4'], ['d1', 'h5'], ['f1', 'c4']]) {
      await play(mate, from, to)
      await completed(mate)
    }
    await play(mate, 'h5', 'f7')
    assert.equal(await mate.locator('#chess-status').textContent(), 'Checkmate. You won.')
    assert.equal(await mate.locator('[data-step="search"] [data-state]').textContent(), 'Skipped')
    assert.equal(await mate.evaluate(() => window.chessCommands.filter((command) => command.startsWith('go ')).length), 3)
    assert.equal(await mate.locator('#chess-board button:disabled').count(), 64)
    assert.equal(await mate.locator('#chess-timeline > li').count(), 7, 'A terminal player move adds no engine reply')
    assert.equal(await mate.locator('#chess-timeline [data-move-title]').last().textContent(), '4. Qxf7#')
    assert.match(await mate.locator('#chess-timeline > li').last().textContent(), /Checkmate. You won./)
    await mate.close()
  } finally {
    await browser.close()
  }
})
