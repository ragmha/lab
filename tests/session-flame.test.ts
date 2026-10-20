import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  GAP_WIDTH, INK, advanceReplay, axisOf, clock, contrastRatio, demoSession, edgeColor, eventIndexAt, fillColor, formatDuration, parseSession,
  readEvents, replayDetail, narrate, loopSoFar, modelAt, contextAt, summarize, tickStep, ticks, timeOf, iconOf, expandedRows, commonAncestor, spanLabel,
} from '../src/lib/session-flame'
import type { Session, Span, SpanKind } from '../src/lib/session-flame'

const T0 = Date.parse('2026-01-05T09:00:00.000Z')
const HOUR = 3_600_000

type Row = [at: number, type: string, data?: Record<string, unknown>, agentId?: string]

const log = (rows: Row[]) => rows.map(([at, type, data = {}, agentId]) =>
  JSON.stringify({ type, timestamp: new Date(T0 + at).toISOString(), ...(agentId ? { agentId } : {}), data })).join('\n')

const all = (session: Session, kind: SpanKind, name?: string) =>
  session.spans.filter((span) => span.kind === kind && (name === undefined || span.name === name))

const one = (session: Session, kind: SpanKind, name?: string) => {
  const found = all(session, kind, name)
  assert.equal(found.length, 1, `expected one ${kind} ${name ?? ''}`)
  return found[0]
}

const factOf = (span: Span, label: string) => span.facts.find(([name]) => name === label)?.[1]

// Every event lands in one span, shares add up to wall time, rows never overlap and no span crosses a collapsed gap.
function assertSound(session: Session, external = 0) {
  assert.equal(session.spans.reduce((sum, span) => sum + span.events.length, 0), session.events - external)
  const shared = session.shares.reduce((sum, share) => sum + share.time, 0)
  assert.ok(Math.abs(shared - session.total) < 1e-6, `shares ${shared} != total ${session.total}`)
  const rows = new Map<number, Span[]>()
  for (const span of session.spans) rows.set(span.row, [...(rows.get(span.row) ?? []), span])
  for (const lane of rows.values()) {
    lane.sort((a, b) => a.start - b.start || a.end - b.end)
    for (let index = 1; index < lane.length; index++) {
      assert.ok(lane[index].start >= lane[index - 1].end, `row ${lane[index].row} overlaps at ${lane[index].start}`)
    }
  }
  for (const span of session.spans) {
    if (span === session.root) continue
    for (const gap of session.gaps) {
      assert.ok(span.end <= gap.start || span.start >= gap.end, `${span.name} crosses the gap at ${gap.start}`)
    }
  }
}

