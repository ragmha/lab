import { findModelPrice, modelPrices, type ModelPrice } from './model-pricing'

export const tokenFields = ['input', 'output', 'read', 'write', 'reasoning'] as const
export type TokenField = typeof tokenFields[number]
export type Tokens = Record<TokenField, number | null>
export type Usage = Tokens & {
  cacheWrite5m: number | null
  cacheWrite1h: number | null
  session: string
  identity: string | null
  model: string
  agent: string | null
  at: number | null
  duration: number | null
  nanoAiu: number | null
  requests: number | null
  multiplier: number | null
  kind: 'call' | 'snapshot' | 'manual'
  source: 'span' | 'event' | 'manual'
  failed: boolean
}
type Tool = { session: string; identity: string | null; name: string; failed: boolean; source: 'span' | 'event' }
export type ImportedUsage = { usage: Usage[]; tools: Tool[]; warnings: string[]; recognized: number; sources: string[] }
type Sum = { value: number | null; missing: number }
export type UsageTotals = Record<TokenField | 'cacheWrite5m' | 'cacheWrite1h' | 'duration' | 'nanoAiu' | 'requests' | 'multiplier', Sum>
export type Analysis = {
  totals: UsageTotals
  models: { model: string; totals: UsageTotals }[]
  calls: Usage[]
  workload: Usage[]
  tools: { name: string; count: number; failed: number }[]
  sessions: number
  sources: string[]
  warnings: string[]
  coverage: string
  failedCalls: number
}

const emptyTokens: Tokens = { input: null, output: null, read: null, write: null, reasoning: null }
const cacheWrites = (usage: Record<string, unknown>) => {
  const cache = object(usage.cache_creation)
  const five = number(cache.ephemeral_5m_input_tokens, '5-minute cache-write tokens')
  const hour = number(cache.ephemeral_1h_input_tokens, '1-hour cache-write tokens')
  return { cacheWrite5m: five, cacheWrite1h: hour }
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const label = (value: unknown) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._ ()+-]{0,99}$/.test(value) ? value : 'unknown'
const identity = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null
function number(value: unknown, field: string, fractional = false): number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value)
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      value > Number.MAX_SAFE_INTEGER || (!fractional && !Number.isSafeInteger(value))) {
    throw new Error(`Invalid ${field}; expected a nonnegative ${fractional ? 'finite number' : 'safe integer'}.`)
  }
  return value
}
function time(value: unknown): number | null {
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return number(Number(value) / 1e6, 'timestamp', true)
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (Array.isArray(value) && value.length === 2) {
    const seconds = number(value[0], 'timestamp')
    const nanos = number(value[1], 'timestamp')
    return seconds !== null && nanos !== null ? seconds * 1000 + nanos / 1e6 : null
  }
  return null
}
function attributes(value: unknown) {
  if (!Array.isArray(value)) return object(value)
  const entries = new Map<string, unknown>()
  for (const entry of value) {
    const item = object(entry)
    if (typeof item.key !== 'string') continue
    const v = object(item.value)
    entries.set(item.key, v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue)
  }
  return Object.fromEntries(entries)
}
function validateTokens(tokens: Tokens) {
  if (tokens.reasoning !== null && tokens.output !== null && tokens.reasoning > tokens.output) {
    throw new Error('Reasoning exceeds total output tokens.')
  }
  if (tokens.input !== null && tokens.read !== null && tokens.write !== null &&
      tokens.read + tokens.write > tokens.input) {
    throw new Error('Cache reads and writes exceed total input tokens; this source has unsupported input accounting.')
  }
}
function tokens(data: Record<string, unknown>): Tokens & Pick<Usage, 'cacheWrite5m' | 'cacheWrite1h'> {
  const result: Tokens & Pick<Usage, 'cacheWrite5m' | 'cacheWrite1h'> = {
    input: number(data.inputTokens, 'input tokens'),
    output: number(data.outputTokens, 'output tokens'),
    read: number(data.cacheReadTokens, 'cache-read tokens'),
    write: number(data.cacheWriteTokens, 'cache-write tokens'),
    reasoning: number(data.reasoningTokens, 'reasoning tokens'),
    ...cacheWrites(data),
  }
  const tieredWrites = (result.cacheWrite5m ?? 0) + (result.cacheWrite1h ?? 0)
  if (tieredWrites > (result.write ?? 0)) throw new Error('Detailed cache-write tokens exceed total cache writes.')
  validateTokens(result)
  // `write` holds only cache writes without a reported TTL; tiered writes live in their own fields.
  if (result.write !== null) result.write -= tieredWrites
  return result
}

