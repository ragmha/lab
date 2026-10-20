import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { correlation, cost, instructions, kinds, median, medianRun, reveal, total } from '../src/lib/token-diet'
import type { Run, Tokens } from '../src/lib/token-diet'
import { assertCompleteRuns } from '../scripts/token-diet/validate-runs'

const raw = readFileSync(new URL('../src/data/token-diet.json', import.meta.url), 'utf8')
const data = JSON.parse(raw) as { principles: string[]; rates: Tokens; runs: Run[] }
const roundTwoRaw = readFileSync(new URL('../src/data/token-diet-2.json', import.meta.url), 'utf8')
const roundTwo = JSON.parse(roundTwoRaw) as { rates: Tokens; runs: Run[] }
const tokens = (cacheRead: number, cacheWrite: number, fresh: number, output: number): Tokens =>
  ({ cacheRead, cacheWrite, fresh, output })

describe('token diet run completeness', () => {
  const runsFor = (variants: string, count = 5) =>
    [...variants].flatMap((variant) => Array.from({ length: count }, () => ({ variant })))

  test('accepts complete original and optimizer setup groups', () => {
    assert.doesNotThrow(() => assertCompleteRuns(runsFor('abcde'), false))
    assert.doesNotThrow(() => assertCompleteRuns(runsFor('abcdef'), false))
    assert.doesNotThrow(() => assertCompleteRuns(runsFor('abcdef'), true))
  })

  test('canonical round one requires the optimizer group', () => {
    assert.throws(() => assertCompleteRuns(runsFor('abcde'), true), /setup f, found 0/)
  })

  test('rejects 25 runs without a baseline or with unequal sample sizes', () => {
    assert.throws(() => assertCompleteRuns(runsFor('bcdef'), false), /setup a, found 0/)
    const uneven = [...runsFor('abcde', 4), ...runsFor('f')]
    assert.equal(uneven.length, 25)
    assert.throws(() => assertCompleteRuns(uneven, false), /setup a, found 4/)
  })

  test('rejects partial optimizer groups and unexpected setups', () => {
    assert.throws(() => assertCompleteRuns([...runsFor('abcde'), ...runsFor('f', 4)], false), /setup f, found 4/)
    assert.throws(() => assertCompleteRuns(runsFor('abcdeg'), false), /unexpected setups/)
  })
})

describe('token diet math', () => {
  test('median handles odd, even and empty lists', () => {
    assert.equal(median([5, 1, 3]), 3)
    assert.equal(median([4, 1, 3, 2]), 2.5)
    assert.ok(Number.isNaN(median([])))
  })

  test('medianRun picks a real run, the lower middle for even counts', () => {
    const run = (id: string, cacheRead: number) => ({ id, totals: tokens(cacheRead, 0, 0, 0) })
    assert.equal(medianRun([run('a', 30), run('b', 10), run('c', 20)]).id, 'c')
    assert.equal(medianRun([run('a', 40), run('b', 10), run('c', 30), run('d', 20)]).id, 'd')
  })

  test('reveal walks calls in order and segments in kind order', () => {
    const calls = [tokens(100, 20, 5, 10), tokens(200, 0, 3, 7)]
    assert.deepEqual(reveal(calls, 0), { tokens: tokens(0, 0, 0, 0), calls: 0 })
    assert.deepEqual(reveal(calls, 110), { tokens: tokens(100, 10, 0, 0), calls: 1 })
    assert.deepEqual(reveal(calls, 135), { tokens: tokens(100, 20, 5, 10), calls: 1 })
    assert.deepEqual(reveal(calls, 136), { tokens: tokens(101, 20, 5, 10), calls: 2 })
    assert.deepEqual(reveal(calls, 1e9), { tokens: tokens(300, 20, 8, 17), calls: 2 })
  })

  test('correlation is 1 for a rising line and -1 for a falling one', () => {
    assert.equal(correlation([1, 2, 3], [10, 20, 30]), 1)
    assert.equal(correlation([1, 2, 3], [30, 20, 10]), -1)
  })
})