describe('session flame parsing', () => {
  test('builds the illustrative sample', () => {
    const session = parseSession(demoSession())
    assertSound(session)
    assert.equal(session.total, 428_200)
    assert.equal(session.gaps.length, 2)
    assert.deepEqual(all(session, 'prompt').map((span) => span.detail), [
      'Build a TodoMVC app where I can add, complete and delete todos',
      'Add All, Active and Completed filters',
      'Run the production build and fix any type errors',
    ])

    const agent = one(session, 'agent')
    assert.equal(agent.name, 'Explore Agent')
    assert.equal(agent.children.filter((span) => span.kind === 'turn').length, 4)

    const failed = all(session, 'tool', 'bash').filter((span) => span.status === 'failed')
    assert.equal(failed.length, 1)
    assert.deepEqual([failed[0].start, failed[0].end], [39_600, 47_500])
    assert.match(factOf(failed[0], 'Error') ?? '', /1 failing test/)

    assert.equal(one(session, 'approval').parent?.name, 'edit')
    assert.equal(one(session, 'compaction').parent?.detail, 'Run the production build and fix any type errors')
    assert.equal(session.markers.length, 5)
    assert.equal(session.markers.filter((marker) => marker.label === 'Task complete').length, 3)
    assert.equal(factOf(session.root, 'Premium requests'), '3')
    assert.equal(factOf(session.root, 'API time'), '1m 01s')
    assert.equal(session.hues.get('bash'), 0)
    assert.equal(session.shares[0].key, '@session')
  })

  test('nests a sub-agent under its task call without closing the main turn', () => {
    const session = parseSession(log([
      [0, 'session.start', { selectedModel: 'claude-sonnet-5.5' }],
      [1000, 'user.message', { content: 'Map the routes' }],
      [1100, 'assistant.turn_start', { turnId: '0' }],
      [1200, 'tool.execution_start', { toolCallId: 'c1', toolName: 'task', arguments: { description: 'Map routes' } }],
      [1300, 'subagent.started', {
        toolCallId: 'c1', agentName: 'explore', agentDisplayName: 'Explore Agent', model: 'claude-haiku-5.5',
      }, 'a1'],
      [1400, 'assistant.turn_start', { turnId: '0' }, 'a1'],
      [1500, 'tool.execution_start', { toolCallId: 'c2', toolName: 'grep', arguments: { pattern: 'route' } }, 'a1'],
      [1550, 'tool.execution_start', { toolCallId: 'c3', toolName: 'glob', arguments: { pattern: '**/*.ts' } }, 'a1'],
      [1700, 'tool.execution_complete', { toolCallId: 'c3', success: true }, 'a1'],
      [1800, 'tool.execution_complete', { toolCallId: 'c2', success: true }, 'a1'],
      [1900, 'assistant.turn_end', { turnId: '0' }, 'a1'],
      [2000, 'subagent.completed', { toolCallId: 'c1', totalTokens: 1200, totalToolCalls: 2 }, 'a1'],
      [2100, 'tool.execution_complete', { toolCallId: 'c1', success: true }],
      [2200, 'assistant.turn_end', { turnId: '0' }],
    ]))
    assertSound(session)
    const agent = one(session, 'agent', 'Explore Agent')
    const [main, inner] = all(session, 'turn')
    assert.equal(agent.detail, 'Map routes')
    assert.equal(agent.parent, main)
    assert.equal(factOf(agent, 'Tokens'), '1,200')
    assert.deepEqual([main.end, main.status], [2200, 'ok'])
    assert.equal(inner.parent, agent)
    assert.equal(factOf(inner, 'Model'), 'claude-haiku-5.5')
    const grep = one(session, 'tool', 'grep')
    const glob = one(session, 'tool', 'glob')
    assert.equal(grep.parent, inner)
    assert.notEqual(grep.row, glob.row)
  })

  test('marks failures, denied approvals and unfinished work', () => {
    const session = parseSession(log([
      [0, 'session.start'],
      [1000, 'user.message', { content: 'Edit the layout' }],
      [1100, 'assistant.turn_start', { turnId: '0' }],
      [1200, 'tool.execution_start', { toolCallId: 'c1', toolName: 'edit', arguments: { path: '/site/src/Layout.astro' } }],
      [1300, 'permission.requested', {
        requestId: 'r1', permissionRequest: { kind: 'write', intention: 'Edit Layout.astro', toolCallId: 'c1' },
      }],
      [4300, 'permission.completed', { requestId: 'r1', result: { kind: 'denied-interactively-by-user' } }],
      [4400, 'tool.execution_complete', { toolCallId: 'c1', success: false, error: { message: 'Permission denied' } }],
      [4500, 'tool.execution_start', { toolCallId: 'c2', toolName: 'bash', arguments: { command: 'bun test' } }],
      [9000, 'assistant.message', { content: 'Still running.' }],
    ]))
    assertSound(session)
    const edit = one(session, 'tool', 'edit')
    assert.equal(edit.detail, 'Layout.astro')
    assert.equal(edit.status, 'failed')
    assert.equal(factOf(edit, 'Error'), 'Permission denied')
    const approval = one(session, 'approval')
    assert.equal(approval.parent, edit)
    assert.equal(approval.status, 'failed')
    const bash = one(session, 'tool', 'bash')
    assert.deepEqual([bash.status, bash.end], ['open', session.total])
  })

  test('joins steering to the running prompt and starts a new one for idle or queued messages', () => {
    const session = parseSession(log([
      [0, 'session.start'],
      [1000, 'user.message', { content: 'Fix the bug' }],
      [1100, 'assistant.turn_start', { turnId: '0' }],
      [1600, 'user.message', { content: 'also check the tests' }],
      [1800, 'assistant.turn_end', { turnId: '0' }],
      [1900, 'user.message', { content: 'and lint', delivery: 'steering' }],
      [2000, 'assistant.turn_start', { turnId: '1' }],
      [2100, 'assistant.turn_end', { turnId: '1' }],
      [2200, 'user.message', { content: 'Then update the docs', delivery: 'queued' }],
      [2300, 'assistant.turn_start', { turnId: '0' }],
      [2400, 'assistant.turn_end', { turnId: '0' }],
      [2500, 'user.message', { content: 'Ship it', delivery: 'idle' }],
      [2600, 'assistant.turn_start', { turnId: '0' }],
      [2700, 'assistant.turn_end', { turnId: '0' }],
    ]))
    assertSound(session)
    assert.deepEqual(all(session, 'prompt').map((span) => span.detail), ['Fix the bug', 'Then update the docs', 'Ship it'])
    assert.deepEqual(session.markers.map((marker) => marker.label), ['You: also check the tests', 'You: and lint'])
  })

  test('ends aborted work at the abort and keeps prompts with a reused interaction apart', () => {
    const session = parseSession(log([
      [0, 'session.start'],
      [1000, 'user.message', { content: 'Run the tests', interactionId: 'i1' }],
      [1100, 'assistant.turn_start', { turnId: '0', interactionId: 'i1' }],
      [1200, 'tool.execution_start', { toolCallId: 'c1', toolName: 'bash', arguments: { command: 'bun test' } }],
      [5000, 'abort', { reason: 'user initiated' }],
      [2 * HOUR, 'user.message', { content: 'Try again', interactionId: 'i1' }],
      [2 * HOUR + 100, 'assistant.turn_start', { turnId: '0', interactionId: 'i1' }],
      [2 * HOUR + 500, 'assistant.turn_end', { turnId: '0' }],
    ]))
    assertSound(session)
    const bash = one(session, 'tool', 'bash')
    assert.deepEqual([bash.end, bash.status], [5000, 'open'])
    assert.deepEqual(all(session, 'prompt').map((span) => [span.start, span.end]), [[1000, 5000], [2 * HOUR, 2 * HOUR + 500]])
    assert.equal(session.gaps.length, 1)
    assert.ok(session.markers.some((marker) => marker.label === 'Aborted: user initiated'))
  })

  test('starts a notification prompt when a notification wakes the idle agent', () => {
    const session = parseSession(log([
      [0, 'session.start'],
      [1000, 'user.message', { content: 'Start the build in the background' }],
      [1100, 'assistant.turn_start', { turnId: '0' }],
      [1500, 'assistant.turn_end', { turnId: '0' }],
      [10 * 60_000, 'system.notification', {
        content: '<system_notification>Shell build completed</system_notification>',
        kind: { type: 'shell_completed', shellId: 'build', exitCode: 0, description: 'Production build' },
      }],
      [10 * 60_000 + 50, 'assistant.turn_start', { turnId: '0' }],
      [10 * 60_000 + 900, 'assistant.turn_end', { turnId: '0' }],
      [20 * 60_000, 'assistant.turn_start', { turnId: '0' }],
      [20 * 60_000 + 400, 'assistant.turn_end', { turnId: '0' }],
    ]))
    assertSound(session)
    const [, woken, continued] = all(session, 'prompt')
    assert.deepEqual([woken.name, woken.detail, woken.start], ['notification', 'Shell exited 0: Production build', 10 * 60_000])
    assert.equal(woken.events[0].type, 'system.notification')
    assert.deepEqual([continued.name, continued.detail], ['prompt', 'Continued without a new message'])
  })

  test('gives each run of a multi-turn background agent its own span', () => {
    const session = parseSession(log([
      [0, 'session.start'],
      [1000, 'user.message', { content: 'Explore in the background' }],
      [1100, 'assistant.turn_start', { turnId: '0' }],
      [1200, 'tool.execution_start', { toolCallId: 'c1', toolName: 'task', arguments: { description: 'Map routes', mode: 'background' } }],
      [1300, 'subagent.started', { toolCallId: 'c1', agentName: 'explore', agentDisplayName: 'Explore Agent' }, 'a1'],
      [1350, 'tool.execution_complete', { toolCallId: 'c1', success: true }],
      [1400, 'assistant.turn_end', { turnId: '0' }],
      [1500, 'assistant.turn_start', { turnId: '0' }, 'a1'],
      [30_000, 'assistant.turn_end', { turnId: '0' }, 'a1'],
      [30_100, 'system.notification', { kind: { type: 'agent_idle', agentId: 'a1', displayName: 'Explore Agent' } }],
      [HOUR, 'user.message', { content: 'Ask the explorer for more', delivery: 'idle' }],
      [HOUR + 100, 'assistant.turn_start', { turnId: '0' }],
      [HOUR + 200, 'tool.execution_start', {
        toolCallId: 'c2', toolName: 'write_agent', arguments: { agent_ids: ['a1'], message: 'Also map the layouts' },
      }],
      [HOUR + 300, 'user.message', { content: 'Also map the layouts' }, 'a1'],
      [HOUR + 400, 'tool.execution_complete', { toolCallId: 'c2', success: true }],
      [HOUR + 500, 'assistant.turn_end', { turnId: '0' }],
      [HOUR + 600, 'assistant.turn_start', { turnId: '0' }, 'a1'],
      [HOUR + 30_000, 'assistant.turn_end', { turnId: '0' }, 'a1'],
      [HOUR + 30_100, 'system.notification', { kind: { type: 'agent_idle', agentId: 'a1', displayName: 'Explore Agent' } }],
      [HOUR + 30_150, 'assistant.turn_start', { turnId: '0' }],
      [HOUR + 30_200, 'tool.execution_start', { toolCallId: 'c3', toolName: 'read_agent', arguments: { agent_id: 'a1' } }],
      [HOUR + 30_300, 'tool.execution_complete', { toolCallId: 'c3', success: true }],
      [HOUR + 31_000, 'assistant.turn_end', { turnId: '0' }],
      [3 * HOUR, 'abort', { reason: 'subagent_cancelled' }, 'a1'],
      [3 * HOUR + 10, 'external_tool.requested', { toolName: 'mcp' }],
    ]))
    assertSound(session, 1)
    const [first, second] = all(session, 'agent', 'Explore Agent')
    assert.equal(all(session, 'agent').length, 2)
    assert.deepEqual([first.start, first.end], [1200, 30_100])
    assert.equal(second.parent?.name, 'write_agent')
    assert.deepEqual([second.detail, second.start, second.end], ['Also map the layouts', HOUR + 300, HOUR + 30_100])
    assert.deepEqual(all(session, 'prompt').map((span) => [span.start, span.end]), [[1000, 30_100], [HOUR, HOUR + 31_000]])
    assert.ok(session.shares.find((share) => share.key === '@session')!.time > HOUR)
  })

  test('ends stale work when the session resumes', () => {
    const session = parseSession(log([
      [0, 'session.start'],
      [1000, 'user.message', { content: 'Long task' }],
      [1100, 'assistant.turn_start', { turnId: '0' }],
      [1200, 'tool.execution_start', { toolCallId: 'c1', toolName: 'bash', arguments: { command: 'sleep 9999' } }],
      [2 * HOUR, 'session.resume', {}],
      [2 * HOUR + 1000, 'user.message', { content: 'Continue' }],
      [2 * HOUR + 1100, 'assistant.turn_start', { turnId: '0' }],
      [2 * HOUR + 1500, 'assistant.turn_end', { turnId: '0' }],
    ]))
    assertSound(session)
    const bash = one(session, 'tool', 'bash')
    assert.deepEqual([bash.end, bash.status], [1200, 'open'])
    assert.equal(all(session, 'prompt').length, 2)
    assert.ok(session.markers.some((marker) => marker.label === 'Session resumed'))
  })

  test('reads JSON Lines and arrays, counting what it skips', () => {
    const line = JSON.stringify({ type: 'session.start', timestamp: '2026-01-05T09:00:00Z' })
    assert.deepEqual(readEvents([line, 'not json', '{"type":"x"}', ''].join('\n')).skipped, 2)
    const array = readEvents(`[${line}, 5]`)
    assert.deepEqual([array.events.length, array.skipped], [1, 1])
    assert.throws(() => parseSession(''), /No timestamped events/)
    assert.throws(() => parseSession(line), /No Copilot CLI activity/)
  })
})