export function parseUsage(text: string, fileIndex = 0): ImportedUsage {
  const result: ImportedUsage = { usage: [], tools: [], warnings: [], recognized: 0, sources: [] }
  let session = `file:${fileIndex}`
  let codexModel = 'unknown'
  let codexTotal = ''
  const claudeCalls = new Map<string, number>()
  const claudeTools = new Map<string, Tool>()
  let metricRecords = 0
  let ignored = 0
  let issues = 0
  let visited = 0
  const warn = (message: string) => {
    issues++
    if (result.warnings.length < 20) result.warnings.push(message)
  }
  const source = (name: string) => {
    result.recognized++
    if (!result.sources.includes(name)) result.sources.push(name)
  }
  const base = (): Usage => ({
    ...emptyTokens, cacheWrite5m: null, cacheWrite1h: null, session, identity: null, model: 'unknown', agent: null, at: null,
    duration: null, nanoAiu: null, requests: null, multiplier: null,
    kind: 'call', source: 'event', failed: false,
  })

  function visit(value: unknown, location: string, depth = 0) {
    if (++visited > 100000 || depth > 8) throw new Error('Import exceeds the 100,000-record or nesting limit.')
    try {
      if (Array.isArray(value)) {
        for (const [index, item] of value.entries()) visit(item, `${location}, record ${index + 1}`, depth + 1)
        return
      }
      const record = object(value)
      if (Array.isArray(record.resourceSpans)) {
        for (const resource of record.resourceSpans) {
          for (const scope of object(resource).scopeSpans as unknown[] ?? []) {
            const spans = object(scope).spans
            if (Array.isArray(spans)) visit(spans, location, depth + 1)
          }
        }
        return
      }
      if (record.type === 'metric' || Array.isArray(record.resourceMetrics)) {
        metricRecords++
        result.recognized++
        return
      }
      if (record.type === 'span' || (typeof record.spanId === 'string' && record.attributes !== undefined)) {
        source('OpenTelemetry')
        const attr = attributes(record.attributes)
        const operation = attr['gen_ai.operation.name']
        const sourceSession = identity(attr['gen_ai.conversation.id']) ?? session
        if (operation === 'execute_tool') {
          result.tools.push({
            session: sourceSession, source: 'span',
            identity: identity(attr['gen_ai.tool.call.id']) ?? identity(record.spanId),
            name: label(attr['gen_ai.tool.name']),
            failed: object(record.status).code === 2 || attr['error.type'] !== undefined,
          })
        }
        // ponytail: chat spans only; parent spans and metric snapshots repeat their usage.
        if (operation !== 'chat') return
        const start = time(record.startTimeUnixNano ?? record.startTime)
        const end = time(record.endTimeUnixNano ?? record.endTime)
        const usage: Usage = {
          ...base(), ...tokens({
            inputTokens: attr['gen_ai.usage.input_tokens'],
            outputTokens: attr['gen_ai.usage.output_tokens'],
            cacheReadTokens: attr['gen_ai.usage.cache_read.input_tokens'],
            cacheWriteTokens: attr['gen_ai.usage.cache_write.input_tokens'],
            reasoningTokens: attr['gen_ai.usage.reasoning.output_tokens'],
          }),
          session: sourceSession, source: 'span',
          identity: identity(attr['gen_ai.response.id']) ??
            (identity(record.traceId) && identity(record.spanId) ? `${record.traceId}:${record.spanId}` : null),
          model: label(attr['gen_ai.response.model'] ?? attr['gen_ai.request.model']),
          agent: identity(attr['gen_ai.agent.id']), at: start,
          duration: number(attr['github.copilot.server_duration'], 'model duration', true) ??
            (start !== null && end !== null && end >= start ? end - start : null),
          nanoAiu: number(attr['github.copilot.nano_aiu'], 'nano-AIU', true),
          requests: 1,
          failed: object(record.status).code === 2 || attr['error.type'] !== undefined,
        }
        result.usage.push(usage)
        return
      }
      const data = object(record.data)
      const payload = object(record.payload)
      const message = object(record.message)
      if (record.type === 'session_meta' || record.type === 'turn_context' || record.type === 'response_item' ||
          (record.type === 'event_msg' && typeof payload.type === 'string')) {
        source('Codex CLI')
        if (record.type === 'session_meta') session = identity(payload.session_id ?? payload.id) ?? session
        if (record.type === 'turn_context') codexModel = label(payload.model)
        if (record.type === 'response_item' && /^(function|custom_tool)_call$/.test(String(payload.type))) {
          result.tools.push({ session, source: 'event', identity: identity(payload.call_id), name: label(payload.name), failed: false })
        }
        const info = object(payload.info)
        const total = JSON.stringify(info.total_token_usage ?? null)
        // Codex can repeat token_count events without a new model call.
        if (payload.type !== 'token_count' || !info.last_token_usage || total === codexTotal) return
        codexTotal = total
        const last = object(info.last_token_usage)
        result.usage.push({
          ...base(), ...tokens({
            inputTokens: last.input_tokens, outputTokens: last.output_tokens,
            cacheReadTokens: last.cached_input_tokens ?? 0, cacheWriteTokens: last.cache_write_input_tokens ?? 0,
            reasoningTokens: last.reasoning_output_tokens,
          }),
          model: codexModel, at: time(record.timestamp), identity: `codex:${session}:${total}`, requests: 1,
        })
        return
      }
      if (typeof record.sessionId === 'string' && ['assistant', 'user', 'system', 'summary'].includes(String(record.type))) {
        source('Claude Code')
        session = identity(record.sessionId) ?? session
        for (const item of Array.isArray(message.content) ? message.content : []) {
          const content = object(item)
          if (content.type === 'tool_use' && typeof content.id === 'string' && !claudeTools.has(content.id)) {
            const tool: Tool = { session, source: 'event', identity: content.id, name: label(content.name), failed: false }
            claudeTools.set(content.id, tool)
            result.tools.push(tool)
          }
          if (content.type === 'tool_result' && content.is_error === true) {
            const tool = claudeTools.get(String(content.tool_use_id))
            if (tool) tool.failed = true
          }
        }
        const usage = object(message.usage)
        if (record.type !== 'assistant' || !message.usage || message.model === '<synthetic>') return
        const read = number(usage.cache_read_input_tokens ?? 0, 'cache-read tokens')!
        const detailedWrites = cacheWrites(usage)
        const tieredWrites = (detailedWrites.cacheWrite5m ?? 0) + (detailedWrites.cacheWrite1h ?? 0)
        const write = number(usage.cache_creation_input_tokens ?? tieredWrites, 'cache-write tokens')!
        if (tieredWrites > write) throw new Error('Detailed cache-write tokens exceed total cache writes.')
        const uncached = number(usage.input_tokens, 'input tokens')
        const call: Usage = {
          ...base(), ...tokens({
            inputTokens: uncached === null ? null : uncached + read + write,
            outputTokens: usage.output_tokens, cacheReadTokens: read, cacheWriteTokens: write - tieredWrites,
          }),
          ...detailedWrites,
          model: label(message.model), at: time(record.timestamp), requests: 1,
          identity: identity(message.id ?? record.requestId ?? record.uuid),
          agent: record.isSidechain === true ? 'subagent' : null,
        }
        // Claude Code can log one line per content block; the last line has final usage.
        const previous = call.identity ? claudeCalls.get(call.identity) : undefined
        if (previous === undefined) {
          if (call.identity) claudeCalls.set(call.identity, result.usage.length)
          result.usage.push(call)
        } else {
          result.usage[previous] = call
        }
        return
      }
      if (record.type === 'session.start') {
        session = identity(data.sessionId) ?? session
        source('GitHub Copilot CLI')
      } else if (record.type === 'assistant.usage') {
        source('GitHub Copilot CLI')
        result.usage.push({
          ...base(), ...tokens(data), at: time(record.timestamp), model: label(data.model),
          identity: identity(data.apiCallId) ?? identity(object(data.accounting).usageId) ?? identity(record.id),
          agent: identity(record.agentId),
          duration: number(data.duration, 'model duration', true),
          nanoAiu: number(object(data.copilotUsage).totalNanoAiu, 'nano-AIU', true),
          multiplier: number(data.cost, 'legacy request multiplier', true), requests: 1,
        })
      } else if (record.type === 'session.shutdown') {
        source('GitHub Copilot CLI')
        for (const [model, raw] of Object.entries(object(data.modelMetrics))) {
          const metric = object(raw)
          result.usage.push({
            ...base(), ...tokens(object(metric.usage)), model: label(model),
            at: time(record.timestamp), kind: 'snapshot',
            identity: identity(record.id) ? `${record.id}:${model}` : null,
            nanoAiu: number(metric.totalNanoAiu, 'nano-AIU', true),
            requests: number(object(metric.requests).count, 'API requests'),
            multiplier: number(object(metric.requests).cost, 'legacy request multiplier', true),
          })
        }
      } else if (record.type === 'tool.execution_complete') {
        source('GitHub Copilot CLI')
        result.tools.push({
          session, source: 'event', identity: identity(data.toolCallId) ?? identity(record.id),
          name: label(data.toolName), failed: data.success === false,
        })
      } else if (typeof record.type === 'string' &&
          /^(session|assistant|user|tool|subagent|permission|elicitation)[.]/.test(record.type)) {
        source('GitHub Copilot CLI')
      } else {
        ignored++
      }
    } catch (error) {
      if (error instanceof Error && /limit/.test(error.message)) throw error
      warn(`${location}: ${error instanceof Error ? error.message : 'Invalid record.'}`)
    }
  }

  const input = text.replace(/^\uFEFF/, '').trim()
  if (!input) throw new Error('The file is empty.')
  let parsed: unknown
  try { parsed = JSON.parse(input) } catch {
    if (input.startsWith('[')) throw new Error('Invalid JSON array.')
    for (const [index, line] of input.split(/\r?\n/).entries()) {
      if (!line.trim()) continue
      let item: unknown
      try { item = JSON.parse(line) } catch {
        warn(`Line ${index + 1}: invalid JSON.`)
        continue
      }
      visit(item, `Line ${index + 1}`)
    }
    parsed = undefined
  }
  if (parsed !== undefined) visit(parsed, 'JSON')
  if (!result.recognized) throw new Error('No supported Copilot, Codex, Claude Code, or OpenTelemetry records found.')
  if (metricRecords) warn(`${metricRecords} metric export record(s) excluded: counters and histograms overlap spans and may be cumulative.`)
  if (ignored) warn(`${ignored} unrecognized record(s) excluded. Analysis may be incomplete.`)
  if (!result.usage.length) warn('No token usage found. Some agents save usage only for completed turns or sessions; try a finished session.')
  if (issues > 20) result.warnings.push(`${issues - 20} additional import warning(s).`)
  return result
}

