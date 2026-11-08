import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { request } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lessons, releases } from '../src/data/universe.mjs'
import { createStore } from '../../../.github/extensions/universe-passport/store.mjs'
import { exportProgress } from '../src/data/universe-progress.mjs'
import { startServer } from '../../../.github/extensions/universe-passport/server.mjs'

let dir
let server
const serverErrors = []

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'universe-passport-'))
  server = await startServer(createStore(join(dir, 'progress.json'), lessons.length), (error) => serverErrors.push(error))
})

after(async () => {
  await server.close()
  await rm(dir, { recursive: true, force: true })
  assert.deepEqual(serverErrors, [])
})

const bearer = () => ({ Authorization: `Bearer ${server.token}` })
const post = (command, headers = {}) => fetch(`${server.origin}/api/progress`, {
  method: 'POST',
  headers: { ...bearer(), Origin: server.origin, 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(command),
})

function statusWithHost(host) {
  return new Promise((resolve, reject) => {
    const req = request(`${server.origin}/`, { headers: { Host: host } }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })
    req.on('error', reject)
    req.end()
  })
}

test('serves the panel assets under a strict CSP', async () => {
  for (const [path, type] of [['/', 'text/html'], ['/app.mjs', 'text/javascript'], ['/apps/site/src/data/universe-progress.mjs', 'text/javascript'], ['/apps/site/src/data/universe.mjs', 'text/javascript'], ['/styles.css', 'text/css']]) {
    const response = await fetch(`${server.origin}${path}`)
    assert.equal(response.status, 200, path)
    assert.match(response.headers.get('content-type'), new RegExp(type))
    assert.match(response.headers.get('content-security-policy'), /script-src 'self';/)
  }
  const html = await (await fetch(`${server.origin}/`)).text()
  assert.match(html, /<a class="button" href="\/downloads\/universe-2026-starter\.pptx" download>/)
})

test('serves the corrected deck as an attachment', async () => {
  const response = await fetch(`${server.origin}/downloads/universe-2026-starter.pptx`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-disposition'), /^attachment; filename="universe-2026-starter\.pptx"$/)
  const hash = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')
  assert.equal(hash, 'd6b028ad04f0c9e9d20c0f223bbe2be48bcc623ee3840b61a47caf7d34924fa8')
})

test('state needs the panel token and exposes the shared content', async () => {
  assert.equal((await fetch(`${server.origin}/api/state`)).status, 401)
  const response = await fetch(`${server.origin}/api/state`, { headers: bearer() })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.lessons.length, lessons.length)
  assert.equal(body.releases.length, releases.length)
  assert.equal(body.labs.length, 4)
  assert.match(body.scope, /checked 1 Nov 2026/)
  assert.ok(body.releases.every((item) => body.lessons[item.lesson]), 'every release links to a real lesson')
  assert.deepEqual(body.progress, { stamps: {}, bestRound: null })
})

test('refuses other hosts, cross-site callers, and non-JSON writes', async () => {
  assert.equal(await statusWithHost('evil.example'), 403)
  assert.equal((await fetch(`${server.origin}/api/state`, { headers: { ...bearer(), Origin: 'https://evil.example' } })).status, 403)
  const withoutOrigin = await fetch(`${server.origin}/api/progress`, {
    method: 'POST',
    headers: { ...bearer(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'stamp', lesson: 0, route: 'exercise' }),
  })
  assert.equal(withoutOrigin.status, 403)
  assert.equal((await post({ type: 'stamp', lesson: 0, route: 'exercise' }, { 'Content-Type': 'text/plain' })).status, 415)
})

test('stamps, unstamps, and keeps the best round on disk', async () => {
  const results = await Promise.all([
    post({ type: 'stamp', lesson: 0, route: 'exercise' }),
    post({ type: 'stamp', lesson: 1, route: 'practice' }),
  ])
  assert.deepEqual(results.map((response) => response.status), [200, 200])
  await post({ type: 'round', score: 6 })
  await post({ type: 'round', score: 3 })
  const { progress } = await (await post({ type: 'unstamp', lesson: 1 })).json()
  assert.deepEqual(Object.keys(progress.stamps), ['0'])
  assert.equal(progress.stamps[0].route, 'exercise')
  assert.equal(progress.bestRound.score, 6)
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'progress.json'), 'utf8')), progress)

  const invalid = await post({ type: 'stamp', lesson: lessons.length, route: 'exercise' })
  assert.equal(invalid.status, 400)
  assert.equal((await invalid.json()).error.code, 'invalid_command')
})

test('moves unreadable progress aside instead of overwriting it', async () => {
  const file = join(dir, 'broken.json')
  await writeFile(file, '{ not json')
  const store = createStore(file, lessons.length)
  assert.deepEqual(await store.read(), { stamps: {}, bestRound: null })
  const aside = store.notice.match(/moved to (\S+)\./)[1]
  assert.equal(await readFile(aside, 'utf8'), '{ not json')
})

test('imports progress through the authenticated route and rejects invalid imports atomically', async () => {
  const at = '2026-11-02T06:00:00.000Z'
  const previous = JSON.parse(await readFile(join(dir, 'progress.json'), 'utf8'))
  const response = await post({ type: 'import', text: exportProgress({
    stamps: { 0: { route: 'practice', at }, 2: { route: 'recorded', at } },
    bestRound: { score: 8, total: 8, at },
  }) })
  assert.equal(response.status, 200)
  const { progress } = await response.json()
  assert.deepEqual(progress.stamps[0], previous.stamps[0])
  assert.equal(progress.stamps[2].route, 'recorded')
  assert.equal(progress.bestRound.score, 8)
  assert.equal((await post({ type: 'import', text: '{"format":"not-passport"}' })).status, 400)
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'progress.json'), 'utf8')), progress)
})
