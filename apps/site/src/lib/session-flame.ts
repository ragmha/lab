export type SpanKind = 'session' | 'prompt' | 'turn' | 'tool' | 'agent' | 'hook' | 'approval' | 'compaction'
export type SpanStatus = 'ok' | 'failed' | 'open'

export interface RawEvent {
  type: string
  timestamp: string
  id?: string
  agentId?: string
  data?: Record<string, unknown>
}

export interface Span {
  id: number
  kind: SpanKind
  key: string
  name: string
  detail: string
  /** Wall-clock milliseconds from the first event. */
  start: number
  end: number
  /** Chart-axis milliseconds, where long idle gaps are collapsed. */
  x0: number
  x1: number
  /** Time this span was the innermost active work, split evenly with parallel work. */
  self: number
  status: SpanStatus
  parent: Span | null
  children: Span[]
  depth: number
  row: number
  facts: [string, string][]
  events: RawEvent[]
}

export interface Marker {
  at: number
  x: number
  tone: 'info' | 'warning' | 'error'
  label: string
  event: RawEvent
}

/** An idle stretch, with no prompt running, drawn as a fixed-width break at axis position `x`. */
export interface Gap {
  start: number
  end: number
  x: number
}

export interface Share {
  key: string
  label: string
  time: number
  spans: number
  failed: number
}

/** Where an event sits in the agent's loop: asked, reasoned, acted, observed the result, answered. */
export type Phase = 'prompt' | 'think' | 'act' | 'observe' | 'reply' | 'system'

export const PHASES: { id: Phase; label: string; hint: string }[] = [
  { id: 'prompt', label: 'Prompt', hint: 'Messages from you, or to a sub-agent' },
  { id: 'think', label: 'Think', hint: 'Model turns, reasoning and tool requests' },
  { id: 'act', label: 'Act', hint: 'Tool calls and sub-agent launches' },
  { id: 'observe', label: 'Observe', hint: 'Results and notifications coming back' },
  { id: 'reply', label: 'Reply', hint: 'Responses written for you' },
  { id: 'system', label: 'System', hint: 'Hooks, approvals, compaction and session bookkeeping' },
]

export interface TimelineEvent {
  at: number
  event: RawEvent
  span: Span
  phase: Phase
}

export interface Session {
  root: Span
  /** Every span, sorted by start time; the root is first. */
  spans: Span[]
  /** Recorded events in timestamp order, preserving file order for ties. */
  timeline: TimelineEvent[]
  markers: Marker[]
  /** Activities ranked by attributed time; their times sum to the session's wall time. */
  shares: Share[]
  /** Spectrum hue per coloured key; neutral keys are absent. */
  hues: Map<string, number>
  rows: number
  /** Wall-clock length in milliseconds. */
  total: number
  /** Axis length in milliseconds once idle gaps are collapsed. */
  length: number
  gaps: Gap[]
  origin: number
  events: number
  skipped: number
  unmatched: number
}

/** Idle stretches longer than this collapse into a break on the axis. */
export const GAP_MIN = 60_000
/** Axis width of each collapsed idle stretch. */
export const GAP_WIDTH = 20_000
/** A prompt still counts as running this long after its last activity, bridging the gaps between turns. */
const RUN_SLACK = 5_000

type Data = Record<string, unknown>

const record = (value: unknown): Data =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}
export const isMainAgentEvent = (event: RawEvent) =>
  !event.agentId && !record(event.data).parentToolCallId && !event.type.startsWith('subagent.')
const text = (value: unknown) => typeof value === 'string' ? value : ''
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined
const figure = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
/** Token counts as 118.4k. */
export const formatTokens = (value: number) => value < 1000 ? String(value) : `${Math.round(value / 100) / 10}k`
const basename = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path

export function excerpt(value: string, max = 90) {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

const DETAIL_KEYS = ['description', 'path', 'pattern', 'query', 'intent', 'url', 'command', 'prompt', 'skill']

export function toolDetail(args: unknown) {
  if (typeof args === 'string') return excerpt(args, 80)
  const values = record(args)
  for (const key of DETAIL_KEYS) {
    const value = text(values[key]).trim()
    if (value) return excerpt(key === 'path' ? basename(value) : value, 80)
  }
  return ''
}

// What a system notification reports, such as a background agent going idle or a shell exiting.
function notification(data: Data) {
  const kind = record(data.kind)
  const who = text(kind.displayName) || text(kind.agentType) || 'agent'
  const description = text(kind.description)
  const about = description ? `: ${description}` : ''
  switch (text(kind.type)) {
    case 'agent_idle':
      return excerpt(`${who} idle${about}`, 80)
    case 'agent_completed':
      return excerpt(`${who} ${text(kind.status) || 'completed'}${about}`, 80)
    case 'shell_completed':
    case 'shell_detached_completed': {
      const code = count(kind.exitCode)
      const what = description || text(kind.shellId)
      return excerpt(`${code === undefined ? 'Shell finished' : `Shell exited ${code}`}${what ? `: ${what}` : ''}`, 80)
    }
    case 'instruction_discovered':
      return excerpt(`Instructions found: ${basename(text(kind.sourcePath))}`, 80)
    default:
      return excerpt(text(data.content), 80)
  }
}

const KEY_LABELS: Record<string, string> = {
  '@session': 'Idle, waiting on you',
  '@prompt': 'Between turns',
  '@turn': 'Model turns',
  '@hook': 'Hooks',
  '@approval': 'Waiting for approval',
  '@compaction': 'Context compaction',
}
export const NEUTRAL_KEYS = new Set(['@session', '@prompt'])
export const keyLabel = (key: string) => KEY_LABELS[key] ?? key

const KIND_LABELS: Record<SpanKind, string> = {
  session: 'Session',
  prompt: 'Prompt',
  turn: 'Model turn',
  tool: 'Tool call',
  agent: 'Sub-agent',
  hook: 'Hook',
  approval: 'Approval',
  compaction: 'Compaction',
}
export const kindLabel = (kind: SpanKind) => KIND_LABELS[kind]

export type Icon = SpanKind | 'reply'

/** Line icons on a 16-unit grid, stroked at 1.5 units: SVG in the page, Path2D on the canvas. */
export const ICONS: Record<Icon, string> = {
  prompt: 'M8 2.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5ZM3 13.5c.5-2.4 2.5-3.8 5-3.8s4.5 1.4 5 3.8',
  turn: 'M8 2c.5 3.2 2.8 5.5 6 6c-3.2.5-5.5 2.8-6 6c-.5-3.2-2.8-5.5-6-6c3.2-.5 5.5-2.8 6-6Z',
  tool: 'M11 2.65L10.5 4.35L11.65 5.5L13.35 5A3.5 3.5 0 1 1 11 2.65ZM7.5 8.5L2.75 13.25',
  agent: 'M4 5.5h8a1.5 1.5 0 0 1 1.5 1.5v4.5a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 4 5.5ZM8 5.5V2.75M6 8.5v1.5M10 8.5v1.5',
  reply: 'M2.5 3h11v7.5H7.5L4.5 13v-2.5h-2Z',
  hook: 'M10 1.75a1.25 1.25 0 1 1 0 2.5a1.25 1.25 0 1 1 0-2.5ZM10 4.25V10a3 3 0 0 1-6 0V7.5l2 2',
  approval: 'M8 2l5 2v3.5c0 3.2-2.1 5.3-5 6.5c-2.9-1.2-5-3.3-5-6.5V4ZM5.75 8l1.5 1.5l3-3',
  compaction: 'M8 1.75V6M6 4l2 2l2-2M8 14.25V10M6 12l2-2l2 2M2.5 8h11',
  session: 'M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11ZM8 5v3l2 1.5',
}

export const iconLabel = (icon: Icon) => icon === 'reply' ? 'Response' : kindLabel(icon)

/** What an event is about: a prompt, an answer, or the kind of work it belongs to. */
export const iconOf = ({ phase, span }: { phase: Phase; span: Span }): Icon =>
  phase === 'prompt' ? 'prompt' : phase === 'reply' ? 'reply' : span.kind

export function spanLabel(span: Span) {
  return `${span.status === 'failed' ? '✕ ' : ''}${span.name}${span.detail ? ` · ${span.detail}` : ''}`
}

export function phaseOf({ type, data }: RawEvent): Phase {
  switch (type) {
    case 'user.message':
      return 'prompt'
    case 'assistant.message':
      return text(record(data).content).trim() ? 'reply' : 'think'
    case 'assistant.turn_start':
    case 'assistant.turn_end':
    case 'assistant.fusion_phase_completed':
      return 'think'
    case 'tool.execution_start':
    case 'subagent.started':
      return 'act'
    case 'tool.execution_complete':
    case 'subagent.completed':
    case 'subagent.failed':
    case 'system.notification':
      return 'observe'
    default:
      return 'system'
  }
}

export function readEvents(input: string): { events: RawEvent[]; skipped: number } {
  const events: RawEvent[] = []
  let skipped = 0
  const accept = (value: unknown) => {
    const event = record(value)
    if (typeof event.type === 'string' && typeof event.timestamp === 'string' && Number.isFinite(Date.parse(event.timestamp))) {
      events.push(event as unknown as RawEvent)
    } else {
      skipped++
    }
  }
  const trimmed = input.trimStart()
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        for (const item of parsed) accept(item)
        return { events, skipped }
      }
    } catch {
      // Not a JSON array; read it as JSON Lines instead.
    }
  }
  for (const line of input.split('\n')) {
    const row = line.trim()
    if (!row) continue
    try {
      accept(JSON.parse(row))
    } catch {
      skipped++
    }
  }
  return { events, skipped }
}