function sum(records: Usage[]): UsageTotals {
  const fields = [...tokenFields, 'cacheWrite5m', 'cacheWrite1h', 'duration', 'nanoAiu', 'requests', 'multiplier'] as const
  return Object.fromEntries(fields.map((field) => {
    const known = records.map((record) => record[field]).filter((value): value is number => value !== null)
    const value = known.length ? known.reduce((a, b) => a + b, 0) : null
    if (value !== null && (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER)) {
      throw new Error('Usage total exceeds safe numeric limits.')
    }
    return [field, { value, missing: records.length - known.length }]
  })) as UsageTotals
}

export function analyzeUsage(imports: ImportedUsage[]): Analysis {
  const warnings = imports.flatMap((item, index) => item.warnings.map((warning) => `File ${index + 1}: ${warning}`))
  const records: Usage[] = []
  const seen = new Set<string>()
  let duplicateCount = 0
  for (const record of imports.flatMap((item) => item.usage)) {
    const key = record.identity ? `${record.kind}:${record.identity}` : null
    if (key && seen.has(key)) { duplicateCount++; continue }
    if (key) seen.add(key)
    records.push(record)
  }
  if (duplicateCount) warnings.push(`${duplicateCount} duplicate usage record(s) excluded.`)
  if (imports.length > 1 && records.some((record) => record.session.startsWith('file:'))) {
    warnings.push('Some files have no shared session ID. They remain separate; import related files individually if their coverage overlaps.')
  }
  const workload: Usage[] = []
  const calls: Usage[] = []
  const sessions = new Set(records.map((record) => record.session))
  const recordsBySession = new Map<string, Usage[]>()
  for (const record of records) {
    const group = recordsBySession.get(record.session) ?? []
    group.push(record)
    recordsBySession.set(record.session, group)
  }
  for (const [session, group] of recordsBySession) {
    const details = group.filter((record) => record.kind !== 'snapshot')
    const spans = details.filter((record) => record.source === 'span')
    const events = details.filter((record) => record.source !== 'span')
    const selected = spans.length ? spans : events
    if (spans.length && events.length) warnings.push('Overlapping per-call sources: using spans, not adding event usage to them. Span coverage may be partial.')
    calls.push(...selected.filter((record) => record.kind === 'call'))
    const snapshots = group.filter((record) => record.kind === 'snapshot')
    if (snapshots.length) {
      const latest = snapshots.reduce((timestamp, record) => Math.max(timestamp, record.at ?? -1), -1)
      const snapshot = snapshots.filter((record) => (record.at ?? -1) === latest)
      const byModel = new Map<string, Usage>()
      for (const record of snapshot) byModel.set(record.model, record)
      workload.push(...byModel.values())
      if (selected.length) {
        warnings.push('Session totals use the latest shutdown snapshot; the call timeline is captured detail, not additional usage.')
        if (latest >= 0 && selected.every((record) => record.at !== null)) {
          workload.push(...selected.filter((record) => record.at! > latest))
        } else {
          warnings.push('Missing timestamps prevent checking whether calls occurred after the shutdown snapshot.')
        }
      }
    } else {
      workload.push(...selected)
    }
  }
  const toolRecords: Tool[] = []
  const seenTools = new Set<string>()
  for (const tool of imports.flatMap((item) => item.tools)) {
    const key = tool.identity ? `${tool.session}:${tool.source}:${tool.identity}` : null
    if (key && seenTools.has(key)) continue
    if (key) seenTools.add(key)
    toolRecords.push(tool)
  }
  const sessionsWithToolSpans = new Set(toolRecords.filter((tool) => tool.source === 'span').map((tool) => tool.session))
  const selectedTools = toolRecords.filter((tool) => tool.source === 'span' || !sessionsWithToolSpans.has(tool.session))
  const toolGroups = new Map<string, { name: string; count: number; failed: number }>()
  for (const tool of selectedTools) {
    const group = toolGroups.get(tool.name) ?? { name: tool.name, count: 0, failed: 0 }
    group.count++; group.failed += Number(tool.failed)
    toolGroups.set(tool.name, group)
  }
  const models = [...new Set(workload.map((record) => record.model))]
    .map((model) => ({ model, totals: sum(workload.filter((record) => record.model === model)) }))
  if (workload.some((record) => tokenFields.some((field) => record[field] === null))) {
    warnings.push('Unreported token categories are unknown, not zero. Totals marked + are sums of reported values only.')
  }
  if (workload.some((record) => record.model === 'unknown')) warnings.push('Some records do not identify the model.')
  return {
    totals: sum(workload), models, workload, calls: calls.sort((a, b) => (a.at ?? 0) - (b.at ?? 0)),
    sessions: sessions.size, sources: [...new Set(imports.flatMap((item) => item.sources))],
    tools: [...toolGroups.values()], failedCalls: calls.filter((call) => call.failed).length,
    warnings: [...new Set(warnings)],
    coverage: workload.some((record) => record.kind === 'snapshot') ? 'Shutdown totals with any available call detail' :
      workload.some((record) => record.kind === 'manual') ? 'Manual assumptions, not recorded usage' :
        'Captured calls only; completeness cannot be inferred',
  }
}

