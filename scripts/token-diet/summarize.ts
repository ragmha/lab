// Turns .work/runs into src/data/token-diet.json for /token-diet/.
// Usage: [ROUND=2] [MODEL=x] bun scripts/token-diet/summarize.ts (after ./run.sh run). Round 2 reads .work/r2;
// a MODEL other than the default reads runs-<model> and writes token-diet[-2]-<model>.json.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCompleteRuns } from './validate-runs'

type Kind = 'fresh' | 'cacheRead' | 'cacheWrite' | 'output'
type Tool = { name: string; ok: boolean; label: string; outTokens: number }
type Call = Record<Kind, number> & { ms: number; tools: Tool[] }

const kit = dirname(fileURLToPath(import.meta.url))
const round = process.env.ROUND === '2' ? 2 : 1
const venv = join(kit, '.work/venv')
const work = round === 2 ? join(kit, '.work/r2') : join(kit, '.work')
const runModel = process.env.MODEL ?? 'claude-sonnet-5.5'
const suffix = runModel === 'claude-sonnet-5.5' ? '' : `-${runModel}`
const runsDir = join(work, `runs${suffix}`)
const outFile = join(kit, `../../src/data/token-diet${round === 2 ? '-2' : ''}${suffix}.json`)
const read = (...path: string[]) => readFileSync(join(...path), 'utf8')
const kinds: Record<string, Kind> = { input: 'fresh', cache_read: 'cacheRead', cache_write: 'cacheWrite', output: 'output' }
const check = (ok: unknown, message: string) => {
  if (!ok) throw new Error(message)
}
const same = <T>(previous: T | undefined, next: T, what: string) => {
  check(previous === undefined || previous === next, `${what} differs between runs`)
  return next
}

const rates: Partial<Record<Kind, number>> = {}
let prompt: string | undefined
let model: string | undefined
let copilot: string | undefined
let effort: string | undefined
let toolDefinitionsTokens: number | undefined