export function parseSession(input: string): Session {
  const { events, skipped } = readEvents(input)
  if (!events.length) throw new Error('No timestamped events found. Choose a Copilot CLI events.jsonl file.')

  const times = events.map((event) => Date.parse(event.timestamp))
  let origin = Infinity
  let last = -Infinity
  for (const time of times) {
    if (time < origin) origin = time
    if (time > last) last = time
  }
  const total = Math.max(1, last - origin)

  const spans: Span[] = []
  const markers: Marker[] = []
  const pending = new Set<Span>()
  const calls = new Map<string, Span>()
  const agents = new Map<string, Span>()
  const agentModels = new Map<Span, string>()
  // Multi-turn sub-agents that went idle, and the write_agent call that last messaged each agent.
  const resting = new Set<string>()
  const messaged = new Map<string, Span>()
  const turns = new Map<string, Span>()
  const hooks = new Map<string, Span>()
  const approvals = new Map<string, Span>()
  const compactions = new Map<string, Span>()
  const tokens = new Map<Span, number>()
  let unmatched = 0
  let model = ''
  let prompt: Span | undefined
  // HydraFusion runs the whole prompt out of band, logging only usage until it commits.
  let fusing = false
  // A notification that arrived while the agent was idle, and may be what wakes it.
  let notice: { at: number; event: RawEvent } | undefined

  const open = (kind: SpanKind, key: string, name: string, detail: string, at: number, parent: Span | null): Span => {
    const span: Span = {
      id: spans.length, kind, key, name, detail, start: at, end: at, x0: 0, x1: 0, self: 0, status: 'open',
      parent, children: [], depth: parent ? parent.depth + 1 : 0, row: 0, facts: [], events: [],
    }
    parent?.children.push(span)
    spans.push(span)
    if (kind === 'session' || kind === 'prompt') span.status = 'ok'
    else pending.add(span)
    return span
  }
  const close = (span: Span, at: number, failed: boolean) => {
    span.end = Math.max(span.end, at)
    if (failed) span.status = 'failed'
    else if (span.status === 'open') span.status = 'ok'
    pending.delete(span)
  }
  const fact = (span: Span, label: string, value: string) => {
    if (!value) return
    const existing = span.facts.find(([name]) => name === label)
    if (existing) existing[1] = value
    else span.facts.push([label, value])
  }
  // Ends a turn that never reported its own end, with any work still open inside it; all stay marked unfinished.
  const settle = (thread: string, at: number) => {
    const turn = turns.get(thread)
    if (!turn) return
    for (const span of pending) {
      for (let node: Span | null = span; node; node = node.parent) {
        if (node !== turn) continue
        span.end = Math.max(span.end, at)
        pending.delete(span)
        break
      }
    }
    for (const [key, value] of turns) if (!pending.has(value)) turns.delete(key)
  }
  // The CLI process stopped, so anything still running stopped with it.
  const halt = (at: number) => {
    for (const span of pending) span.end = Math.max(span.end, at)
    pending.clear()
    turns.clear()
    compactions.clear()
    fusing = false
    for (const id of agents.keys()) resting.add(id)
    notice = undefined
  }
  const promptOf = (span: Span) => {
    let node: Span | null = span
    while (node && node.kind !== 'prompt') node = node.parent
    return node
  }
  // The current prompt is running while its work is open or only just finished.
  const busy = (at: number) => Boolean(prompt) && (fusing || turns.has('') || at - prompt!.end <= RUN_SLACK ||
    [...pending].some((span) => promptOf(span) === prompt))

  const root = open('session', '@session', 'session', '', 0, null)
  let previous = 0

  events.forEach((event, index) => {
    const type = event.type
    const at = times[index] - origin
    const before = previous
    previous = at
    if (type.startsWith('external_tool.')) return
    const data = record(event.data)
    const parentCall = text(data.parentToolCallId)
    const agentId = text(event.agentId)
    let agent = (agentId && agents.get(agentId)) || (parentCall && calls.get(parentCall)) || (agentId && calls.get(agentId)) || undefined
    if (agent && type === 'user.message' && resting.delete(agentId)) {
      // A multi-turn sub-agent got a new message, so this run gets its own span where it was messaged.
      const waker = messaged.get(agentId)
      messaged.delete(agentId)
      const run = open('agent', agent.key, agent.name, excerpt(text(data.content), 80),
        at, waker ?? turns.get('') ?? (prompt && busy(at) ? prompt : root))
      for (const [label, value] of agent.facts) if (label === 'Agent' || label === 'Model') fact(run, label, value)
      const runModel = agentModels.get(agent)
      if (runModel) agentModels.set(run, runModel)
      agents.set(agentId, run)
      agent = run
    }
    const thread = agent ? `#${agent.id}` : agentId
    const host = agent ?? (prompt && busy(at) ? prompt : root)
    const owner = turns.get(thread) ?? host
    // Work on something still open keeps its prompt running; late echoes, session bookkeeping
    // and notifications don't.
    if ((owner.kind === 'prompt' || pending.has(owner)) &&
      !type.startsWith('system.') && (!type.startsWith('session.') || type.startsWith('session.compaction'))) {
      const top = promptOf(owner)
      if (top) top.end = Math.max(top.end, at)
    }
    const mark = (tone: Marker['tone'], label: string) => {
      markers.push({ at, x: 0, tone, label, event })
      owner.events.push(event)
    }

    switch (type) {
      case 'session.start':
      case 'session.resume': {
        const context = record(data.context)
        root.detail ||= text(context.repository) || basename(text(context.cwd))
        model = text(data.selectedModel) || model
        fact(root, 'Session ID', text(data.sessionId))
        fact(root, 'Copilot CLI', text(data.copilotVersion))
        fact(root, 'Branch', text(context.branch))
        if (type === 'session.resume') {
          halt(before)
          markers.push({ at, x: 0, tone: 'info', label: 'Session resumed', event })
        }
        root.events.push(event)
        break
      }
      case 'session.shutdown': {
        halt(at)
        const premium = count(data.totalPremiumRequests)
        const api = count(data.totalApiDurationMs)
        if (premium !== undefined) fact(root, 'Premium requests', figure(premium))
        if (api !== undefined) fact(root, 'API time', formatDuration(api))
        root.events.push(event)
        break
      }
      case 'user.message': {
        if (agentId || parentCall) {
          owner.events.push(event)
          break
        }
        const delivery = text(data.delivery)
        const source = text(data.source)
        // Steering and injected context join the running prompt. Only newer CLIs log `delivery`;
        // without it, a typed message steers only while a turn is open.
        const steering = Boolean(prompt) && delivery !== 'idle' && delivery !== 'queued' &&
          (turns.has('') || (host === prompt && (delivery === 'steering' || source !== '')))
        if (steering) {
          if (source) owner.events.push(event)
          else mark('info', `You: ${excerpt(text(data.content), 60) || 'message'}`)
          break
        }
        settle('', at)
        prompt = open('prompt', '@prompt', source ? source.split('-')[0] : 'prompt', excerpt(text(data.content)), at, root)
        notice = undefined
        prompt.events.push(event)
        break
      }
      case 'assistant.turn_start': {
        settle(thread, at)
        let parent = host
        if (parent === root && !thread) {
          // The agent woke without a new message, usually because a background agent or shell finished.
          const cause = notice && at - notice.at <= GAP_MIN ? notice : undefined
          prompt = open('prompt', '@prompt', cause ? 'notification' : 'prompt',
            cause ? notification(record(cause.event.data)) : 'Continued without a new message', cause?.at ?? at, root)
          if (cause) {
            root.events.splice(root.events.lastIndexOf(cause.event), 1)
            prompt.events.push(cause.event)
          }
          parent = prompt
        }
        if (!thread) notice = undefined
        const turn = open('turn', agent ? agent.key : '@turn', 'model turn', '', at, parent)
        fact(turn, 'Model', (agent && agentModels.get(agent)) || model)
        turns.set(thread, turn)
        turn.events.push(event)
        break
      }
      case 'assistant.turn_end': {
        const turn = turns.get(thread)
        if (!turn) {
          owner.events.push(event)
          break
        }
        turn.events.push(event)
        close(turn, at, false)
        turns.delete(thread)
        break
      }
      case 'assistant.message': {
        owner.events.push(event)
        if (owner.kind !== 'turn') break
        const content = excerpt(text(data.content) || text(data.reasoningText))
        if (content && !owner.detail) owner.detail = content
        fact(owner, 'Model', text(data.model))
        const output = count(data.outputTokens)
        if (output) tokens.set(owner, (tokens.get(owner) ?? 0) + output)
        break
      }
      case 'tool.execution_start': {
        const name = text(data.toolName) || 'tool'
        const span = open('tool', name, name, toolDetail(data.arguments), at, owner)
        const id = text(data.toolCallId)
        if (id) calls.set(id, span)
        const args = record(data.arguments)
        if (text(args.message)) {
          for (const target of [args.agent_id, ...(Array.isArray(args.agent_ids) ? args.agent_ids : [])]) {
            if (text(target)) messaged.set(text(target), span)
          }
        }
        span.events.push(event)
        break
      }
      case 'tool.execution_complete': {
        const span = calls.get(text(data.toolCallId))
        if (!span) {
          unmatched++
          owner.events.push(event)
          break
        }
        span.events.push(event)
        const failed = data.success === false
        if (failed) fact(span, 'Error', excerpt(text(record(data.error).message) || text(data.error) || 'Failed', 240))
        close(span, at, failed)
        break
      }
      case 'subagent.started': {
        const id = text(data.toolCallId)
        let task = calls.get(id)
        if (!task) {
          task = open('agent', 'agent', 'agent', '', at, owner)
          if (id) calls.set(id, task)
        }
        task.kind = 'agent'
        const name = text(data.agentDisplayName) || text(data.agentName)
        if (name) {
          task.name = name
          task.key = name
        }
        task.detail ||= excerpt(text(data.agentDescription), 80)
        fact(task, 'Agent', text(data.agentName))
        const agentModel = text(data.model)
        if (agentModel) {
          agentModels.set(task, agentModel)
          fact(task, 'Model', agentModel)
        }
        if (agentId) agents.set(agentId, task)
        task.events.push(event)
        break
      }
      case 'subagent.completed':
      case 'subagent.failed': {
        const task = calls.get(text(data.toolCallId)) ?? (agentId ? agents.get(agentId) : undefined)
        if (!task) {
          unmatched++
          owner.events.push(event)
          break
        }
        task.events.push(event)
        settle(`#${task.id}`, at)
        const tokenTotal = count(data.totalTokens)
        const toolCalls = count(data.totalToolCalls)
        fact(task, 'Model', text(data.model))
        if (tokenTotal !== undefined) fact(task, 'Tokens', figure(tokenTotal))
        if (toolCalls !== undefined) fact(task, 'Tool calls', figure(toolCalls))
        const failed = type === 'subagent.failed' || data.cancelled === true
        if (data.cancelled === true) fact(task, 'Error', 'Cancelled')
        else if (failed) fact(task, 'Error', excerpt(text(data.error) || text(record(data.error).message) || 'Failed', 240))
        close(task, at, failed)
        break
      }
      case 'hook.start': {
        const span = open('hook', '@hook', text(data.hookType) || 'hook', text(record(data.input).toolName), at, owner)
        const id = text(data.hookInvocationId)
        if (id) hooks.set(id, span)
        span.events.push(event)
        break
      }
      case 'hook.end': {
        const id = text(data.hookInvocationId)
        const span = hooks.get(id)
        if (!span) {
          unmatched++
          owner.events.push(event)
          break
        }
        span.events.push(event)
        close(span, at, data.success === false)
        hooks.delete(id)
        break
      }
      case 'permission.requested': {
        const request = record(data.permissionRequest)
        const parent = calls.get(text(request.toolCallId)) ?? owner
        const span = open('approval', '@approval', 'approval', excerpt(text(request.intention), 80) || text(request.kind), at, parent)
        fact(span, 'Kind', text(request.kind))
        const id = text(data.requestId)
        if (id) approvals.set(id, span)
        span.events.push(event)
        break
      }
      case 'permission.completed': {
        const id = text(data.requestId)
        const span = approvals.get(id)
        if (!span) {
          unmatched++
          owner.events.push(event)
          break
        }
        span.events.push(event)
        const result = text(record(data.result).kind) || text(data.result)
        fact(span, 'Result', result)
        fact(span, 'Decided by', text(data.decisionSource))
        close(span, at, result.startsWith('denied'))
        approvals.delete(id)
        break
      }
      case 'session.compaction_start': {
        const span = open('compaction', '@compaction', 'compaction', text(data.trigger), at, owner)
        compactions.set(thread, span)
        span.events.push(event)
        const current = count(data.currentTokens)
        const limit = count(data.tokenLimit)
        if (current !== undefined) fact(span, 'Context', limit ? `${formatTokens(current)} of ${formatTokens(limit)} tokens` : `${formatTokens(current)} tokens`)
        for (const [key, label] of [['systemTokens', 'System prompt'], ['toolDefinitionsTokens', 'Tool definitions'], ['conversationTokens', 'Conversation']]) {
          const value = count(data[key])
          if (value !== undefined) fact(span, label, `${formatTokens(value)} tokens`)
        }
        break
      }
      case 'session.compaction_complete': {
        const span = compactions.get(thread)
        if (!span) {
          unmatched++
          owner.events.push(event)
          break
        }
        span.events.push(event)
        const pre = count(data.preCompactionTokens)
        const post = count(data.postCompactionTokens)
        if (pre !== undefined && post !== undefined) fact(span, 'Tokens', `${figure(pre)} → ${figure(post)}`)
        const removed = count(data.messagesRemoved)
        if (removed !== undefined) fact(span, 'Messages removed', figure(removed))
        close(span, at, data.success === false)
        compactions.delete(thread)
        break
      }
      case 'session.model_change': {
        const next = text(data.newModel)
        if (!agentId && next) model = next
        mark('info', `Model → ${next || 'unknown'}`)
        break
      }
      case 'session.mode_changed':
        mark('info', `Mode → ${text(data.newMode) || 'unknown'}`)
        break
      case 'session.warning':
        mark('warning', excerpt(text(data.message)) || 'Warning')
        break
      case 'session.error':
        mark('error', excerpt([text(data.errorType), text(data.message)].filter(Boolean).join(': ')) || 'Error')
        break
      case 'system.notification': {
        const kind = record(data.kind)
        const id = text(kind.agentId)
        const run = id ? agents.get(id) : undefined
        if (run && (kind.type === 'agent_idle' || kind.type === 'agent_completed')) {
          settle(`#${run.id}`, at)
          close(run, at, text(kind.status) === 'failed')
          resting.add(id)
        }
        if (!thread && host === root) notice = { at, event }
        owner.events.push(event)
        break
      }
      case 'abort':
        settle(thread, at)
        mark('warning', text(data.reason) ? `Aborted: ${excerpt(text(data.reason), 60)}` : 'Aborted')
        break
      case 'session.task_complete':
        mark(data.success === false ? 'warning' : 'info', data.success === false ? 'Task incomplete' : 'Task complete')
        break
      case 'skill.invoked':
        mark('info', `Skill: ${text(data.name) || 'unknown'}`)
        break
      case 'session.fusion_resolved':
      case 'session.fusion_completed':
        fusing = type === 'session.fusion_resolved'
        owner.events.push(event)
        break
      case 'assistant.fusion_phase_completed': {
        // HydraFusion works out of band and logs each phase only once it ends, with its duration.
        const role = text(data.role) || text(data.phaseKind) || 'phase'
        const name = `Fusion ${role}`
        const span = open('agent', name, name, text(data.model), Math.max(owner.start, at - (count(data.durationMs) ?? 0)), owner)
        const usage = record(data.usage)
        const requests = count(usage.requestCount)
        fact(span, 'Model', text(data.model))
        fact(span, 'Verdict', text(data.verdict))
        if (requests !== undefined) fact(span, 'Model calls', figure(requests))
        close(span, at, Boolean(text(data.status)) && text(data.status) !== 'succeeded')
        span.events.push(event)
        break
      }
      default:
        owner.events.push(event)
    }
  })

  if (spans.length === 1 && !markers.length) {
    throw new Error('No Copilot CLI activity found. Choose an events.jsonl file from ~/.copilot/session-state.')
  }

  for (const span of pending) span.end = Math.max(span.end, total)
  for (const [span, output] of tokens) fact(span, 'Output tokens', figure(output))

  // Prompts and sub-agents grow to cover their whole subtree, since background agents outlive
  // their task call; tools and turns keep their reported times.
  const contain = (span: Span): [number, number] => {
    let low = span.start
    let high = span.end
    for (const child of span.children) {
      const [childLow, childHigh] = contain(child)
      low = Math.min(low, childLow)
      high = Math.max(high, childHigh)
    }
    if (span.kind === 'prompt' || span.kind === 'agent') {
      span.start = low
      span.end = high
    }
    return [low, high]
  }
  const extents = root.children.map(contain).sort((a, b) => a[0] - b[0])
  root.end = total

  const gaps: Gap[] = []
  let removed = 0
  const collapse = (start: number, end: number) => {
    if (end - start <= GAP_MIN) return
    gaps.push({ start, end, x: start - removed })
    removed += end - start - GAP_WIDTH
  }
  let cursor = 0
  for (const [low, high] of extents) {
    collapse(cursor, low)
    cursor = Math.max(cursor, high)
  }
  collapse(cursor, total)
  const axis = { gaps }
  for (const span of spans) {
    span.x0 = axisOf(axis, span.start)
    span.x1 = axisOf(axis, span.end)
  }
  for (const marker of markers) marker.x = axisOf(axis, marker.at)

  const rows = layout(root)
  attribute(spans)
  const byKey = new Map<string, Share>()
  for (const span of spans) {
    const share = byKey.get(span.key) ?? { key: span.key, label: keyLabel(span.key), time: 0, spans: 0, failed: 0 }
    share.time += span.self
    share.spans++
    if (span.status === 'failed') share.failed++
    byKey.set(span.key, share)
  }
  const shares = [...byKey.values()].sort((a, b) => b.time - a.time || a.label.localeCompare(b.label))
  const coloured = shares.filter((share) => !NEUTRAL_KEYS.has(share.key))
  const hues = new Map(coloured.map((share, index) => [
    share.key,
    coloured.length > 1 ? (index * HUE_SPAN) / (coloured.length - 1) : 0,
  ]))

  spans.sort((a, b) => a.start - b.start || a.depth - b.depth)
  const owners = new Map<RawEvent, Span>()
  for (const span of spans) for (const event of span.events) owners.set(event, span)
  const timeline = events.flatMap((event, index) => {
    const span = owners.get(event)
    return span ? [{ at: times[index] - origin, event, span, phase: phaseOf(event) }] : []
  }).sort((a, b) => a.at - b.at)
  return {
    root, spans, timeline, markers, shares, hues, rows, total, length: total - removed, gaps, origin,
    events: events.length, skipped, unmatched,
  }
}