export function findings(analysis: Analysis): string[] {
  const out: string[] = []
  const { input, output, read, reasoning } = analysis.totals
  const percent = (value: number) => `${Math.round(value * 100)}%`
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
  if (input.value && read.value !== null) {
    const share = read.value / input.value
    out.push(share >= 0.5
      ? `${percent(share)} of input was served from cache: most turns re-read context the model had already seen.`
      : `Only ${percent(share)} of input came from cache: much of the context was sent fresh on each call.`)
  }
  if (input.value && output.value) {
    out.push(`The model read ${compact.format(input.value / output.value)} input tokens for every token it wrote.`)
  }
  if (output.value && reasoning.value) {
    out.push(`${percent(reasoning.value / output.value)} of output was reasoning rather than visible text or tool calls.`)
  }
  const sized = analysis.calls.filter((call) => call.input !== null)
  if (sized.length >= 2) {
    const peak = sized.reduce((max, call) => call.input! > max.input! ? call : max)
    out.push(`Context peaked at ${compact.format(peak.input!)} tokens on call ${sized.indexOf(peak) + 1} of ${sized.length}.`)
    const first = sized[0].input!
    const last = sized.at(-1)!.input!
    if (first > 0 && last / first >= 1.5) {
      out.push(`Context grew ${compact.format(last / first)}× from the first captured call to the last.`)
    }
  }
  const requests = analysis.models.map((model) => ({ model: model.model, calls: model.totals.requests.value ?? 0 }))
  const allCalls = requests.reduce((sum, model) => sum + model.calls, 0)
  if (requests.length > 1 && allCalls) {
    const top = requests.reduce((max, model) => model.calls > max.calls ? model : max)
    out.push(`${requests.length} models were used; ${top.model} handled ${percent(top.calls / allCalls)} of calls.`)
  }
  const toolCalls = analysis.tools.reduce((sum, tool) => sum + tool.count, 0)
  if (toolCalls && allCalls) {
    const failed = analysis.tools.reduce((sum, tool) => sum + tool.failed, 0)
    out.push(`${compact.format(toolCalls / allCalls)} tool calls per model call${failed ? `; ${failed} tool call${failed === 1 ? '' : 's'} failed` : ''}.`)
  }
  return out
}