const runs = readdirSync(runsDir)
  .filter((id) => /^[a-f][1-5]$/.test(id))
  .sort()
  .map((id) => {
    const dir = join(runsDir, id)
    const box = read(dir, 'sandbox.txt').trim()
    const redact = (text: string) => {
      const label = text
        .replaceAll(`cd ${box}/invoicer && `, '')
        .replaceAll(`${box}/invoicer/`, '')
        .replaceAll(`${box}/invoicer`, '.')
        .replaceAll(`${box}/home`, '~')
        .replace(/\/(private\/)?tmp\/ws\.\w+/g, '…')
        .replace(/\s+/g, ' ')
        .trim()
      return label.length > 80 ? `${label.slice(0, 79)}…` : label
    }
    const events = read(dir, 'events.jsonl').trim().split('\n').map((line) => JSON.parse(line))
    const calls: Call[] = []
    const byApiCall = new Map<string, Call>()
    const byToolCall = new Map<string, Tool>()
    let start = 0
    let end = 0
    let nanoAiu = 0
    let totals: Record<Kind, number> | undefined
    let proseChars = 0
    let argChars = 0
    let hookChars = 0
    let skills = 0
    let testRuns = 0
    let testRunsUnpiped = 0

    for (const { type, timestamp, data } of events) {
      if (type === 'session.start') {
        start = Date.parse(timestamp)
        model = same(model, data.selectedModel, 'model')
        copilot = same(copilot, data.copilotVersion, 'Copilot version')
      }
      if (type === 'user.message') prompt = same(prompt, data.content, 'prompt')
      if (type === 'system.message') skills = (data.content.match(/<skill>\s*<name>/g) ?? []).length
      if (type === 'hook.end') hookChars += data.output?.additionalContext?.length ?? 0
      if (type === 'session.usage_record') {
        const usage = data.usage
        const call: Call = { fresh: 0, cacheRead: 0, cacheWrite: 0, output: 0, ms: usage.duration, tools: [] }
        let nano = 0
        for (const detail of usage.copilotUsage.tokenDetails) {
          const kind = kinds[detail.tokenType]
          check(kind, `${id}: unknown token type ${detail.tokenType}`)
          rates[kind] = same(rates[kind], detail.costPerBatch / detail.batchSize, `${kind} rate`)
          call[kind] = detail.tokenCount
          nano += rates[kind] * detail.tokenCount
        }
        check(nano === usage.copilotUsage.totalNanoAiu, `${id}: call cost does not match its token counts`)
        check(call.fresh + call.cacheRead + call.cacheWrite === usage.inputTokens, `${id}: input tokens do not add up`)
        check(call.output === usage.outputTokens, `${id}: output tokens do not match`)
        check(usage.fusion || usage.model === model, `${id}: call used ${usage.model}`)
        effort = same(effort, usage.reasoningEffort, 'reasoning effort')
        calls.push(call)
        byApiCall.set(usage.apiCallId, call)
      }
      if (type === 'assistant.message') {
        proseChars += data.content?.length ?? 0
        for (const request of data.toolRequests ?? []) {
          const args = request.arguments ?? {}
          const tool = { name: request.name, ok: false, label: redact(String(args.command ?? args.path ?? '')), outTokens: 0 }
          argChars += JSON.stringify(args).length
          for (const part of request.name === 'bash' ? String(args.command).split(/&&|;|\n/) : []) {
            if (!/\bpytest\b/.test(part)) continue
            testRuns++
            if (!part.includes('|')) testRunsUnpiped++
          }
          const call = byApiCall.get(data.apiCallId)
          check(call, `${id}: tool request without a model call`)
          call!.tools.push(tool)
          byToolCall.set(request.toolCallId, tool)
        }
      }
      if (type === 'tool.execution_complete') {
        const tool = byToolCall.get(data.toolCallId)
        check(tool, `${id}: tool result without a request`)
        tool!.ok = data.success
        tool!.outTokens = data.toolTelemetry?.metrics?.result_token_count ?? 0
      }
      if (type === 'session.shutdown') {
        end = Date.parse(timestamp)
        nanoAiu = data.totalNanoAiu
        toolDefinitionsTokens = same(toolDefinitionsTokens, data.toolDefinitionsTokens, 'tool definitions')
        totals = { fresh: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
        for (const [type, { tokenCount }] of Object.entries<{ tokenCount: number }>(data.tokenDetails)) {
          totals[kinds[type]] = tokenCount
        }
      }
    }

    check(start && end && totals && calls.length, `${id}: incomplete events`)
    const { success, committed, subjectOk, testsPass, testsChanged, subjects } = JSON.parse(read(dir, 'verdict.json'))
    let rtk = null
    if (/^[de]/.test(id)) {
      const { summary } = JSON.parse(read(dir, 'rtk-gain.json'))
      rtk = { commands: summary.total_commands, input: summary.total_input, output: summary.total_output, saved: summary.total_saved }
    }
    return {
      id,
      variant: id[0],
      rep: Number(id[1]),
      ranAt: new Date(start).toISOString(),
      success,
      committed,
      subjectOk,
      testsPass,
      testsChanged,
      subjects,
      wallMs: end - start,
      nanoAiu,
      totals,
      skills,
      hookChars,
      proseChars,
      argChars,
      testRuns,
      testRunsUnpiped,
      rtk,
      calls,
    }
  })

const canonicalRoundOne = round === 1 && suffix === ''
assertCompleteRuns(runs, canonicalRoundOne)

const pytest = spawnSync(join(venv, 'bin/python'), ['-m', 'pytest', '-q', '-p', 'no:cacheprovider'], {
  cwd: join(work, 'fixture-repo'),
  encoding: 'utf8',
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
})
const pytestOutput = pytest.stdout + pytest.stderr
const [, failing, passing] = pytestOutput.match(/(\d+) failed, (\d+) passed/) ?? []
check(failing && passing, 'could not read the fixture test summary')

const versions = Object.fromEntries(
  read(work, 'versions.txt')
    .trim()
    .split('\n')
    .map((line) => {
      const [name, ...rest] = line.split(' ')
      const value = rest.at(-1)!.replace(/\.$/, '')
      return [name, name === 'caveman' ? value.slice(0, 7) : value]
    }),
)
versions.copilot = copilot!

const principles = read(kit, 'principles.md')
  .split('\n')
  .filter((line) => line.startsWith('- '))
  .map((line) => line.slice(2))

const json = `${JSON.stringify(
  {
    model,
    effort,
    versions,
    prompt,
    principles,
    fixture: {
      tests: Number(failing) + Number(passing),
      failing: Number(failing),
      outputLines: (pytestOutput.match(/\n/g) ?? []).length,
    },
    rates,
    toolDefinitionsTokens,
    runs,
  },
  null,
  2,
)}\n`

for (const leak of ['/Users/', '/tmp/ws', '/private/', 'token-diet', 'gho_', 'ghp_', 'github_pat_']) {
  check(!json.includes(leak), `summary would publish ${leak}`)
}
mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, json)
console.log(`wrote ${runs.length} runs to ${relative(process.cwd(), outFile)}`)