describe('session flame axis', () => {
  const session = parseSession(demoSession())

  test('collapses idle gaps and maps times both ways', () => {
    const [gap] = session.gaps
    assert.equal(axisOf(session, gap.end), gap.x + GAP_WIDTH)
    assert.equal(axisOf(session, session.total), session.length)
    for (const time of [0, 1000, 63_240, 100_000, 179_300, 300_000, 428_200]) {
      assert.ok(Math.abs(timeOf(session, axisOf(session, time)) - time) < 1e-6)
    }
  })

  test('places ruler ticks outside collapsed gaps', () => {
    const marks = ticks(session, 0, session.length, 30_000)
    assert.ok(marks.length > 3)
    for (const mark of marks) {
      assert.ok(session.gaps.every((gap) => mark.time <= gap.start || mark.time >= gap.end))
      assert.ok(Math.abs(mark.x - axisOf(session, mark.time)) < 1e-6)
    }
  })
})

describe('session replay', () => {
  test('retains exact event payloads and file ordering at simultaneous timestamps', () => {
    const session = parseSession(log([
      [0, 'session.start'],
      [1000, 'user.message', { content: 'Read both files' }],
      [1100, 'assistant.turn_start'],
      [1200, 'tool.execution_start', { toolCallId: 'a', toolName: 'view', arguments: { path: 'a.ts' } }],
      [1200, 'tool.execution_start', { toolCallId: 'b', toolName: 'view', arguments: { path: 'b.ts' } }],
      [1300, 'tool.execution_complete', { toolCallId: 'b', success: true, result: { content: 'b contents' } }],
      [1400, 'tool.execution_complete', { toolCallId: 'a', success: false, error: { message: 'Not found' } }],
      [1500, 'assistant.message', { content: 'Only b.ts exists.' }],
      [1600, 'assistant.turn_end'],
    ]))
    assert.equal(session.timeline.length, session.events)
    assert.deepEqual(session.timeline.filter((item) => item.at === 1200).map((item) => item.event.data?.toolCallId), ['a', 'b'])
    assert.equal(eventIndexAt(session.timeline, -1), -1)
    assert.equal(eventIndexAt(session.timeline, 1199), 2)
    assert.equal(eventIndexAt(session.timeline, 1200), 4)
    assert.equal(eventIndexAt(session.timeline, Infinity), 8)
    assert.equal(eventIndexAt([], 0), -1)
    for (const entry of session.timeline) assert.ok(entry.span.events.includes(entry.event))

    assert.equal(replayDetail(session.timeline[1]).text, 'Read both files')
    assert.equal(replayDetail(session.timeline[2]).text, 'Waiting for the next recorded response or tool call.')
    assert.equal(replayDetail(session.timeline[3]).title, 'Started view')
    assert.deepEqual(JSON.parse(replayDetail(session.timeline[3]).text), { path: 'a.ts' })
    assert.equal(replayDetail(session.timeline[5]).text, 'b contents')
    assert.equal(replayDetail(session.timeline[6]).title, 'Failed view')
    assert.match(replayDetail(session.timeline[6]).text, /Not found/)
    assert.equal(replayDetail(session.timeline[7]).text, 'Only b.ts exists.')
    assert.ok(!replayDetail(session.timeline[2]).text.includes('Only b.ts exists.'))
  })

  test('sorts replay timestamps without changing equal-time event order', () => {
    const session = parseSession(log([
      [0, 'session.start'],
      [1000, 'user.message', { content: 'Hello' }],
      [2000, 'system.notification', { content: 'Later' }],
      [1500, 'system.notification', { content: 'Earlier' }],
    ]))
    assert.deepEqual(session.timeline.map((entry) => entry.at), [0, 1000, 1500, 2000])
  })

  test('identifies sub-agent responses without treating them as the user', () => {
    const session = parseSession(demoSession())
    const entry = session.timeline.find(({ event }) => event.type === 'assistant.message' && event.agentId && event.data?.content)
    assert.ok(entry)
    assert.equal(replayDetail(entry).title, 'Explore Agent')
    assert.equal(replayDetail(entry).text, entry.event.data?.content)
  })

  test('sorts every event into a phase of the agent loop', () => {
    const session = parseSession(log([
      [0, 'session.start'],
      [100, 'user.message', { content: 'Fix it' }],
      [200, 'assistant.turn_start', { turnId: 't1' }],
      [300, 'assistant.message', { content: '', reasoningText: 'Read the file first' }],
      [400, 'tool.execution_start', { toolCallId: 'c1', toolName: 'view' }],
      [500, 'tool.execution_complete', { toolCallId: 'c1', success: true }],
      [600, 'assistant.message', { content: 'Fixed.' }],
      [700, 'assistant.turn_end', { turnId: 't1' }],
      [800, 'hook.start', { hookInvocationId: 'h1', hookType: 'postToolUse' }],
    ]))
    assert.deepEqual(session.timeline.map((entry) => entry.phase),
      ['system', 'prompt', 'think', 'think', 'act', 'observe', 'reply', 'think', 'system'])
    assert.deepEqual(session.timeline.map(iconOf),
      ['session', 'prompt', 'turn', 'turn', 'tool', 'tool', 'reply', 'turn', 'hook'])
    assert.ok(all(session, 'turn').every((span) => span.detail === 'Read the file first'))
  })

  test('narrates each step and counts the loop since the last prompt', () => {
    const session = parseSession(log([
      [100, 'user.message', { content: 'Fix it' }],
      [200, 'assistant.turn_start', { turnId: 't1' }],
      [300, 'assistant.message', { content: '', toolRequests: [{ toolCallId: 'c1', name: 'view' }] }],
      [400, 'tool.execution_start', { toolCallId: 'c1', toolName: 'view', arguments: { path: 'src/a.ts' } }],
      [500, 'tool.execution_complete', { toolCallId: 'c1', success: false }],
      [600, 'assistant.message', { content: 'Fixed.' }],
      [700, 'assistant.turn_end', { turnId: 't1' }],
      [800, 'user.message', { content: 'Thanks' }],
    ]))
    const lines = session.timeline.map(narrate)
    assert.equal(lines[0], 'You ask: “Fix it”')
    assert.match(lines[2], /decides to use view/)
    assert.match(lines[3], /^The agent runs view/)
    assert.match(lines[4], /fails; the error goes back to the model/)
    assert.equal(lines[5], 'The model writes the answer you see.')
    assert.deepEqual(loopSoFar(session.timeline, 6), { prompt: 1, think: 1, act: 1, observe: 1, reply: 1, system: 0 })
    assert.deepEqual(loopSoFar(session.timeline, 7), { prompt: 1, think: 0, act: 0, observe: 0, reply: 0, system: 0 })
  })

  test('reads the model and the last measured context size at each event', () => {
    const session = parseSession(log([
      [0, 'session.start', { selectedModel: 'model-a' }],
      [100, 'user.message', { content: 'Go' }],
      [200, 'subagent.started', { toolCallId: 'c1', agentName: 'explore', model: 'model-b' }, 'a1'],
      [300, 'session.model_change', { newModel: 'model-c' }],
      [400, 'session.compaction_start', { currentTokens: 90_000, tokenLimit: 100_000 }],
      [500, 'session.compaction_complete', { preCompactionTokens: 90_000, postCompactionTokens: 30_000 }],
      [600, 'session.shutdown', { currentTokens: 41_000 }],
    ]))
    const { timeline } = session
    assert.deepEqual(timeline.map((_, index) => modelAt(timeline, index)), ['model-a', 'model-a', 'model-b', 'model-c', 'model-c', 'model-c', 'model-c'])
    assert.equal(contextAt(timeline, 3), undefined)
    assert.deepEqual(contextAt(timeline, 4), { at: 400, tokens: 90_000, limit: 100_000 })
    assert.deepEqual(contextAt(timeline, 5), { at: 500, tokens: 30_000, limit: 100_000 })
    assert.deepEqual(contextAt(timeline, 6), { at: 600, tokens: 41_000, limit: 100_000 })
    assert.match(narrate(timeline[4]), /holds 90k of the model’s 100k tokens/)
    assert.match(narrate(timeline[5]), /from 90k to 30k tokens/)
  })

  test('reads each model call’s prompt against its limit when the log has usage records', () => {
    const { timeline } = parseSession(log([
      [0, 'user.message', { content: 'Go' }],
      [100, 'session.usage_record', { usage: { inputTokens: 20_000, maxPromptTokens: 200_000, duration: 1500 } }],
      [200, 'session.usage_record', { usage: { inputTokens: 99_000, maxPromptTokens: 50_000 } }, 'a1'],
      [300, 'session.usage_record', { usage: { inputTokens: 26_000, maxPromptTokens: 200_000 } }],
      [400, 'session.shutdown', { currentTokens: 19_000 }],
    ]))
    assert.deepEqual(contextAt(timeline, 2), { at: 100, tokens: 20_000, limit: 200_000 })
    assert.deepEqual(contextAt(timeline, 4), { at: 300, tokens: 26_000, limit: 200_000 })
    assert.equal(narrate(timeline[1]), 'That model call read 20k tokens of its 200k limit and took 1.50 s.')
  })

  test('keeps parent-tool-only child models separate from the following main turn', () => {
    const { timeline } = parseSession(log([
      [0, 'session.start', { selectedModel: 'main-model' }],
      [100, 'user.message', { content: 'Go' }],
      [200, 'tool.execution_start', { toolCallId: 'task-1', toolName: 'task' }],
      [300, 'subagent.started', { toolCallId: 'task-1', agentName: 'explore' }, 'child-1'],
      [400, 'session.usage_record', {
        parentToolCallId: 'task-1', usage: { model: 'child-model', inputTokens: 1000 },
      }],
      [500, 'assistant.turn_start', { turnId: 'main-turn' }],
    ]))
    const childCall = timeline.findIndex(({ event }) => event.type === 'session.usage_record')
    const mainTurn = timeline.findIndex(({ event }) => event.type === 'assistant.turn_start')
    assert.equal(modelAt(timeline, childCall), 'child-model')
    assert.equal(modelAt(timeline, mainTurn), 'main-model')
  })

  test('ignores child usage records when selecting main-agent context readings', () => {
    for (const [childIdentity, agentId] of [
      [{ parentToolCallId: 'task-1' }, undefined],
      [{}, 'child-1'],
    ] as const) {
      const { timeline } = parseSession(log([
        [0, 'session.start'],
        [100, 'user.message', { content: 'Go' }],
        [200, 'tool.execution_start', { toolCallId: 'task-1', toolName: 'task' }],
        [300, 'subagent.started', { toolCallId: 'task-1', agentName: 'explore' }, 'child-1'],
        [400, 'session.usage_record', {
          ...childIdentity, usage: { inputTokens: 99_000, maxPromptTokens: 500_000 },
        }, agentId],
        [500, 'session.shutdown', { currentTokens: 5000, tokenLimit: 10_000 }],
      ]))
      const shutdown = timeline.findIndex(({ event }) => event.type === 'session.shutdown')
      assert.deepEqual(contextAt(timeline, shutdown), { at: 500, tokens: 5000, limit: 10_000 })
    }
  })

  test('uses the current call’s model and leaves its missing context limit unknown', () => {
    const { timeline } = parseSession(log([
      [0, 'user.message', { content: 'Go' }],
      [100, 'session.usage_record', {
        usage: { model: 'solver-model', inputTokens: 20_000, maxPromptTokens: 272_000 },
      }],
      [200, 'session.usage_record', {
        usage: { model: 'judge-model', inputTokens: 30_000 },
      }],
    ]))
    assert.equal(modelAt(timeline, 2), 'judge-model')
    assert.deepEqual(contextAt(timeline, 2), { at: 200, tokens: 30_000, limit: undefined })
  })

  test('draws HydraFusion phases over their reported time instead of folding them as idle', () => {
    const session = parseSession(log([
      [0, 'session.fusion_resolved', { syntheticModel: 'hydrafusion', hint: 'A solver works, then a judge reviews.' }],
      [10, 'user.message', { content: 'Go' }],
      [70_000, 'session.usage_record', { usage: { inputTokens: 14_000, duration: 69_000 } }],
      [130_000, 'assistant.fusion_phase_completed', {
        role: 'solver', model: 'gpt-6.1-sol', status: 'succeeded', durationMs: 130_000,
        usage: { requestCount: 8, inputTokens: 146_087 },
      }],
      [140_000, 'assistant.fusion_phase_completed', {
        role: 'judge', model: 'gpt-6-luna', status: 'succeeded', verdict: 'accept', durationMs: 9_000,
        usage: { inputTokens: 8670 },
      }],
      [140_100, 'tool.execution_start', { toolCallId: 't1', toolName: 'create' }],
      [140_101, 'tool.execution_complete', { toolCallId: 't1', success: true }],
      [140_200, 'session.fusion_completed', { outcome: 'completed' }],
    ]))
    assert.deepEqual(session.gaps, [])
    const [solver, judge] = session.spans.filter((span) => span.name.startsWith('Fusion'))
    assert.deepEqual([solver.kind, solver.parent?.kind, solver.start, solver.end, solver.detail], ['agent', 'prompt', 10, 130_000, 'gpt-6.1-sol'])
    assert.deepEqual([judge.start, judge.end], [131_000, 140_000])
    assert.deepEqual(solver.facts, [['Model', 'gpt-6.1-sol'], ['Model calls', '8']])
    assert.deepEqual(contextAt(session.timeline, session.timeline.length - 1), {
      at: 70_000, tokens: 14_000, limit: undefined,
    })
    const said = session.timeline.map(narrate)
    assert.equal(said[0], 'A solver works, then a judge reviews.')
    assert.match(said.find((line) => line.startsWith('Fusion solver'))!, /^Fusion solver on gpt-6\.1-sol finishes after 2m 10s\. .*replays/)
    assert.ok(said.includes('Fusion judge on gpt-6-luna finishes after 9.00 s with the verdict “accept”.'))
  })

  test('shows reasoning, tool requests and responses apart', () => {
    const detail = (data: Record<string, unknown>) =>
      replayDetail(parseSession(log([[0, 'user.message', { content: 'Go' }], [100, 'assistant.message', data]])).timeline[1])
    const requests = [{ name: 'view', arguments: {} }, { name: 'edit', arguments: {} }]
    assert.deepEqual(detail({ content: '', reasoningText: 'Check the tests', toolRequests: requests }),
      { title: 'Assistant', label: 'Reasoning', text: 'Check the tests\n\nRequested view, edit' })
    assert.deepEqual(detail({ content: '', toolRequests: requests }),
      { title: 'Assistant', label: 'Tool requests', text: 'Requested view, edit' })
    assert.deepEqual(detail({ content: 'Done.', reasoningText: 'All green' }),
      { title: 'Assistant', label: 'Response', text: 'Done.', reasoning: 'All green' })
  })

  test('advances by wall time or skips folded gaps without overshooting', () => {
    const session = {
      total: 400_000,
      gaps: [{ start: 1000, end: 101_000, x: 1000 }, { start: 105_000, end: 305_000, x: 25_000 }],
    }
    assert.equal(advanceReplay(session, 0, 500, true), 500)
    assert.equal(advanceReplay(session, 500, 500, true), 101_000)
    assert.equal(advanceReplay(session, 500, 1000, true), 101_500)
    assert.equal(advanceReplay(session, 0, 6000, true), 306_000)
    assert.equal(advanceReplay(session, 20_000, 100, true), 101_100)
    assert.equal(advanceReplay(session, 20_000, 0, true), 20_000)
    assert.equal(advanceReplay(session, 500, 1000, false), 1500)
    assert.equal(advanceReplay(session, 20_000, 100, false), 20_100)
    assert.equal(advanceReplay(session, 399_000, 2000, true), session.total)
    assert.equal(advanceReplay(session, session.total, 2000, false), session.total)
    assert.equal(advanceReplay(session, -100, 0, true), 0)
    assert.equal(advanceReplay({ total: 1, gaps: [] }, 0, 16, true), 1)
  })

  test('keeps seek positions aligned across compressed idle gaps', () => {
    const session = parseSession(demoSession())
    for (const gap of session.gaps) {
      for (const at of [gap.start, (gap.start + gap.end) / 2, gap.end]) {
        assert.ok(Math.abs(timeOf(session, axisOf(session, at)) - at) < 0.001)
        const index = eventIndexAt(session.timeline, at)
        assert.ok(session.timeline[index].at <= at)
        assert.ok(index === session.timeline.length - 1 || session.timeline[index + 1].at > at)
      }
    }
  })
})