/** Last recorded event at or before the playhead; -1 before the first event. */
export function eventIndexAt(timeline: TimelineEvent[], at: number) {
  let low = 0
  let high = timeline.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (timeline[middle].at <= at) low = middle + 1
    else high = middle
  }
  return low - 1
}

/** Spend elapsed playback time on recorded time, optionally jumping folded idle gaps. */
export function advanceReplay(session: Pick<Session, 'total' | 'gaps'>, at: number, elapsed: number, skipIdle: boolean) {
  let next = Math.max(0, Math.min(session.total, at))
  let remaining = Math.max(0, elapsed)
  if (skipIdle && remaining > 0) {
    for (const gap of session.gaps) {
      if (next >= gap.end) continue
      const before = Math.max(0, gap.start - next)
      if (remaining < before) break
      remaining -= before
      next = gap.end
    }
  }
  return Math.min(session.total, next + remaining)
}

/** Describe only this event's payload, never a span's later response or final status. */
export function replayDetail({ event, span }: TimelineEvent) {
  const data = record(event.data)
  let agent: Span | null = span
  while (agent && agent.kind !== 'agent') agent = agent.parent
  const speaker = agent?.name || (event.agentId ? 'Sub-agent' : 'Assistant')
  const print = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? ''
  const content = (value: unknown) => print(record(value).content ?? value)
  switch (event.type) {
    case 'user.message':
      return {
        title: event.agentId || data.parentToolCallId ? `Message to ${speaker}` : text(data.source) || 'You',
        label: 'Message',
        text: content(data.content ?? data),
      }
    case 'assistant.message': {
      const reasoning = text(data.reasoningText).trim()
      const requests = (Array.isArray(data.toolRequests) ? data.toolRequests : [])
        .map((request) => text(record(request).name)).filter(Boolean)
      const next = requests.length ? `Requested ${requests.join(', ')}` : ''
      if (text(data.content).trim()) return { title: speaker, label: 'Response', text: text(data.content), reasoning }
      if (reasoning) return { title: speaker, label: 'Reasoning', text: next ? `${reasoning}\n\n${next}` : reasoning }
      if (next) return { title: speaker, label: 'Tool requests', text: next }
      return { title: speaker, label: 'Response', text: content(data.content || data) }
    }
    case 'tool.execution_start':
      return { title: `Started ${text(data.toolName) || span.name}`, label: 'Input', text: print(data.arguments ?? data) }
    case 'tool.execution_complete':
      return {
        title: `${data.success === false ? 'Failed' : data.success === true ? 'Finished' : 'Result from'} ${span.name}`,
        label: data.success === false ? 'Error' : 'Output',
        text: content(data.error ?? data.result ?? data),
      }
    case 'assistant.turn_start':
      return { title: `${speaker} started a turn`, label: 'Details', text: 'Waiting for the next recorded response or tool call.' }
    case 'assistant.turn_end':
      return { title: `${speaker} ended a turn`, label: 'Details', text: print(data) }
    default:
      return { title: event.type.replace(/[._]/g, ' '), label: 'Details', text: print(data) }
  }
}

