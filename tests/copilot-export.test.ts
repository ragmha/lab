import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const available = (command: string) => spawnSync(command, ['--version']).error ? undefined : command
const bash = available('bash')
const powershell = available('pwsh') ?? available('powershell')
let fixture: string
let home: string
let bin: string
const raw = 'not parsed JSON\r\n{"private":"do-not-print-conversation-or-title"}\n'

beforeEach(() => {
  fixture = join(root, `.copilot-export-fixture-${randomUUID()}`)
  home = join(fixture, 'copilot home')
  bin = join(fixture, 'cli bin')
  mkdirSync(bin, { recursive: true })
  for (const id of ['session-a', 'session-b']) {
    const directory = join(home, 'session-state', id)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'events.jsonl'), `${raw}${id}\n`)
  }
})

afterEach(() => rmSync(fixture, { recursive: true, force: true }))

type Runner = {
  executable: string
  script: string
  args: (args: string[]) => string[]
  stub: () => void
}

const runners: [string, Runner | undefined][] = [
  ['Bash', bash ? {
    executable: bash,
    script: join(root, 'public/copilot-export.sh'),
    args: args => args,
    stub: () => writeFileSync(join(bin, 'copilot'), `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$STUB_ARGS"
printf '%s\\n' "$COPILOT_OTEL_ENABLED" "$COPILOT_OTEL_EXPORTER_TYPE" "$COPILOT_OTEL_CAPTURE_CONTENT" "$OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT" "$INHERITED_VALUE" > "$STUB_ENV"
if [ "\${STUB_EMPTY:-0}" != 1 ]; then
  printf '{"synthetic":true}\\n' > "$COPILOT_OTEL_FILE_EXPORTER_PATH"
fi
exit "\${STUB_EXIT:-0}"
`, { mode: 0o700 }),
  } : undefined],
  ['PowerShell', powershell ? {
    executable: powershell,
    script: join(root, 'public/copilot-export.ps1'),
    args: args => args.map(arg => ({
      '--file': '-File', '--session': '-Session', '--output': '-Output',
      '--capture': '-Capture', '--list': '-List', '--help': '-Help',
      '--': '-CopilotArgs',
    } as Record<string, string>)[arg] ?? arg),
    stub: () => writeFileSync(join(bin, 'copilot.ps1'), `
[IO.File]::WriteAllText($env:STUB_ARGS, (($args | ForEach-Object { [string]$_ }) -join "\`n") + "\`n")
[IO.File]::WriteAllText($env:STUB_ENV, "$env:COPILOT_OTEL_ENABLED\`n$env:COPILOT_OTEL_EXPORTER_TYPE\`n$env:COPILOT_OTEL_CAPTURE_CONTENT\`n$env:OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT\`n$env:INHERITED_VALUE\`n")
if ($env:STUB_EMPTY -ne '1') {
  [IO.File]::WriteAllText($env:COPILOT_OTEL_FILE_EXPORTER_PATH, "{""synthetic"":true}\`n")
}
exit ([int]$env:STUB_EXIT)
`),
  } : undefined],
]