describe('session flame expanding', () => {
  const session = parseSession(demoSession())
  const deepest = session.spans.reduce((best, span) => span.depth > best.depth ? span : best)
  const focus = deepest.parent!
  const inside = (span: Span) => {
    for (let node: Span | null = span; node; node = node.parent) if (node === focus) return true
    return false
  }

  test('stacks ancestors as a trail above the expanded subtree and hides the rest', () => {
    const rows = expandedRows(focus)
    const trail: Span[] = []
    for (let node = focus.parent; node; node = node.parent) trail.unshift(node)
    assert.deepEqual(trail.map((span) => rows.get(span)), trail.map((_, index) => index))
    assert.equal(rows.get(focus), trail.length)
    for (const span of session.spans) {
      assert.equal(rows.has(span), trail.includes(span) || inside(span), spanLabel(span))
    }
    const visible = [...rows]
    for (const [span, row] of visible) {
      if (inside(span)) assert.ok(row > trail.length || span === focus)
      for (const [other, otherRow] of visible) {
        if (other !== span && otherRow === row) assert.ok(other.x1 <= span.x0 || span.x1 <= other.x0)
      }
    }
  })

  test('keeps the packed layout when expanded to the whole session', () => {
    const rows = expandedRows(session.root)
    assert.equal(rows.size, session.spans.length)
    for (const span of session.spans) assert.equal(rows.get(span), span.row)
  })

  test('finds the deepest span holding both', () => {
    const elsewhere = session.spans.find((span) => span.kind === 'prompt' && !(span.start <= focus.start && focus.end <= span.end))!
    assert.equal(commonAncestor(focus, elsewhere), session.root)
    assert.equal(commonAncestor(deepest, focus), focus)
    assert.equal(commonAncestor(focus, focus), focus)
  })
})