/** One plain-English sentence for what this event means in the agent's loop. */
export function narrate({ event, span }: TimelineEvent) {
  const data = record(event.data)
  // A sub-agent's own launch and result belong to whoever launched it.
  let agent: Span | null = span.kind === 'agent' ? span.parent : span
  while (agent && agent.kind !== 'agent') agent = agent.parent
  const who = agent?.name || 'The model'
  const doer = agent?.name || 'The agent'
  const quote = (value: unknown) => `“${excerpt(text(value).replace(/\s+/g, ' ').trim(), 80)}”`
  const list = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  switch (event.type) {
    case 'user.message':
      if (event.agentId || data.parentToolCallId) return `The main agent briefs ${who}: ${quote(data.content)}`
      return text(data.content).trim() ? `You ask: ${quote(data.content)}` : 'You send a prompt.'
    case 'assistant.turn_start':
      return `${who} starts a turn: it reads everything so far and decides what to do next.`
    case 'assistant.message': {
      const requests = (Array.isArray(data.toolRequests) ? data.toolRequests : [])
        .map((request) => text(record(request).name)).filter(Boolean)
      if (requests.length) return `${who} decides to use ${list([...new Set(requests)])}.`
      if (text(data.content).trim()) return agent ? `${who} writes its report for the main agent.` : 'The model writes the answer you see.'
      return `${who} reasons about the next step.`
    }
    case 'assistant.turn_end':
      return `${who} ends its turn.`
    case 'tool.execution_start':
      if (span.kind === 'agent') return `${who} launches ${span.name}${span.detail ? ` to ${span.detail.charAt(0).toLowerCase()}${span.detail.slice(1)}` : ''}.`
      return `${doer} runs ${span.name}${span.detail ? `: ${span.detail}` : ''}.`
    case 'tool.execution_complete':
      if (span.kind === 'agent') return `${span.name}’s report goes back to ${who === 'The model' ? 'the model' : who}.`
      return data.success === false
        ? `${span.name} fails; the error goes back to the model.`
        : `${span.name} finishes and its result goes back to the model.`
    case 'subagent.started':
      return `${span.name} starts work in its own context.`
    case 'subagent.completed':
      return `${span.name} is done.`
    case 'subagent.failed':
      return `${span.name} fails; the model hears about it.`
    case 'system.notification':
      return 'A notification reaches the model.'
    case 'hook.start':
      return `A ${span.name} hook runs${span.detail ? ` for ${span.detail}` : ''}.`
    case 'hook.end':
      return `The ${span.name} hook finishes.`
    case 'permission.requested':
      return `${doer} asks your permission${span.detail ? `: ${span.detail}` : ''}.`
    case 'permission.completed':
      return 'The permission request is answered.'
    case 'session.compaction_start': {
      const current = count(data.currentTokens)
      const limit = count(data.tokenLimit)
      return current && limit
        ? `The context holds ${formatTokens(current)} of the model’s ${formatTokens(limit)} tokens, so older turns are summarised to make room.`
        : 'The conversation is long, so it is summarised to free up the model’s context.'
    }
    case 'session.compaction_complete': {
      const pre = count(data.preCompactionTokens)
      const post = count(data.postCompactionTokens)
      return pre && post
        ? `Compaction shrinks the context from ${formatTokens(pre)} to ${formatTokens(post)} tokens; the model carries on from the summary.`
        : 'Compaction finishes; the model carries on from the summary.'
    }
    case 'session.model_change':
      return `You switch the model to ${text(data.newModel) || 'another model'}; later turns run on it.`
    case 'session.usage_record': {
      const usage = record(data.usage)
      const input = count(usage.inputTokens)
      const limit = count(usage.maxPromptTokens)
      const took = count(usage.duration)
      return input
        ? `That model call read ${formatTokens(input)} tokens${limit ? ` of its ${formatTokens(limit)} limit` : ''}${took ? ` and took ${formatDuration(took)}` : ''}.`
        : 'The model call is recorded.'
    }
    case 'system.message':
      return 'The CLI puts its system prompt ahead of your words.'
    case 'session.fusion_resolved':
      return text(data.hint) || `${text(data.syntheticModel) || 'HydraFusion'} plans which models handle the request.`
    case 'assistant.fusion_phase_completed': {
      const took = count(data.durationMs)
      const verdict = text(data.verdict)
      return `${span.name} on ${span.detail || 'its model'} finishes${took ? ` after ${formatDuration(took)}` : ''}` +
        (verdict ? ` with the verdict “${verdict}”.` : '. Its tool calls are logged only when the result is committed, so their bars are replays, not live timings.')
    }
    case 'session.fusion_completed':
      return 'HydraFusion commits the result and hands back the answer.'
    case 'session.start':
      return 'The session starts.'
    case 'session.task_complete':
      return 'The agent marks the task complete.'
    case 'session.shutdown':
      return 'The session ends.'
    default:
      return `Bookkeeping: ${event.type.replace(/[._]/g, ' ')}.`
  }
}