describe('token diet data', () => {
  test('canonical round one contains five runs of all six setups', () => {
    assert.equal(data.runs.length, 30)
    for (const variant of 'abcdef') {
      assert.equal(data.runs.filter((run) => run.variant === variant).length, 5)
    }
  })

  test('round two has five runs per recorded setup with reconciled usage', () => {
    const variants = new Set(roundTwo.runs.map((run) => run.variant))
    assert.ok(['a', 'b', 'c', 'd', 'e'].every((variant) => variants.has(variant)))
    assert.ok([...variants].every((variant) => 'abcdef'.includes(variant)))
    assert.ok(variants.size === 5 || variants.size === 6)
    assert.equal(roundTwo.runs.length, variants.size * 5)
    for (const variant of variants) {
      assert.equal(roundTwo.runs.filter((run) => run.variant === variant).length, 5)
    }
    for (const run of roundTwo.runs) {
      for (const kind of kinds) {
        assert.equal(run.calls.reduce((sum, call) => sum + call[kind], 0), run.totals[kind], `${run.id} ${kind}`)
      }
      assert.equal(cost(run.totals, roundTwo.rates), run.nanoAiu, `${run.id} charge`)
    }
  })

  test('calls add up to the session totals and the recorded charge', () => {
    for (const run of data.runs) {
      for (const kind of kinds) {
        assert.equal(run.calls.reduce((sum, call) => sum + call[kind], 0), run.totals[kind], `${run.id} ${kind}`)
      }
      assert.equal(cost(run.totals, data.rates), run.nanoAiu, `${run.id} charge`)
    }
  })

  test('publishes no local paths or credentials', () => {
    for (const leak of ['/Users/', '/tmp/ws', '/private/', 'token-diet', 'gho_', 'ghp_', 'github_pat_']) {
      assert.ok(!raw.includes(leak), leak)
    }
  })

  test('still supports what the page says about it', () => {
    const setups = [...new Set(data.runs.map((run) => run.variant))].map((variant) => {
      const set = data.runs.filter((run) => run.variant === variant)
      const sizes = set.map((run) => total(run.totals))
      return {
        variant,
        median: median(sizes),
        spread: Math.max(...sizes) - Math.min(...sizes),
        aiu: median(set.map((run) => run.nanoAiu)),
        calls: median(set.map((run) => run.calls.length)),
        biggest: Math.max(...set.flatMap((run) => run.calls.flatMap((call) => call.tools.map((tool) => tool.outTokens)))),
        saved: median(set.map((run) => run.rtk?.saved ?? 0)),
      }
    })
    const setup = (variant: string) => setups.find((item) => item.variant === variant)!
    const baseline = setup('a')
    const principles = setup('b')
    const rtk = setup('d')
    const optimizer = setups.find((item) => item.variant === 'f')
    const runs = data.runs
    assert.ok(setups.every((setup) => Number.isFinite(setup.median)))
    assert.ok(correlation(runs.map((run) => run.calls.length), runs.map((run) => total(run.totals))) > 0.9, 'calls drive tokens')
    assert.ok(!optimizer || Number.isFinite(optimizer.median), 'Token Optimizer data is included when measured')
    assert.ok(runs.every((run) => run.testRuns > 0 && run.testRunsUnpiped === 0), 'every test run was piped')
    assert.ok(principles.calls > baseline.calls, 'principles did not cut calls')
    assert.ok(rtk.biggest < baseline.biggest, 'largest tool result smaller with rtk')
    assert.ok(rtk.saved < median(runs.map((run) => total(run.calls[run.calls.length - 1]))), 'rtk saving below one late call')
    assert.ok(runs.every((run) => !run.testsChanged), 'no run edited the tests')
    assert.ok(runs.every((run) => Number.isFinite(run.calls[0].cacheRead)), 'first-call cache usage is recorded')
  })

  test('the page tokenizes the instructions file the kit installed', () => {
    const file = readFileSync(new URL('../scripts/token-diet/principles.md', import.meta.url), 'utf8')
    assert.equal(instructions(data.principles), file)
  })
})
