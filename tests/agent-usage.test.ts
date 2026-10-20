import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { analyzeUsage, demoEvents, estimateCost, estimateWorkloadCost, findings, manualUsage, parseTokenInput, parseUsage, projectModelSavings, sessionCost } from '../src/lib/agent-usage'
import type { Usage } from '../src/lib/agent-usage'
import { findModelPrice } from '../src/lib/model-pricing'

describe('agent usage analysis', () => {
  test('parses recorded usage and avoids adding shutdown snapshots to call detail', () => {
    const imported = parseUsage(JSON.stringify([
      { type: 'session.start', data: { sessionId: 'session-1' } },
      {
        id: 'call-1',
        type: 'assistant.usage',
        timestamp: '2026-10-09T12:00:00Z',
        data: {
          model: 'claude-sonnet-5.5',
          inputTokens: 1000,
          cacheReadTokens: 200,
          cacheWriteTokens: 100,
          outputTokens: 300,
          reasoningTokens: 50,
          copilotUsage: { totalNanoAiu: 42 },
        },
      },
      {
        id: 'shutdown-1',
        type: 'session.shutdown',
        timestamp: '2026-10-09T12:05:00Z',
        data: {
          modelMetrics: {
            'claude-sonnet-5.5': {
              usage: {
                inputTokens: 1000,
                cacheReadTokens: 200,
                cacheWriteTokens: 100,
                outputTokens: 300,
                reasoningTokens: 50,
              },
              totalNanoAiu: 42,
              requests: { count: 1, cost: 1 },
            },
          },
        },
      },
    ]))
    const analysis = analyzeUsage([imported])
    assert.equal(analysis.sessions, 1)
    assert.equal(analysis.workload.length, 1)
    assert.equal(analysis.workload[0].kind, 'snapshot')
    assert.equal(analysis.totals.input.value, 1000)
    assert.equal(analysis.totals.nanoAiu.value, 42)
    assert.match(analysis.coverage, /Shutdown totals/)
    assert.ok(analysis.warnings.some((warning) => warning.includes('not additional usage')))
  })

  test('prices cached and uncached tokens, supports shorthand, and rejects incomplete records', () => {
    assert.equal(parseTokenInput('1.5M'), 1_500_000)
    assert.equal(parseTokenInput('250k'), 250_000)
    assert.throws(() => parseTokenInput('-1'), /nonnegative token count/)

    const price = findModelPrice('claude-sonnet-5.5')
    assert.ok(price)
    const record = manualUsage('claude-sonnet-5.5', 10_000, 20_000, 5_000, 2_000)
    assert.equal(estimateCost([record], price).low, 0.0545)
    const incomplete: Usage = { ...record, write: null }
    assert.match(estimateCost([incomplete], price).reason ?? '', /must all be reported/)
  })

  test('parses Codex per-call usage once and keeps cached input inside input', () => {
    const totalA = { total_tokens: 1100 }
    const imported = parseUsage([
      { type: 'session_meta', payload: { id: 'codex-1' } },
      { type: 'turn_context', payload: { model: 'gpt-5.5' } },
      { type: 'response_item', payload: { type: 'function_call', call_id: 'call-1', name: 'exec_command' } },
      { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: totalA, last_token_usage: { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 100, reasoning_output_tokens: 40 } } } },
      { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: totalA, last_token_usage: { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 100 } } } },
    ].map((line) => JSON.stringify(line)).join('\n'))
    const analysis = analyzeUsage([imported])
    assert.deepEqual(analysis.sources, ['Codex CLI'])
    assert.equal(analysis.workload.length, 1)
    assert.equal(analysis.workload[0].model, 'gpt-5.5')
    assert.equal(analysis.totals.input.value, 1000)
    assert.equal(analysis.totals.read.value, 600)
    assert.equal(analysis.totals.write.value, 0)
    assert.deepEqual(analysis.tools, [{ name: 'exec_command', count: 1, failed: 0 }])
  })

  test('normalizes Claude Code usage and keeps the final line for a streamed message', () => {
    const line = (output_tokens: number) => ({
      type: 'assistant', sessionId: 'claude-1', timestamp: '2026-10-09T12:00:00Z',
      message: {
        id: 'msg-1', model: 'claude-opus-5',
        usage: { input_tokens: 10, cache_read_input_tokens: 200, cache_creation_input_tokens: 30, output_tokens },
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash' }],
      },
    })
    const imported = parseUsage([
      line(1), line(80),
      { type: 'user', sessionId: 'claude-1', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', is_error: true }] } },
    ].map((item) => JSON.stringify(item)).join('\n'))
    const analysis = analyzeUsage([imported])
    assert.deepEqual(analysis.sources, ['Claude Code'])
    assert.equal(analysis.workload.length, 1)
    assert.equal(analysis.totals.input.value, 240)
    assert.equal(analysis.totals.output.value, 80)
    assert.deepEqual(analysis.tools, [{ name: 'Bash', count: 1, failed: 1 }])
    assert.ok(Math.abs(estimateCost(analysis.workload, findModelPrice('claude-opus-5')).low! - 0.0023375) < 1e-12)
  })

  test('prices Claude Code 5-minute and 1-hour cache writes separately', () => {
    const imported = parseUsage(JSON.stringify({
      type: 'assistant',
      sessionId: 'claude-cache-tiers',
      timestamp: '2026-10-09T12:00:00Z',
      message: {
        id: 'msg-cache-tiers',
        model: 'claude-sonnet-5.5',
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 5,
          cache_creation_input_tokens: 30,
          cache_creation: {
            ephemeral_5m_input_tokens: 20,
            ephemeral_1h_input_tokens: 10,
          },
          output_tokens: 1,
        },
      },
    }))
    const analysis = analyzeUsage([imported])
    const record = analysis.workload[0]
    assert.equal(record.cacheWrite5m, 20)
    assert.equal(record.cacheWrite1h, 10)
    assert.equal(estimateCost([record], findModelPrice('claude-sonnet-5.5')).low, 0.0001205)
  })

  test('shows a range when cache-write TTL is unknown', () => {
    const record = manualUsage('claude-sonnet-5.5', 0, 0, 100, 0)
    const estimate = estimateCost([record], findModelPrice('claude-sonnet-5.5'))
    assert.equal(estimate.low, 0.00025)
    assert.equal(estimate.high, 0.0004)
    assert.match(estimate.reason ?? '', /cache-write TTL/)
  })

  test('prices unknown-TTL, 5-minute, and 1-hour cache writes together', () => {
    const record = manualUsage('claude-sonnet-5.5', 40, 10, 30, 1, 20, 10)
    const estimate = estimateCost([record], findModelPrice('claude-sonnet-5.5'))
    assert.ok(Math.abs(estimate.low! - 0.000256) < 1e-12)
    assert.ok(Math.abs(estimate.high! - 0.000301) < 1e-12)
  })

  test('prices aggregate snapshots as a short- to long-context range', () => {
    const record: Usage = { ...manualUsage('gpt-6-astra', 1_000_000, 0, 0, 100_000), kind: 'snapshot' }
    const estimate = estimateCost([record], findModelPrice('gpt-6-astra'))
    assert.equal(estimate.low, 15)
    assert.equal(estimate.high, 27.5)
    assert.match(estimate.reason ?? '', /long-context/)
  })

  test('includes official peak and off-peak pricing tiers in the estimate range', () => {
    const record = manualUsage('deepseek-v4-pro', 0, 100_000, 0, 0)
    const estimate = estimateCost([record], findModelPrice('deepseek-v4-pro'))
    assert.equal(estimate.low, 0.0022)
    assert.equal(estimate.high, 0.0044)
    assert.match(estimate.reason ?? '', /time-based pricing/)
  })

  test('uses provider-published rates and metadata for cross-provider comparisons', () => {
    assert.equal(findModelPrice('gpt-6-luna')?.provider, 'OpenAI')
    assert.equal(findModelPrice('deepseek-v4-pro')?.provider, 'DeepSeek')
    assert.equal(findModelPrice('kimi-k3')?.provider, 'Moonshot AI')
    assert.equal(findModelPrice('glm-5.3-flash')?.provider, 'Z.AI')
    assert.ok(findModelPrice('claude-opus-5.5')?.source.includes('claude'))
  })

  test('applies Grok long-context rates from 200K input tokens', () => {
    assert.equal(estimateCost([manualUsage('grok-4.7', 200_000, 0, 0, 0)], findModelPrice('grok-4.7')).low, 0.8)
    assert.equal(estimateCost([manualUsage('grok-4.7', 199_999, 0, 0, 0)], findModelPrice('grok-4.7')).low, 0.399998)
  })

  test('matches model ids with compact or hyphenated date suffixes', () => {
    assert.equal(findModelPrice('gpt-5.4-20260305')?.id, 'gpt-5.4')
    assert.equal(findModelPrice('gpt-5.4-2026-03-05')?.id, 'gpt-5.4')
  })

  test('demo covers all supported agent logs', () => {
    const analysis = analyzeUsage([parseUsage(demoEvents)])
    assert.deepEqual(analysis.sources, ['GitHub Copilot CLI', 'Codex CLI', 'Claude Code'])
    assert.equal(analysis.sessions, 3)
    assert.equal(analysis.calls.length, 10)
  })

  test('projects the same usage on a cheaper model without changing token counts', () => {
    const analysis = analyzeUsage([parseUsage(demoEvents)])
    const current = sessionCost(analysis)
    assert.ok(current.low !== null && current.high !== null)
    const alternative = findModelPrice('gpt-5-mini')!
    const projection = projectModelSavings(analysis.workload, alternative, 100)
    if (!projection.available) throw new Error(projection.reason)
    assert.ok(projection.current[0] < projection.current[1])
    assert.ok(projection.alternative[0] <= projection.alternative[1])
    assert.ok(projection.savings[0] > 0)
    const single = projectModelSavings(
      [manualUsage('gpt-5.5', 100_000, 0, 0, 1_000)], alternative, 100,
    )
    if (!single.available) throw new Error(single.reason)
    assert.equal(single.current[0], 53)
    assert.ok(Math.abs(single.alternative[0] - 2.7) < 1e-9)
    assert.ok(Math.abs(single.savings[0] - 50.3) < 1e-9)
  })

  test('preserves mixed-model pricing bounds and reasons in the session cost API', () => {
    const workload = [
      manualUsage('claude-opus-5', 0, 0, 1_000_000, 0),
      manualUsage('gpt-5-mini', 1_000_000, 0, 0, 0),
    ]
    const analysis = analyzeUsage([{ usage: workload, tools: [], warnings: [], recognized: 2, sources: [] }])
    const estimate = estimateWorkloadCost(workload)
    assert.equal(estimate.low, 6.5)
    assert.equal(estimate.high, 10.25)
    assert.match(estimate.reason ?? '', /cache-write TTL/)
    assert.deepEqual(sessionCost(analysis), estimate)
    const override = findModelPrice('gpt-5-mini')!
    assert.deepEqual(sessionCost(analysis, override), estimateCost(workload, override))
    assert.deepEqual(estimateWorkloadCost([]), { low: null, high: null, reason: 'No usage available.' })
  })

  test('summarizes how the model was used in plain language', () => {
    const notes = findings(analyzeUsage([parseUsage(demoEvents)]))
    assert.ok(notes.some((note) => /from cache|served from cache/.test(note)))
    assert.ok(notes.some((note) => /input tokens for every token it wrote/.test(note)))
    assert.ok(notes.some((note) => /Context peaked at .* on call \d+ of 10/.test(note)))
    assert.ok(notes.some((note) => /models were used/.test(note)))
  })

  test('session cost is unknown when a model has no price', () => {
    const analysis = analyzeUsage([parseUsage(JSON.stringify({
      type: 'assistant.usage', data: { model: 'unknown-model-x', inputTokens: 10, outputTokens: 5 },
    }))])
    const cost = sessionCost(analysis)
    assert.equal(cost.low, null)
    assert.equal(cost.high, null)
    assert.match(cost.reason ?? '', /no verified rate/)
  })

  test('projects savings by repeating the workload, not inflating per-call context', () => {
    const workload = [{ ...manualUsage('gpt-5.5', 100_000, 0, 0, 1000), kind: 'call' as const }]
    const projection = projectModelSavings(workload, findModelPrice('gpt-5-mini')!, 100)
    assert.equal(projection.available, true)
    assert.equal(projection.current[0], 53)
    assert.equal(projection.current[1], 53)
    assert.equal(projection.alternative[0], 2.7)
    assert.ok(Math.abs(projection.savings[0] - 50.3) < 1e-9)
    assert.equal(projection.savings[0], projection.savings[1])
  })

  test('preserves cost and savings bounds for uncertain cache-write rates', () => {
    const projection = projectModelSavings(
      [manualUsage('claude-opus-5', 0, 0, 1_000_000, 0)], findModelPrice('claude-haiku-4.5')!, 10,
    )
    assert.equal(projection.available, true)
    assert.deepEqual(projection.current, [62.5, 100])
    assert.deepEqual(projection.alternative, [12.5, 20])
    assert.deepEqual(projection.savings, [42.5, 87.5])
  })

  test('does not claim savings for unchanged or more expensive models', () => {
    const workload = [manualUsage('claude-haiku-4.5', 0, 0, 1_000_000, 0)]
    const same = projectModelSavings(workload, findModelPrice('claude-haiku-4.5')!, 10)
    assert.equal(same.available, true)
    assert.deepEqual(same.savings, [0, 0])
    const more = projectModelSavings(workload, findModelPrice('claude-opus-5')!, 10)
    assert.equal(more.available, true)
    assert.deepEqual(more.savings, [-87.5, -42.5])
  })

  test('keeps overlapping price ranges instead of claiming a saving from their midpoints', () => {
    const workload = [manualUsage('claude-opus-5', 0, 0, 1_000_000, 0)]
    const alternative = { ...findModelPrice('claude-haiku-4.5')!, write1h: 12 }
    const projection = projectModelSavings(workload, alternative, 1)
    assert.equal(projection.available, true)
    assert.deepEqual(projection.savings, [-5.75, 8.75])
  })

  test('uses recorded mixed-model rates unless the baseline is explicitly overridden', () => {
    const workload = [
      manualUsage('gpt-5.5', 1_000_000, 0, 0, 0),
      manualUsage('gpt-5-mini', 1_000_000, 0, 0, 0),
    ]
    const model = findModelPrice('gpt-5-mini')!
    const mixed = projectModelSavings(workload, model, 1)
    assert.equal(mixed.available, true)
    assert.deepEqual(mixed.current, [10.25, 10.25])
    assert.deepEqual(mixed.alternative, [0.5, 0.5])
    const override = projectModelSavings(workload, model, 1, model)
    assert.equal(override.available, true)
    assert.deepEqual(override.current, [0.5, 0.5])
    assert.deepEqual(override.savings, [0, 0])
  })

  test('handles zero, missing, unknown-model, expired-rate and invalid-run inputs honestly', () => {
    const model = findModelPrice('gpt-5-mini')!
    const emptyUsage = manualUsage('gpt-5.5', 0, 0, 0, 0)
    const zero = projectModelSavings([emptyUsage], model, 1)
    assert.equal(zero.available, true)
    assert.deepEqual(zero.savings, [0, 0])
    for (const workload of [[], [{ ...emptyUsage, output: null }], [{ ...emptyUsage, model: 'unknown-model' }]]) {
      const projection = projectModelSavings(workload, model, 10)
      assert.equal(projection.available, false)
      if (projection.available) throw new Error('Incomplete records must not produce savings.')
      assert.ok(projection.reason)
    }
    const expired = projectModelSavings([emptyUsage], { ...model, promotionalUntil: '2000-01-01' }, 1)
    assert.equal(expired.available, false)
    if (expired.available) throw new Error('Expired rates must not produce savings.')
    assert.match(expired.reason, /expired/)
    for (const runs of [0, -1, 1.5, NaN, Infinity]) {
      assert.throws(() => projectModelSavings([emptyUsage], model, runs), /positive whole number/)
    }
  })
})