export type Estimate = { low: number | null; high: number | null; reason: string | null }
export function estimateCost(records: Usage[], price?: ModelPrice, date = new Date().toISOString().slice(0, 10)): Estimate {
  if (!records.length) return { low: null, high: null, reason: 'No usage available.' }
  let low = 0
  let high = 0
  let uncertain = false
  for (const record of records) {
    const rate = price ?? findModelPrice(record.model)
    if (!rate) return { low: null, high: null, reason: 'A recorded model has no verified rate in this snapshot.' }
    if (rate.promotionalUntil && date > rate.promotionalUntil) {
      return { low: null, high: null, reason: 'The published promotional rate has expired; update the snapshot.' }
    }
    if (record.input === null || record.output === null || record.read === null || record.write === null) {
      return { low: null, high: null, reason: 'Input, output, cache reads, and cache writes must all be reported or manually supplied.' }
    }
    validateTokens(record)
    const rates = rate.threshold && record.kind !== 'snapshot' && record.input > rate.threshold
      ? rate.longRates ?? rate.rates : rate.rates
    const hourRate = rate.threshold && rates === rate.longRates
      ? rate.longWrite1h ?? rate.write1h ?? rates[2]
      : rate.write1h ?? rates[2]
    const genericWrites = record.write
    const base = (priceRates: ModelPrice['rates'], priceWrite1h: number | undefined) => {
      const write5 = priceRates[2] || priceRates[0]
      const write1h = priceWrite1h || priceRates[2] || priceRates[0]
      const separateFive = (record.cacheWrite5m ?? 0) * write5
      const separateHour = (record.cacheWrite1h ?? 0) * write1h
      const unknownWritesLow = genericWrites * Math.min(write5, write1h)
      const unknownWritesHigh = genericWrites * Math.max(write5, write1h)
      const common = (record.input! - record.read! - record.write! -
        (record.cacheWrite5m ?? 0) - (record.cacheWrite1h ?? 0)) * priceRates[0] +
        record.read! * priceRates[1] + separateFive + separateHour + record.output! * priceRates[3]
      return [(common + unknownWritesLow) / 1e6, (common + unknownWritesHigh) / 1e6] as const
    }
    const estimate = base(rates, hourRate)
    const alternativeRates = rate.alternativeRates
      ? base(rate.alternativeRates, rate.alternativeWrite1h)
      : estimate
    // A snapshot aggregates many calls, so any of them may have crossed the long-context threshold.
    const snapshotMayBeLong = record.kind === 'snapshot' && rate.longRates && rate.threshold &&
      record.input > rate.threshold
    const longEstimate = snapshotMayBeLong
      ? base(rate.longRates!, rate.longWrite1h ?? rate.write1h ?? rate.longRates![2])
      : estimate
    low += Math.min(estimate[0], alternativeRates[0], longEstimate[0])
    high += Math.max(estimate[1], alternativeRates[1], longEstimate[1])
    if (snapshotMayBeLong) uncertain = true
    if (genericWrites && rate.write1h !== undefined && rate.write1h !== rates[2]) uncertain = true
    if (rate.alternativeRates) uncertain = true
  }
  return { low, high, reason: uncertain ? 'Estimate range reflects cache-write TTL, long-context, or time-based pricing where the log does not identify the billing tier.' : null }
}

