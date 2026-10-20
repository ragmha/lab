import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { run } from 'node:test'
import { spec } from 'node:test/reporters'
import { setTimeout } from 'node:timers/promises'

const base = process.env.LAB_TEST_URL ?? 'http://127.0.0.1:4397'
const runtime = resolve('.checks/browser-runtime')
await mkdir(runtime, { recursive: true })
const env = {
  ...process.env,
  TMPDIR: runtime,
  LAB_TEST_URL: base,
  CHESS_TEST_URL: new URL('/chess/', base).href,
  SESSION_FLAME_TEST_URL: new URL('/session-flame/', base).href,
}
const server = process.env.LAB_TEST_URL ? null : spawn(process.execPath, [
  'node_modules/astro/astro.js', 'preview', '--host', '127.0.0.1', '--port', '4397',
], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let serverOutput = ''
server?.stdout.on('data', (chunk) => { serverOutput += chunk })
server?.stderr.on('data', (chunk) => { serverOutput += chunk })

try {
  if (server) {
    let ready = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error(`Preview exited: ${serverOutput}`)
      // Check this process's ready message before probing; never test an unrelated listener.
      if (serverOutput.includes(base)) {
        const response = await fetch(base).catch(() => null)
        if (response?.ok) { ready = true; break }
      }
      await setTimeout(100)
    }
    if (!ready) throw new Error(`Preview was not ready: ${serverOutput}`)
  }
  Object.assign(process.env, env)
  const controller = new AbortController()
  const tests = run({
    files: ['tests/lab.browser.mjs', 'tests/chess.browser.mjs', 'tests/session-flame.browser.mjs'],
    concurrency: 1,
    timeout: 120_000,
    signal: controller.signal,
  })
  tests.on('test:fail', () => {
    process.exitCode = 1
    controller.abort()
  })
  for await (const output of tests.compose(spec)) process.stdout.write(output)
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM')
    await once(server, 'exit')
  }
}