describe('session flame formatting', () => {
  test('keeps dark labels readable on every hue', () => {
    for (let hue = 0; hue < 360; hue++) {
      assert.ok(contrastRatio(fillColor(hue), INK) >= 4.5, `fill ${hue}`)
      assert.ok(contrastRatio(edgeColor(hue), '#ffffff') >= 3, `edge ${hue}`)
    }
  })

  test('formats durations, clocks and ruler steps', () => {
    assert.deepEqual(
      [0, 999, 1234, 12_345, 59_950, 3_599_499, HOUR, 48 * HOUR].map(formatDuration),
      ['0 ms', '999 ms', '1.23 s', '12.3 s', '1m 00s', '59m 59s', '1h 00m', '2d 00h'],
    )
    assert.deepEqual([clock(61_000), clock(3_661_000), clock(90_061_000), clock(1234, 2)], ['1:01', '1:01:01', '1d 01:01:01', '0:01.23'])
    assert.deepEqual([tickStep(3), tickStep(HOUR), tickStep(4_000_000)], [5, HOUR, 2 * HOUR])
  })

  test('summarizes coverage and the largest share of active time', () => {
    const sample = summarize(parseSession(demoSession()), 'Illustrative sample')
    assert.equal(sample.coverage, 'Illustrative sample · 7m 08s wall clock · 2m 30s active · 3 prompts · 43 spans')
    assert.equal(sample.headline, 'Active for 2m 30s of 7m 08s. The largest share went to bash: 45% of active time.')
    const rough = parseSession([
      log([
        [0, 'session.start'],
        [1000, 'user.message', { content: 'Run it' }],
        [1100, 'assistant.turn_start', { turnId: '0' }],
        [1200, 'tool.execution_complete', { toolCallId: 'ghost', success: true }],
        [2000, 'assistant.turn_end', { turnId: '0' }],
      ]),
      'not json',
    ].join('\n'))
    assert.match(summarize(rough, 'events.jsonl').coverage, / · 1 unreadable line · 1 unmatched completion$/)
  })
})