export function compareModels(records: Usage[]) {
  return modelPrices.map((price) => ({ price, estimate: estimateCost(records, price) }))
    .sort((a, b) => (a.estimate.low ?? Infinity) - (b.estimate.low ?? Infinity))
}

export function estimateWorkloadCost(records: Usage[], price?: ModelPrice): Estimate {
  return estimateCost(records, price)
}

export function sessionCost(analysis: Analysis, price?: ModelPrice): Estimate {
  return estimateWorkloadCost(analysis.workload, price)
}

export function projectModelSavings(records: Usage[], alternative: ModelPrice, runs: number, currentModel?: ModelPrice) {
  if (!Number.isSafeInteger(runs) || runs < 1) throw new Error('Use a positive whole number of task runs.')
  const current = estimateWorkloadCost(records, currentModel)
  const proposed = estimateCost(records, alternative)
  if (current.low === null || current.high === null) {
    return { available: false, reason: current.reason ?? 'Current model cost is unavailable.' } as const
  }
  if (proposed.low === null || proposed.high === null) {
    return { available: false, reason: proposed.reason ?? 'Alternative model cost is unavailable.' } as const
  }
  const unchanged = records.every((record) => (currentModel ?? findModelPrice(record.model))?.id === alternative.id)
  // Repeat the priced workload, not its token counts: context tiers apply per call.
  return {
    available: true,
    current: [current.low * runs, current.high * runs],
    alternative: [proposed.low * runs, proposed.high * runs],
    savings: unchanged ? [0, 0] : [(current.low - proposed.high) * runs, (current.high - proposed.low) * runs],
  } as const
}

