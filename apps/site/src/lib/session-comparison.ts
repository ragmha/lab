import { formatDuration, formatTokens, isMainAgentEvent, type Session, type Span } from './session-flame'

export interface TokenRange {
  min: number
  max: number
  samples: number
}

export interface RunEvidence {
  models: string[]
  agentModels: string[]
  prompts: string[]
  start: number
  duration: number
  input?: TokenRange
  context?: TokenRange
  limits: number[]
  tiers: string[]
  efforts: string[]
  tools: number
  failures: number
  compactions: number
  warnings: string[]
}

export interface ComparisonRun {
  name: string
  hash: string
  session: Session
  evidence: RunEvidence
}

const nonnegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

function range(values: number[]): TokenRange | undefined {
  if (!values.length) return undefined
  return values.reduce((result, value) => ({
    min: Math.min(result.min, value),
    max: Math.max(result.max, value),
    samples: result.samples + 1,
  }), { min: Infinity, max: -Infinity, samples: 0 })
}

/** Per-call input and occasional context snapshots are different measurements; never substitute one for the other. */
export function runEvidence(session: Session): RunEvidence {
  const main = session.timeline.filter(({ event }) => isMainAgentEvent(event))
  const promptEvents = main.filter(({ event }) => event.type === 'user.message')
  const start = promptEvents[0]?.at ?? 0
  const models = new Set<string>()
  const agentModels = new Set<string>()
  const input: number[] = []
  let missingInput = 0
  const context: number[] = []
  const limits = new Set<number>()
  const tiers = new Set<string>()
  const efforts = new Set<string>()
  // Newer CLIs log session.usage_record instead of assistant.usage; read one kind so no call counts twice.
  const usageType = main.some(({ event }) => event.type === 'session.usage_record') ? 'session.usage_record' : 'assistant.usage'
  for (const { event, at } of session.timeline) {
    const data = event.data ?? {}
    const subagent = !isMainAgentEvent(event)
    const usage = data.usage && typeof data.usage === 'object' && !Array.isArray(data.usage)
      ? data.usage as Record<string, unknown>
      : {}
    for (const model of [data.model, data.selectedModel, data.newModel, usage.model]) {
      if (typeof model === 'string' && model.trim()) (subagent ? agentModels : models).add(model)
    }
    if (!subagent && event.type === 'session.start') {
      if (typeof data.contextTier === 'string') tiers.add(data.contextTier)
      if (typeof data.reasoningEffort === 'string') efforts.add(data.reasoningEffort)
    }
    if (subagent || at < start) continue
    if (event.type === usageType) {
      const usage = (usageType === 'assistant.usage' ? data : data.usage ?? {}) as Record<string, unknown>
      if (nonnegative(usage.inputTokens)) input.push(usage.inputTokens)
      else missingInput++
      if (nonnegative(usage.maxPromptTokens) && usage.maxPromptTokens > 0) limits.add(usage.maxPromptTokens)
    }
    if (['session.compaction_start', 'session.compaction_complete', 'session.shutdown'].includes(event.type)) {
      for (const value of [data.currentTokens, data.preCompactionTokens, data.postCompactionTokens]) {
        if (nonnegative(value)) context.push(value)
      }
      if (nonnegative(data.tokenLimit) && data.tokenLimit > 0) limits.add(data.tokenLimit)
    }
  }
  const tools = session.spans.filter((span) => ['tool', 'agent'].includes(span.kind) && span.start >= start)
  const warnings: string[] = []
  if (!promptEvents.length) warnings.push('No user prompt recorded; aligned to the first event instead.')
  if (!models.size) warnings.push('Main model not recorded.')
  if (models.size > 1) warnings.push('Multiple main models recorded; this is not a single-model run.')
  if (!input.length) warnings.push('Per-call input tokens not recorded; context snapshots are not a substitute.')
  else if (missingInput) warnings.push(`${missingInput} usage record(s) have missing or invalid input tokens; the input range has partial coverage.`)
  if (!context.length) warnings.push('Context size not recorded.')
  if (!main.some(({ event }) => event.type === 'session.shutdown')) warnings.push('No session end recorded; the log may be incomplete.')
  if (session.skipped) warnings.push(`${session.skipped} invalid event(s) skipped.`)
  if (session.unmatched) warnings.push(`${session.unmatched} event(s) could not be matched to a span.`)
  const open = session.spans.filter((span) => span.status === 'open' && span.kind !== 'session').length
  if (open) warnings.push(`${open} span(s) unfinished when the log ended.`)
  return {
    models: [...models],
    agentModels: [...agentModels],
    prompts: promptEvents.map(({ event }) => typeof event.data?.content === 'string' ? event.data.content : ''),
    start,
    duration: Math.max(0, session.total - start),
    input: range(input),
    context: range(context),
    limits: [...limits].sort((a, b) => a - b),
    tiers: [...tiers],
    efforts: [...efforts],
    tools: tools.length,
    failures: tools.filter((span) => span.status === 'failed').length,
    compactions: session.spans.filter((span) => span.kind === 'compaction' && span.start >= start).length,
    warnings,
  }
}