/**
 * How often each step of the loop has happened since the prompt that began the current exchange:
 * model turns, tool calls, results and replies, each counted once.
 */
export function loopSoFar(timeline: TimelineEvent[], index: number) {
  const counts = Object.fromEntries(PHASES.map(({ id }) => [id, 0])) as Record<Phase, number>
  for (let at = index; at >= 0; at--) {
    const entry = timeline[at]
    const { type } = entry.event
    // A launch tool call already counts its sub-agent; turn ends and mid-turn messages are part of one turn.
    if (!type.startsWith('subagent.') && (entry.phase !== 'think' || type === 'assistant.turn_start')) counts[entry.phase]++
    if (entry.phase === 'prompt' && !entry.event.agentId && !record(entry.event.data).parentToolCallId) break
  }
  return counts
}

function agentOf(span: Span) {
  for (let node: Span | null = span; node; node = node.parent) {
    if (node.kind === 'agent') return node
  }
  return null
}

/** The model behind the event at index: the last one named by the same agent, or the session's selected model. */
export function modelAt(timeline: TimelineEvent[], index: number) {
  const agent = timeline[index] ? agentOf(timeline[index].span) : null
  for (let at = index; at >= 0; at--) {
    const { event, span } = timeline[at]
    if (agentOf(span) !== agent) continue
    const data = record(event.data)
    const model = text(data.newModel) || text(data.model) || text(data.selectedModel) || text(record(data.usage).model)
    if (model) return model
  }
  return ''
}

