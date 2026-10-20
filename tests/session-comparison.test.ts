import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseSession } from '../src/lib/session-flame'
import {
  comparisonBar, comparisonMarkdown, comparisonScale, comparisonWarnings,
  runEvidence, tokenRangeLabel, type ComparisonRun,
} from '../src/lib/session-comparison'

type Row = [number, string, Record<string, unknown>?, string?]
function run(rows: Row[], name = 'run.jsonl'): ComparisonRun {
  const session = parseSession(rows.map(([at, type, data = {}, agentId]) => JSON.stringify({
    type, data, agentId, timestamp: new Date(Date.UTC(2026, 0, 1) + at).toISOString(),
  })).join('\n'))
  return { name, hash: name.repeat(2), session, evidence: runEvidence(session) }
}

describe('recorded session comparison', () => {
  test('aligns first prompts and keeps absolute wall time, including folded idle gaps', () => {
    const short = run([
      [0, 'session.start'], [5000, 'user.message', { content: 'Build TodoMVC' }],
      [6000, 'assistant.turn_start'], [14000, 'assistant.turn_end'], [15000, 'session.shutdown'],
    ])
    const long = run([
      [0, 'session.start'], [20000, 'user.message', { content: 'Build TodoMVC' }],
      [21000, 'assistant.turn_start'], [22000, 'assistant.turn_end'],
      [200000, 'user.message', { content: 'Test it' }], [220000, 'session.shutdown'],
    ])
    assert.equal(short.evidence.start, 5000)
    assert.equal(short.evidence.duration, 10000)
    assert.equal(long.evidence.duration, 200000)
    assert.ok(long.session.gaps.length > 0)
    const scale = comparisonScale([short, long])
    assert.equal(scale, 200000)
    assert.deepEqual(comparisonBar(short.session.root, short.evidence.start, scale), { left: 0, width: 0.05 })
    assert.deepEqual(comparisonBar(long.session.root, long.evidence.start, scale), { left: 0, width: 1 })
    assert.equal(comparisonBar(short.session.root, 16000, scale), undefined)
  })

  test('keeps per-call input separate from context capacity and child-agent usage', () => {
    const { evidence: e } = run([
      [0, 'session.start', { selectedModel: 'claude-test' }],
      [100, 'user.message', { content: 'Build TodoMVC' }],
      [200, 'assistant.usage', { model: 'claude-test', inputTokens: 1200 }],
      [300, 'assistant.usage', { model: 'claude-test', inputTokens: 2400 }],
      [400, 'assistant.usage', { model: 'child-test', inputTokens: 99000 }, 'child'],
      [500, 'assistant.usage', { inputTokens: -1 }],
      [550, 'assistant.usage', { inputTokens: '5000' }],
      [600, 'session.compaction_start', { currentTokens: 80000, tokenLimit: 128000 }],
      [700, 'session.compaction_complete', { preCompactionTokens: 80000, postCompactionTokens: 20000 }],
      [800, 'session.shutdown', { currentTokens: 22000, modelMetrics: { 'claude-test': { usage: { inputTokens: 999999 } } } }],
    ])
    assert.deepEqual(e.models, ['claude-test'])
    assert.deepEqual(e.agentModels, ['child-test'])
    assert.deepEqual(e.input, { min: 1200, max: 2400, samples: 2 })
    assert.ok(e.warnings.some((warning) => warning.includes('2 usage record(s)')))
    assert.deepEqual(e.context, { min: 20000, max: 80000, samples: 4 })
    assert.deepEqual(e.limits, [128000])
    assert.equal(e.compactions, 1)
    assert.equal(tokenRangeLabel(e.input), '1.2k–2.4k')
  })

  test('reads usage records instead of assistant.usage, with their limit, tier and effort', () => {
    const { evidence: e } = run([
      [0, 'session.start', { selectedModel: 'gpt-test', contextTier: 'long_context', reasoningEffort: 'medium' }],
      [100, 'user.message', { content: 'Build TodoMVC' }],
      [200, 'assistant.usage', { inputTokens: 5 }],
      [300, 'session.usage_record', { usage: { model: 'gpt-test', inputTokens: 19000, maxPromptTokens: 922000 } }],
      [400, 'session.usage_record', { usage: { inputTokens: 20600, maxPromptTokens: 922000 } }],
      [500, 'session.usage_record', { usage: { inputTokens: 88000, maxPromptTokens: 1000 } }, 'child'],
      [600, 'session.shutdown', { currentTokens: 20900 }],
    ])
    assert.deepEqual(e.input, { min: 19000, max: 20600, samples: 2 })
    assert.deepEqual(e.limits, [922000])
    assert.deepEqual(e.models, ['gpt-test'])
    assert.deepEqual(e.tiers, ['long_context'])
    assert.deepEqual(e.efforts, ['medium'])
    assert.match(comparisonMarkdown([run([[0, 'user.message']], 'a'), { ...run([[0, 'user.message']], 'b'), evidence: e }]), /\| long\\_context \/ medium \|/)
  })

  test('collects models nested in main and parent-tool-only child usage records', () => {
    const { evidence } = run([
      [0, 'session.start', { selectedModel: 'main-model' }],
      [100, 'user.message', { content: 'Build TodoMVC' }],
      [200, 'tool.execution_start', { toolCallId: 'task-1', toolName: 'task' }],
      [300, 'subagent.started', { toolCallId: 'task-1', agentName: 'explore' }, 'child-1'],
      [400, 'session.usage_record', {
        usage: { model: 'child-model', inputTokens: 1000 }, parentToolCallId: 'task-1',
      }],
      [500, 'session.usage_record', { usage: { model: 'main-usage-model', inputTokens: 2000 } }],
    ])
    assert.deepEqual(evidence.models, ['main-model', 'main-usage-model'])
    assert.deepEqual(evidence.agentModels, ['child-model'])
    assert.ok(evidence.warnings.some((warning) => warning.includes('not a single-model run')))
  })

  test('missing values stay unknown and zero is a real reading', () => {
    const { evidence: e } = run([
      [0, 'session.start', { selectedModel: 'test-model', tokenLimit: 1000000 }],
      [100, 'user.message', { content: 'Build TodoMVC' }],
      [200, 'session.shutdown', { outputTokens: 400 }],
    ])
    assert.equal(e.input, undefined)
    assert.equal(e.context, undefined)
    assert.equal(tokenRangeLabel(e.input), 'Not recorded')
    const zero = run([[0, 'user.message'], [100, 'assistant.usage', { inputTokens: 0 }]])
    assert.equal(tokenRangeLabel(zero.evidence.input), '0')
    assert.ok(zero.evidence.warnings.some((warning) => warning.includes('No session end')))
  })

  test('warns about mixed models, different workloads and selecting the same log', () => {
    const a = run([
      [0, 'session.start', { selectedModel: 'claude-test' }],
      [100, 'user.message', { content: 'Build TodoMVC' }],
      [200, 'session.model_change', { newModel: 'openai-test' }],
      [300, 'session.shutdown'],
    ], 'mixed.jsonl')
    const b = run([[0, 'user.message', { content: 'Different task' }], [500, 'session.shutdown']], 'other.jsonl')
    assert.ok(a.evidence.warnings.some((warning) => warning.includes('not a single-model run')))
    assert.ok(comparisonWarnings(a, b).some((warning) => warning.includes('prompt sequences differ')))
    assert.ok(comparisonWarnings(a, a).some((warning) => warning.includes('same log')))
  })

  test('exports measured evidence without raw prompts or tool content and escapes filenames', () => {
    const a = run([
      [0, 'session.start', { selectedModel: 'test-model' }],
      [100, 'user.message', { content: 'PRIVATE_PROMPT' }],
      [200, 'tool.execution_start', { toolCallId: 'a', toolName: 'bash', arguments: { command: 'PRIVATE_COMMAND' } }],
      [400, 'tool.execution_complete', { toolCallId: 'a', success: false }],
      [500, 'session.shutdown'],
    ], '<run|one>.jsonl')
    const report = comparisonMarkdown([a, a])
    assert.match(report, /SHA-256/)
    assert.match(report, /not proof/)
    assert.match(report, /Not recorded/)
    assert.match(report, /same log/)
    assert.ok(report.includes('\\<run\\|one\\>.jsonl'))
    assert.doesNotMatch(report, /PRIVATE_PROMPT|PRIVATE_COMMAND/)
    assert.equal(a.evidence.tools, 1)
    assert.equal(a.evidence.failures, 1)
  })
})