/** A common, uncompressed wall-clock axis. Never fit each run independently. */
export function comparisonScale(runs: ComparisonRun[]) {
  return Math.max(1, ...runs.map(({ evidence }) => evidence.duration))
}

export function comparisonBar(span: Span, start: number, duration: number) {
  const left = Math.max(0, span.start - start)
  const right = Math.min(duration, span.end - start)
  if (right <= left) return undefined
  return { left: left / duration, width: (right - left) / duration }
}

export function tokenRangeLabel(value: TokenRange | undefined) {
  if (!value) return 'Not recorded'
  return value.min === value.max ? formatTokens(value.min) : `${formatTokens(value.min)}–${formatTokens(value.max)}`
}

export function comparisonWarnings(a: ComparisonRun, b: ComparisonRun) {
  const warnings = [
    'Observed durations, not proof that model or context size caused a difference.',
  ]
  if (a.hash === b.hash) warnings.push('Both selections contain the same log.')
  if (JSON.stringify(a.evidence.prompts) !== JSON.stringify(b.evidence.prompts)) {
    warnings.push('The recorded prompt sequences differ; these runs are not the same workload.')
  }
  return warnings
}

/** Local, gist-ready evidence only: no prompt text, tool contents or automatic publication. */
export function comparisonMarkdown(runs: ComparisonRun[]) {
  const cell = (text: string) => text.replace(/[\\`*_{}[\]<>|]/g, (character) => `\\${character}`).replace(/[\r\n]/g, ' ')
  const lines = [
    '# Recorded session comparison',
    '',
    'Source: user-imported Copilot CLI events.jsonl files, not independently verified. The illustrative TodoMVC sample is not benchmark evidence.',
    '',
    'Time is measured from the first recorded user prompt to the last event. Both flames use the same uncompressed elapsed-time axis; idle and tool time remain included.',
    '',
    '| Run | Main model(s) recorded | Context tier / reasoning | Elapsed | Per-call input tokens (min–max) | Context snapshots (min–max) | Recorded limit(s) | Tool / agent calls | Failed calls | Compactions |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const { name, evidence: e } of runs) {
    const settings = `${e.tiers.join(', ') || 'Not recorded'} / ${e.efforts.join(', ') || 'Not recorded'}`
    lines.push(`| ${cell(name)} | ${cell(e.models.join(', ') || 'Not recorded')} | ${cell(settings)} | ${formatDuration(e.duration)} | ${tokenRangeLabel(e.input)} | ${tokenRangeLabel(e.context)} | ${e.limits.map(formatTokens).join(', ') || 'Not recorded'} | ${e.tools} | ${e.failures} | ${e.compactions} |`)
  }
  lines.push('', '## Provenance and coverage', '')
  for (const { name, hash, session, evidence: e } of runs) {
    lines.push(`- ${cell(name)}: SHA-256 \`${hash}\`; ${session.events} events; ${e.prompts.length} user prompts; ${e.input?.samples ?? 0} input-token readings; ${e.context?.samples ?? 0} context readings.`)
    if (e.agentModels.length) lines.push(`  Sub-agent models: ${cell(e.agentModels.join(', '))}.`)
    for (const warning of e.warnings) lines.push(`  ${warning}`)
  }
  lines.push('', '## Interpretation limits', '')
  if (runs.length === 2) lines.push(...comparisonWarnings(runs[0], runs[1]).map((warning) => `- ${warning}`))
  lines.push(
    '- Per-call input tokens come only from the main agent: session.usage_record usage.inputTokens when the log has it, otherwise assistant.usage.inputTokens. Context readings come from compaction/shutdown; they are not continuous measurements, and their maximum is not necessarily the peak.',
    '- A recorded token limit (usage.maxPromptTokens or tokenLimit) is the ceiling, not the amount of context used. A larger context tier only matters once a run needs the room. Missing values remain unknown. Token counts are tokenizer-dependent across models.',
    '- Tools, generated output length, caching, reasoning settings and idle time also affect elapsed time.',
    '- A completed session or successful tool call does not prove TodoMVC correctness. Record the same acceptance-test results for each run.',
    '',
    '## Reproduction details to supply before publishing',
    '',
    '- Same TodoMVC starter commit, exact prompt sequence, harness/version, tool permissions and acceptance tests.',
    '- Exact model ID and reasoning settings; context payload and its measured input tokens; cache conditions.',
    '- Change only model OR context payload in each comparison. Repeat runs and report variation; do not infer a general ranking from one pair.',
    '- Attach only reviewed, sanitized source logs or explain how readers can reproduce them. Review filenames before publishing. Nothing has been uploaded by this app.',
    '',
  )
  return lines.join('\n')
}