export interface ContextReading {
  at: number
  tokens: number
  limit?: number
}

/**
 * The main agent's latest recorded context size at index: the prompt of the last model call when the
 * log has usage records, otherwise the last compaction or shutdown snapshot. It is the last
 * measurement, not an estimate of the current size.
 */
export function contextAt(timeline: TimelineEvent[], index: number): ContextReading | undefined {
  let reading: ContextReading | undefined
  // Shutdown counts tokens its own way, so it would read as a jump after per-call prompt sizes.
  const perCall = timeline.some(({ event }) => isMainAgentEvent(event) && event.type === 'session.usage_record')
  for (let at = index; at >= 0; at--) {
    const { event } = timeline[at]
    if (!isMainAgentEvent(event) || (perCall && event.type === 'session.shutdown')) continue
    const data = record(event.data)
    const isUsageRecord = event.type === 'session.usage_record'
    const usage = isUsageRecord ? record(data.usage) : {}
    const size = isUsageRecord
      ? count(usage.inputTokens)
      : count(data.postCompactionTokens) ?? count(data.currentTokens)
    const limit = isUsageRecord ? count(usage.maxPromptTokens) : count(data.tokenLimit)
    if (!reading && size !== undefined) {
      reading = { at: timeline[at].at, tokens: size, limit }
      if (isUsageRecord) break
    }
    if (reading && !reading.limit && limit) reading.limit = limit
    if (reading?.limit) break
  }
  return reading
}

/** Maps wall-clock milliseconds to the chart axis, squeezing each idle gap to GAP_WIDTH. */
export function axisOf({ gaps }: Pick<Session, 'gaps'>, time: number) {
  let low = 0
  let high = gaps.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (gaps[middle].start < time) low = middle + 1
    else high = middle
  }
  const gap = gaps[low - 1]
  if (!gap) return time
  if (time < gap.end) return gap.x + ((time - gap.start) / (gap.end - gap.start)) * GAP_WIDTH
  return gap.x + GAP_WIDTH + time - gap.end
}

/** Maps a chart-axis position back to wall-clock milliseconds. */
export function timeOf({ gaps }: Pick<Session, 'gaps'>, x: number) {
  let low = 0
  let high = gaps.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (gaps[middle].x < x) low = middle + 1
    else high = middle
  }
  const gap = gaps[low - 1]
  if (!gap) return x
  if (x < gap.x + GAP_WIDTH) return gap.start + ((x - gap.x) / GAP_WIDTH) * (gap.end - gap.start)
  return gap.end + x - gap.x - GAP_WIDTH
}

/** Ruler ticks at round wall-clock times between axis positions `from` and `to`, skipping collapsed gaps. */
export function ticks({ gaps, total, length }: Pick<Session, 'gaps' | 'total' | 'length'>, from: number, to: number, step: number) {
  const marks: { x: number; time: number }[] = []
  let x = 0
  let time = 0
  for (const gap of [...gaps, { start: total, end: total, x: length }]) {
    const offset = time - x
    const last = Math.min(to, gap.x) + offset
    for (let tick = Math.ceil((Math.max(from, x) + offset) / step) * step; tick <= last; tick += step) {
      marks.push({ x: tick - offset, time: tick })
    }
    x = gap.x + GAP_WIDTH
    time = gap.end
  }
  return marks
}

/**
 * Packs each span's children into lanes so spans sharing a row never overlap:
 * a child joins the first lane that ends before its whole subtree begins.
 */
function layout(root: Span): number {
  const low = new Map<Span, number>()
  const high = new Map<Span, number>()
  const height = new Map<Span, number>()
  const lanes = new Map<Span, { end: number; height: number; members: Span[] }[]>()

  const measure = (span: Span) => {
    let start = span.start
    let end = span.end
    for (const child of span.children) {
      measure(child)
      start = Math.min(start, low.get(child)!)
      end = Math.max(end, high.get(child)!)
    }
    low.set(span, start)
    high.set(span, end)
    const ordered = [...span.children].sort((a, b) =>
      low.get(a)! - low.get(b)! || (high.get(b)! - low.get(b)!) - (high.get(a)! - low.get(a)!))
    const packed: { end: number; height: number; members: Span[] }[] = []
    for (const child of ordered) {
      let lane = packed.find((candidate) => candidate.end <= low.get(child)!)
      if (!lane) {
        lane = { end: -Infinity, height: 0, members: [] }
        packed.push(lane)
      }
      lane.end = high.get(child)!
      lane.height = Math.max(lane.height, height.get(child)!)
      lane.members.push(child)
    }
    lanes.set(span, packed)
    height.set(span, 1 + packed.reduce((sum, lane) => sum + lane.height, 0))
  }

  const assign = (span: Span, row: number) => {
    span.row = row
    let next = row + 1
    for (const lane of lanes.get(span)!) {
      for (const member of lane.members) assign(member, next)
      next += lane.height
    }
  }

  measure(root)
  assign(root, 0)
  return height.get(root)!
}

