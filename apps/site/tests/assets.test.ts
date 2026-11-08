import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import config from '../astro.config.mjs'
import recorded from '../src/lib/session-flame-runs.json'

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

test('Stockfish distribution and its GPL/source notices remain intact', () => {
  const hashes = {
    'stockfish-19-lite-single.js': 'ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a',
    'stockfish-19-lite-single.wasm': 'ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de',
  }
  for (const [file, expected] of Object.entries(hashes)) {
    assert.equal(hash(readFileSync(`public/chess/${file}`)), expected)
  }
  assert.match(readFileSync('public/chess/COPYING.txt', 'utf8'), /GNU GENERAL PUBLIC LICENSE/)
  assert.match(readFileSync('public/chess/SOURCE.txt', 'utf8'), /v19\.0\.1\.tar\.gz/)
  assert.match(readFileSync('public/fonts/jetbrains-mono/OFL.txt', 'utf8'), /SIL OPEN FONT LICENSE/)
})

test('published fixtures match recorded hashes and contain no private machine paths or credentials', () => {
  assert.equal(recorded.runs.length, 9)
  for (const run of recorded.runs) {
    const bytes = readFileSync(`public/session-flame/runs/${run.file}`)
    assert.equal(hash(bytes), run.sha256)
    assert.equal(bytes.length, run.bytes)
    assert.doesNotMatch(bytes.toString(), /\/Users\/|\/private\/|github_pat_|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN .*PRIVATE KEY/)
  }
})

test('GitHub language snapshot contains positive byte counts, unique names and safe colors', () => {
  const languages = JSON.parse(readFileSync('src/data/languages.json', 'utf8'))
  assert.ok(Array.isArray(languages) && languages.length > 0)
  const names = new Set()
  for (const { size, node } of languages) {
    assert.ok(Number.isSafeInteger(size) && size > 0)
    assert.equal(typeof node.name, 'string')
    assert.ok(node.name.trim() && !names.has(node.name))
    names.add(node.name)
    if (node.color !== null) assert.match(node.color, /^#[0-9a-f]{6}$/i)
  }
})

test('GitHub Pages custom domain matches the canonical Astro site', () => {
  assert.equal(readFileSync('public/CNAME', 'utf8').trim(), 'lab.raghib.io')
  assert.equal(config.site, 'https://lab.raghib.io')
})