for (const [name, runner] of runners) {
  if (!runner) {
    test.skip(`${name} validation requires an installed interpreter`, () => {})
    continue
  }
  describe(`${name} raw export helper`, () => {
    const run = (args: string[], input = '', environment: Record<string, string> = {}) => {
      const prefix = name === 'Bash' ? [] : ['-NoProfile', '-File']
      return spawnSync(runner!.executable, [...prefix, runner!.script, ...runner!.args(args)], {
        cwd: fixture,
        input,
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          COPILOT_HOME: home,
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          STUB_ARGS: join(fixture, 'arguments.txt'),
          STUB_ENV: join(fixture, 'environment.txt'),
          INHERITED_VALUE: 'unchanged',
          COPILOT_OTEL_EXPORTER_TYPE: 'original-exporter',
          COPILOT_OTEL_CAPTURE_CONTENT: 'true',
          STUB_EXIT: '0',
          ...environment,
        },
      })
    }

    test('lists only neutral IDs and modification times, without exporting', () => {
      const result = run(['--list'])
      assert.equal(result.status, 0)
      assert.ok(result.stdout.includes('1) session-a  modified '))
      assert.ok(result.stdout.includes('2) session-b  modified '))
      assert.ok(!result.stdout.includes('do-not-print'))
      assert.deepEqual(readdirSync(fixture).sort(), ['cli bin', 'copilot home'])
    })

    test('requires an explicit choice and never automatically picks the newest', () => {
      const result = run([], '\n')
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /selection/i)
      assert.deepEqual(readdirSync(fixture).sort(), ['cli bin', 'copilot home'])
    })

    test('selects the requested fixture through the selection UI', () => {
      const output = join(fixture, 'selected raw.jsonl')
      const result = run(['--output', output], '2\n')
      assert.equal(result.status, 0)
      assert.equal(readFileSync(output, 'utf8'), `${raw}session-b\n`)
      assert.ok(result.stdout.includes(output))
    })

    test('copies the exact selected session bytes without touching the original', () => {
      const source = join(home, 'session-state/session-a/events.jsonl')
      const original = readFileSync(source)
      const result = run(['--session', 'session-a'])
      assert.equal(result.status, 0)
      assert.deepEqual(readFileSync(join(fixture, 'copilot-export.jsonl')), original)
      assert.deepEqual(readFileSync(source), original)
      assert.match(result.stdout, /RAW.*not redacted/)
      assert.ok(!result.stdout.includes('do-not-print'))
    })

    test('copies an explicit telemetry file with spaces without parsing it', () => {
      const source = join(fixture, 'raw telemetry.json')
      const output = join(fixture, 'new export.json')
      writeFileSync(source, raw)
      const result = run(['--file', source, '--output', output])
      assert.equal(result.status, 0)
      assert.equal(readFileSync(output, 'utf8'), raw)
      assert.equal(readFileSync(source, 'utf8'), raw)
      assert.ok(result.stdout.includes(output))
    })

    test('never overwrites an existing export or the input itself', () => {
      const source = join(home, 'session-state/session-a/events.jsonl')
      const output = join(fixture, 'existing.jsonl')
      writeFileSync(output, 'preserve output')
      for (const destination of [output, source]) {
        assert.notEqual(run(['--file', source, '--output', destination]).status, 0)
      }
      assert.equal(readFileSync(output, 'utf8'), 'preserve output')
      assert.equal(readFileSync(source, 'utf8'), `${raw}session-a\n`)
    })

    test('rejects missing, empty, wrong-extension, and ambiguous inputs', () => {
      const empty = join(fixture, 'empty.jsonl')
      const wrong = join(fixture, 'raw.txt')
      writeFileSync(empty, '')
      writeFileSync(wrong, raw)
      for (const args of [
        ['--file', join(fixture, 'missing.json')],
        ['--file', empty],
        ['--file', wrong],
        ['--file', wrong, '--session', 'session-a'],
        ['--session', '../session-a'],
        ['--capture'],
        ['--capture', '--file', empty, '--output', 'capture.jsonl'],
      ]) {
        assert.notEqual(run(args).status, 0)
      }
      assert.ok(!readdirSync(fixture).includes('copilot-export.jsonl'))
    })

    test('capture uses native child-only settings, preserves arguments and CLI exit', () => {
      runner!.stub()
      const output = join(fixture, 'future telemetry.jsonl')
      const argumentsToPass = ['argument with spaces', 'embedded"quote', '']
      // The named array parameter is exercised in-process on PowerShell below.
      const result = name === 'PowerShell'
        ? spawnSync(runner!.executable, ['-NoProfile', '-Command', `
          $env:COPILOT_HOME = '${home.replaceAll("'", "''")}';
          $env:PATH = '${bin.replaceAll("'", "''")}' + [IO.Path]::PathSeparator + $env:PATH;
          $env:STUB_ARGS = '${join(fixture, 'arguments.txt').replaceAll("'", "''")}';
          $env:STUB_ENV = '${join(fixture, 'environment.txt').replaceAll("'", "''")}';
          $env:STUB_EXIT = '19'; $env:INHERITED_VALUE = 'unchanged';
          & '${runner!.script.replaceAll("'", "''")}' -Capture -Output '${output.replaceAll("'", "''")}' -CopilotArgs @('argument with spaces', 'embedded"quote', '');
          exit $LASTEXITCODE
        `], { cwd: fixture, encoding: 'utf8', timeout: 10_000 })
        : run(['--capture', '--output', output, '--', ...argumentsToPass], '', { STUB_EXIT: '19' })
      assert.equal(result.status, 19)
      assert.equal(readFileSync(output, 'utf8'), '{"synthetic":true}\n')
      assert.equal(readFileSync(join(fixture, 'arguments.txt'), 'utf8'), `${argumentsToPass.join('\n')}\n`)
      assert.equal(readFileSync(join(fixture, 'environment.txt'), 'utf8'), 'true\nfile\nfalse\nfalse\nunchanged\n')
      assert.ok(result.stdout.includes(output))
      assert.notEqual(run(['--capture', '--output', output]).status, 0)
      assert.equal(readFileSync(output, 'utf8'), '{"synthetic":true}\n')
    })

    test('reports empty telemetry without replacing the CLI exit status', () => {
      runner!.stub()
      const result = run(['--capture', '--output', 'empty capture.jsonl'], '', { STUB_EMPTY: '1', STUB_EXIT: '23' })
      assert.equal(result.status, 23)
      assert.match(result.stderr, /missing or empty/)
      assert.ok(!result.stdout.includes('Drag this raw file'))
    })

    const symlinkTest = process.platform === 'win32' ? test.skip : test
    symlinkTest('refuses a dangling output symlink', () => {
      const output = join(fixture, 'link.jsonl')
      symlinkSync(join(fixture, 'absent.jsonl'), output)
      assert.notEqual(run(['--session', 'session-a', '--output', output]).status, 0)
    })
  })
}