/**
 * Rows for a chart expanded into `focus`: its ancestors stack on top as a trail,
 * then its own subtree keeps its packed layout; everything else is hidden.
 */
export function expandedRows(focus: Span) {
  const rows = new Map<Span, number>()
  for (let span = focus.parent; span; span = span.parent) rows.set(span, span.depth)
  const visit = (span: Span) => {
    rows.set(span, span.row - focus.row + focus.depth)
    span.children.forEach(visit)
  }
  visit(focus)
  return rows
}

/** The deepest span containing both, so expanding into it shows each of them. */
export function commonAncestor(first: Span, second: Span) {
  const path = new Set<Span>()
  for (let span: Span | null = first; span; span = span.parent) path.add(span)
  let span: Span = second
  while (!path.has(span) && span.parent) span = span.parent
  return span
}

/** Splits every moment of wall time evenly across the innermost spans active at that moment. */
function attribute(spans: Span[]) {
  const edges: [number, number, Span][] = []
  for (const span of spans) {
    if (span.end > span.start) edges.push([span.start, 1, span], [span.end, 0, span])
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const active = new Set<Span>()
  let previous = edges.length ? edges[0][0] : 0
  for (const [at, starts, span] of edges) {
    if (at > previous && active.size) {
      const covered = new Set<Span>()
      for (const item of active) {
        for (let parent = item.parent; parent && !covered.has(parent); parent = parent.parent) covered.add(parent)
      }
      const leaves = [...active].filter((item) => !covered.has(item))
      const share = (at - previous) / leaves.length
      for (const leaf of leaves) leaf.self += share
    }
    previous = at
    if (starts) active.add(span)
    else active.delete(span)
  }
}

export const INK = '#111111'
const HUE_SPAN = 280
const SATURATION = 0.85
const FILL_LIGHTNESS = 0.7
const EDGE_LIGHTNESS = 0.3

export function hslHex(hue: number, saturation: number, lightness: number) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const sector = (((hue % 360) + 360) % 360) / 60
  const x = chroma * (1 - Math.abs((sector % 2) - 1))
  const [r, g, b] = sector < 1 ? [chroma, x, 0] : sector < 2 ? [x, chroma, 0] : sector < 3 ? [0, chroma, x]
    : sector < 4 ? [0, x, chroma] : sector < 5 ? [x, 0, chroma] : [chroma, 0, x]
  const m = lightness - chroma / 2
  return `#${[r, g, b].map((value) => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('')}`
}

/** Bar fill for a spectrum hue; dark ink labels stay readable on every hue. */
export const fillColor = (hue: number) => hslHex(hue, SATURATION, FILL_LIGHTNESS)
/** Darker edge of the same hue, separating light bars from a light page. */
export const edgeColor = (hue: number) => hslHex(hue, SATURATION, EDGE_LIGHTNESS)