export function parseTokenInput(value: string) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([km])?$/i)
  if (!match) throw new Error('Use a nonnegative token count, such as 250000, 250k, or 1.5M.')
  const result = Number(match[1]) * ({ k: 1000, m: 1000000 }[match[2]?.toLowerCase() ?? ''] ?? 1)
  return number(result, 'tokens')!
}

export function manualUsage(
  model: string, uncached: number, read: number, write: number, output: number,
  write5m = 0, write1h = 0,
): Usage {
  const input = uncached + read + write + write5m + write1h
  for (const [key, value] of Object.entries({ input, read, write, output, write5m, write1h })) number(value, key)
  return {
    ...emptyTokens, input, read, write, cacheWrite5m: write5m, cacheWrite1h: write1h, output, model: label(model), session: 'manual', identity: null,
    agent: null, at: null, duration: null, nanoAiu: null, multiplier: null, requests: null,
    kind: 'manual', source: 'manual', failed: false,
  }
}

const demoAt = (minute: number) => `2026-10-09T12:${String(minute).padStart(2, '0')}:00Z`
function demoSession() {
  let codexTotal = 0
  return JSON.stringify([
    { type: 'session.start', data: { sessionId: 'copilot-demo' } },
    ...[
      [24000, 0, 18000, 1600, 400, 'claude-sonnet-5.5'],
      [30000, 18000, 6000, 2400, 700, 'claude-sonnet-5.5'],
      [12000, 8000, 0, 1100, 300, 'gpt-6.1-sol'],
    ].map(([inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, reasoningTokens, model], index) => ({
      id: `copilot-demo-${index}`, type: 'assistant.usage', timestamp: demoAt(index * 3),
      data: { model, inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, reasoningTokens },
    })),
    { type: 'tool.execution_complete', data: { toolCallId: 'copilot-tool', toolName: 'bash', success: true } },
    { type: 'session_meta', payload: { id: 'codex-demo' } },
    { type: 'turn_context', payload: { model: 'gpt-5.5' } },
    ...[[18000, 4000, 900, 300], [26000, 17000, 1400, 520], [41000, 25000, 2100, 880], [52000, 39000, 1700, 610]]
      .flatMap(([input, cached, output, reasoning], index) => {
        codexTotal += input + output
        return [
          { type: 'response_item', payload: { type: 'function_call', call_id: `codex-tool-${index}`, name: index % 2 ? 'apply_patch' : 'exec_command' } },
          {
            type: 'event_msg', timestamp: demoAt(10 + index * 3),
            payload: { type: 'token_count', info: {
              total_token_usage: { total_tokens: codexTotal },
              last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning },
            } },
          },
        ]
      }),
    ...[[6000, 0, 22000, 1200], [900, 22000, 4800, 2600], [1200, 26800, 3100, 3400]]
      .map(([input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens], index) => ({
        type: 'assistant', sessionId: 'claude-demo', timestamp: demoAt(24 + index * 4),
        message: {
          id: `claude-demo-${index}`, model: 'claude-opus-5',
          usage: { input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens },
          content: [{ type: 'tool_use', id: `claude-tool-${index}`, name: index === 1 ? 'Edit' : 'Bash' }],
        },
      })),
  ])
}
export const demoEvents = demoSession()
