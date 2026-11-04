import assert from 'node:assert/strict'
import { test } from 'node:test'
import { labs, lessons, releases, sources } from '../src/data/universe.mjs'
import { emptyProgress, exportProgress, importProgress, mergeProgress, readProgress, readStoredProgress, transferLimit } from '../src/data/universe-progress.mjs'

const at = '2026-11-02T06:00:00.000Z'
const original = { stamps: { 0: { route: 'exercise', at } }, bestRound: { score: 6, total: 8, at } }

test('portable progress round-trips and merges without replacing existing evidence', () => {
  assert.deepEqual(importProgress(exportProgress(original), 8), original)
  const incoming = { stamps: { 0: { route: 'practice', at }, 1: { route: 'recorded', at } }, bestRound: { score: 3, total: 8, at } }
  const merged = mergeProgress(original, incoming)
  assert.deepEqual(merged.stamps[0], original.stamps[0])
  assert.deepEqual(merged.stamps[1], incoming.stamps[1])
  assert.deepEqual(merged.bestRound, original.bestRound)
  assert.deepEqual(Object.keys(original.stamps), ['0'], 'merge does not mutate its input')
  assert.equal(mergeProgress(merged, { stamps: {}, bestRound: { score: 8, total: 8, at } }).bestRound.score, 8)
  assert.deepEqual(readProgress(emptyProgress(), 8), emptyProgress())
  const legacy = readStoredProgress('[0,1,1]', 8)
  assert.deepEqual(Object.keys(legacy.stamps), ['0', '1'])
  assert.equal(legacy.stamps[1].route, 'recorded', 'legacy checkmarks do not pretend to prove an exercise')
})

test('rejects malformed, oversized, foreign, and unsupported progress without accepting partial stamps', () => {
  for (const text of ['{bad', '[]', '{}', exportProgress(original).replace('"version": 1', '"version": 2'), ' '.repeat(transferLimit + 1)]) {
    assert.throws(() => importProgress(text, 8))
  }
  for (const stamps of [
    { 8: { route: 'exercise', at } },
    { '-1': { route: 'exercise', at } },
    { '01': { route: 'exercise', at } },
    { 0: { route: ['exercise'], at } },
    { 0: { route: 'exercise', at: 'invalid' } },
    JSON.parse('{"__proto__":{"route":"exercise","at":"2026-11-02"}}'),
  ]) assert.throws(() => importProgress(exportProgress({ stamps, bestRound: null }), 8))
  for (const bestRound of [undefined, { score: 9, total: 8, at }, { score: 2, total: 7, at }]) {
    assert.throws(() => readProgress({ stamps: {}, bestRound }, 8))
  }
})

test('coverage keeps adjacent releases distinct and every lab has a sourced exercise and check', () => {
  assert.equal(lessons.length, 8)
  assert.equal(releases.length, 57)
  assert.equal(releases.filter((release) => release.addition).length, 3)
  assert.equal(new Set(releases.map((release) => release.name)).size, releases.length)
  assert.equal(labs.length, 4)
  for (const lab of labs) {
    assert.ok(lab.steps.length >= 3 && lab.steps.length <= 5)
    for (const field of ['goal', 'prerequisites', 'warning', 'done', 'fallback', 'question', 'answer']) assert.ok(lab[field], `${lab.id}: ${field}`)
  }
  for (const entry of [...lessons, ...releases, ...labs]) {
    assert.ok(entry.reading.every((key) => sources[key]), 'all source references resolve')
  }
})