export function contrastRatio(first: string, second: string) {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((offset) => {
      const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

const pad = (value: number) => String(value).padStart(2, '0')

export function formatDuration(ms: number) {
  if (ms < 999.5) return `${Math.round(ms)} ms`
  const centiseconds = Math.round(ms / 10)
  if (centiseconds < 1000) return `${(centiseconds / 100).toFixed(2)} s`
  const deciseconds = Math.round(ms / 100)
  if (deciseconds < 600) return `${(deciseconds / 10).toFixed(1)} s`
  const seconds = Math.round(ms / 1000)
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`
  const minutes = Math.round(ms / 60000)
  if (minutes < 2880) return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`
  const hours = Math.round(ms / 3600000)
  return `${Math.floor(hours / 24)}d ${pad(hours % 24)}h`
}

/** Elapsed time as m:ss, h:mm:ss or Nd hh:mm:ss, with optional fractional seconds. */
export function clock(ms: number, decimals = 0) {
  const unit = 10 ** decimals
  const ticks = Math.round((Math.max(0, ms) * unit) / 1000)
  const seconds = Math.floor(ticks / unit)
  const tail = decimals ? `.${String(ticks % unit).padStart(decimals, '0')}` : ''
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor(seconds / 3600) % 24
  const minutes = Math.floor(seconds / 60) % 60
  if (days) return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds % 60)}${tail}`
  if (hours) return `${hours}:${pad(minutes)}:${pad(seconds % 60)}${tail}`
  return `${minutes}:${pad(seconds % 60)}${tail}`
}

export const formatOffset = (ms: number) => `+${clock(ms, 2)}`

const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 15e3, 3e4, 6e4, 12e4, 3e5, 6e5, 9e5, 18e5, 36e5]

/** Smallest friendly ruler step that is at least `minimum` milliseconds. */
export function tickStep(minimum: number) {
  return STEPS.find((step) => step >= minimum) ?? Math.ceil(minimum / 36e5) * 36e5
}

const plural = (value: number, noun: string) => `${figure(value)} ${noun}${value === 1 ? '' : 's'}`
const percent = (value: number) => `${Math.round(value * 100)}%`

/** The coverage line and headline, shared by the server-rendered sample and files loaded in the browser. */
export function summarize(session: Session, source: string) {
  const idle = session.shares.find((share) => share.key === '@session')?.time ?? 0
  const active = session.total - idle
  const prompts = session.spans.filter((span) => span.kind === 'prompt').length
  const parts = [
    source,
    `${formatDuration(session.total)} wall clock`,
    `${formatDuration(active)} active`,
    plural(prompts, 'prompt'),
    plural(session.spans.length, 'span'),
  ]
  if (session.skipped) parts.push(`${plural(session.skipped, 'unreadable line')}`)
  if (session.unmatched) parts.push(`${plural(session.unmatched, 'unmatched completion')}`)
  const top = session.shares.find((share) => !NEUTRAL_KEYS.has(share.key) && share.time > 0)
  const lead = `Active for ${formatDuration(active)} of ${formatDuration(session.total)}.`
  return {
    active,
    coverage: parts.join(' · '),
    headline: top && active > 0
      ? `${lead} The largest share went to ${top.label}: ${percent(top.time / active)} of active time.`
      : lead,
  }
}

/** A deterministic Copilot CLI events.jsonl used as the illustrative sample. */
export function demoSession() {
  const origin = Date.parse('2026-03-02T09:14:00.000Z')
  const lines: string[] = []
  let now = 0
  let sequence = 0
  let interactionId = ''
  let agentId = ''
  let model = 'claude-sonnet-5.5'
  const wait = (ms: number) => { now += ms }
  const next = (prefix: string) => `${prefix}-${++sequence}`
  const emit = (type: string, data: Data = {}, topAgent = agentId) => {
    const nested = agentId && !type.startsWith('subagent.')
    lines.push(JSON.stringify({
      type,
      id: `sample-${lines.length + 1}`,
      timestamp: new Date(origin + now).toISOString(),
      ...(topAgent ? { agentId: topAgent } : {}),
      data: nested ? { ...data, parentToolCallId: agentId } : data,
    }))
  }
  const complete = (toolCallId: string, error?: string) =>
    emit('tool.execution_complete', {
      toolCallId, success: !error, model, interactionId,
      ...(error ? { error: { message: error, code: 'failure' } } : { result: { content: 'ok' } }),
    })
  const tool = (toolName: string, args: Data, ms: number, options: { error?: string; approval?: number } = {}) => {
    const toolCallId = next('call')
    emit('tool.execution_start', { toolCallId, toolName, arguments: args })
    if (options.approval) {
      const requestId = next('request')
      wait(120)
      emit('permission.requested', {
        requestId, permissionRequest: { kind: 'write', intention: `Edit ${text(args.path)}`, toolCallId },
      })
      wait(options.approval)
      emit('permission.completed', { requestId, toolCallId, result: { kind: 'approved' }, decisionSource: 'human_response' })
      wait(ms - options.approval - 120)
    } else {
      wait(ms)
    }
    complete(toolCallId, options.error)
  }
  const parallel = (calls: [string, Data, number][]) => {
    const started = calls.map(([toolName, args, ms]) => {
      const toolCallId = next('call')
      emit('tool.execution_start', { toolCallId, toolName, arguments: args })
      return { toolCallId, ms }
    })
    let elapsed = 0
    for (const call of started.sort((a, b) => a.ms - b.ms)) {
      wait(call.ms - elapsed)
      elapsed = call.ms
      complete(call.toolCallId)
    }
  }
  const turn = (think: number, content: string, outputTokens: number, work?: () => void) => {
    const turnId = next('turn')
    emit('assistant.turn_start', { interactionId, turnId })
    wait(think)
    // Turns that go on to call tools think aloud; the rest reply.
    const said = work ? { content: '', reasoningText: content } : { content }
    emit('assistant.message', { messageId: next('message'), ...said, model, outputTokens, interactionId })
    work?.()
    wait(150)
    emit('assistant.turn_end', { turnId })
    wait(60)
  }
  const hook = (hookType: string, ms: number, toolName: string) => {
    const hookInvocationId = next('hook')
    emit('hook.start', { hookInvocationId, hookType, input: { toolName } })
    wait(ms)
    emit('hook.end', { hookInvocationId, hookType, success: true })
  }
  const agent = (description: string, work: () => void) => {
    const toolCallId = next('call')
    const began = now
    const identity = { toolCallId, agentName: 'explore', agentDisplayName: 'Explore Agent' }
    emit('tool.execution_start', { toolCallId, toolName: 'task', arguments: { description, agent_type: 'explore' } })
    wait(80)
    emit('subagent.started', { ...identity, agentDescription: 'Fast codebase exploration', model: 'claude-haiku-5.5' }, toolCallId)
    const outer = model
    model = 'claude-haiku-5.5'
    agentId = toolCallId
    work()
    agentId = ''
    emit('subagent.completed', {
      ...identity, model, totalTokens: 41_200, totalToolCalls: 4, durationMs: now - began,
    }, toolCallId)
    model = outer
    wait(60)
    complete(toolCallId)
  }
  const prompt = (content: string, work: () => void) => {
    interactionId = next('interaction')
    emit('user.message', { content, interactionId })
    wait(400)
    work()
    emit('session.task_complete', { success: true })
  }

  emit('session.start', {
    sessionId: 'sample-session', copilotVersion: '1.0.94', selectedModel: model,
    context: { repository: 'example/todomvc', branch: 'main', cwd: '/work/todomvc' },
  })
  wait(1800)
  prompt('Build a TodoMVC app where I can add, complete and delete todos', () => {
    turn(3100, 'Checking what the starter project has.', 180, () => parallel([
      ['view', { path: 'package.json' }, 40],
      ['glob', { pattern: 'src/**/*' }, 120],
      ['grep', { pattern: 'todo' }, 350],
    ]))
    turn(2400, 'Mapping the starter files before writing anything.', 240, () => agent('Map the starter project', () => {
      turn(3300, 'Looking for the TodoMVC markup.', 90, () => tool('grep', { pattern: 'class="todoapp"' }, 610))
      turn(4100, 'Reading the page and its entry script.', 120, () => parallel([
        ['view', { path: 'index.html' }, 50],
        ['view', { path: 'src/main.ts' }, 40],
      ]))
      turn(5200, 'Checking for existing tests.', 80, () => tool('grep', { pattern: 'describe\\(' }, 420))
      turn(6900, 'index.html has the TodoMVC markup and tests/todos.test.ts specifies the behaviour; src/todos.ts does not exist yet.', 410)
    }))
    turn(6800, 'Writing the todo store and wiring it to the page.', 1650, () => {
      tool('create', { path: 'src/todos.ts' }, 30)
      tool('edit', { path: 'src/main.ts' }, 50)
    })
    turn(2200, 'Running the tests.', 60, () => {
      hook('preToolUse', 280, 'bash')
      tool('bash', { description: 'Run unit tests', command: 'bun test' }, 7900, {
        error: '1 failing test: expected "1 item left", received "1 items left"',
      })
      hook('postToolUseFailure', 40, 'bash')
    })
    turn(4600, 'Fixing the plural in the item counter, then running the tests again.', 420, () => {
      tool('edit', { path: 'src/todos.ts' }, 40)
      hook('preToolUse', 260, 'bash')
      tool('bash', { description: 'Run unit tests', command: 'bun test' }, 6300)
      hook('postToolUse', 30, 'bash')
    })
    turn(3900, 'TodoMVC is built: you can add, complete and delete todos, and the tests pass.', 310)
  })
  wait(95_000)
  emit('session.model_change', { previousModel: model, newModel: 'gpt-6.1-sol', reasoningEffort: 'medium' })
  model = 'gpt-6.1-sol'
  wait(21_000)
  prompt('Add All, Active and Completed filters', () => {
    turn(2800, 'Reading the entry script.', 90, () => tool('view', { path: 'src/main.ts' }, 40))
    turn(3500, 'Adding the filter links and routing on the URL hash.', 520, () =>
      tool('edit', { path: 'src/main.ts' }, 6400, { approval: 6200 }))
    turn(2600, 'Running the tests.', 60, () => tool('bash', { description: 'Run unit tests', command: 'bun test' }, 5800))
    turn(3100, 'Added All, Active and Completed filters; the tests pass.', 240)
  })
  wait(140_000)
  emit('session.warning', { warningType: 'context', message: 'Context is 81% full; older turns will be summarized.' })
  wait(18_000)
  prompt('Run the production build and fix any type errors', () => {
    emit('session.compaction_start', {
      trigger: 'threshold', currentTokens: 118_400, tokenLimit: 128_000,
      systemTokens: 14_600, toolDefinitionsTokens: 26_400, conversationTokens: 77_400,
    })
    wait(8400)
    emit('session.compaction_complete', {
      success: true, preCompactionTokens: 118_400, postCompactionTokens: 49_800, messagesRemoved: 46, tokenLimit: 128_000,
    })
    turn(2900, 'Running the production build.', 70, () =>
      tool('bash', { description: 'Production build', command: 'bun run build' }, 48_000))
    turn(3300, 'The build passes with no type errors; nothing to fix.', 190)
  })
  wait(2000)
  emit('session.shutdown', {
    shutdownType: 'routine', totalPremiumRequests: 3, totalApiDurationMs: 60_700,
    currentTokens: 52_600, systemTokens: 14_600, toolDefinitionsTokens: 26_400, conversationTokens: 11_600,
  })
  return lines.join('\n')
}
