import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { analyzeEdits, classifyPath, demoEdits, parseEdits, pathParts, summarizeCategories } from '../src/lib/agent-edits'

describe('agent edit breakdown', () => {
  test('classifies agent artifacts before generic tests, config, and docs', () => {
    assert.equal(classifyPath('evals/tests/answer.eval.test.ts'), 'evals')
    assert.equal(classifyPath('.github/skills/review/SKILL.md'), 'skills')
    assert.equal(classifyPath('AGENTS.md'), 'instructions')
    assert.equal(classifyPath('.claude/commands/review.prompt.md'), 'prompts')
    assert.equal(classifyPath('.claude/settings.json'), 'tools')
    assert.equal(classifyPath('tests/test_agent.py'), 'tests')
    assert.equal(classifyPath('MyApp.Tests/AgentTest.cs'), 'tests')
    assert.equal(classifyPath('.husky/pre-commit'), 'tools')
    assert.equal(classifyPath('bun.lock'), 'dependencies')
    assert.equal(classifyPath('.github/workflows/checks.yml'), 'config')
    assert.equal(classifyPath('docs/setup.md'), 'docs')
    assert.equal(classifyPath('src/agent.ts'), 'runtime')
  })

  test('parses Copilot line replacements, creates, apply patches, failures, and agent identity', () => {
    const records = [
      { type: 'session.start', data: { sessionId: 'copilot-1' } },
      { type: 'tool.execution_start', data: { toolCallId: 'edit-1', toolName: 'edit', arguments: { path: 'src/app.ts', old_str: 'a\nkeep\nb\n', new_str: 'x\nkeep\ny\nz\n' } } },
      { type: 'tool.execution_complete', data: { toolCallId: 'edit-1', success: true } },
      { type: 'tool.execution_start', agentId: 'eval-agent', data: { toolCallId: 'patch-1', toolName: 'apply_patch', arguments: '*** Begin Patch\n*** Add File: evals/basic.eval.ts\n+one\n+two\n++flag\n--disabled\n*** End Patch' } },
      { type: 'tool.execution_complete', data: { toolCallId: 'patch-1', success: true } },
      { type: 'tool.execution_start', data: { toolCallId: 'fail-1', toolName: 'create', arguments: { path: 'src/no.ts', file_text: 'ignored' } } },
      { type: 'tool.execution_complete', data: { toolCallId: 'fail-1', success: false } },
    ]
    const analysis = analyzeEdits([parseEdits(records.map((record) => JSON.stringify(record)).join('\n'))])
    assert.equal(analysis.added, 6)
    assert.equal(analysis.removed, 3)
    assert.equal(analysis.failedCalls, 1)
    assert.equal(analysis.filesEdited, 2)
    assert.ok(analysis.agents.some((agent) => agent.label === 'Subagent · eval-agent'))
    assert.ok(analysis.agents.some((agent) => agent.label === 'Main agent'))
  })

  test('classifies eval artifact tokens without matching ordinary filename substrings', () => {
    for (const path of [
      'eval/answer.json', 'evaluations/answer.ts', 'src/answer.eval.ts', 'src/answer_eval.py',
      'graders/answer.py', 'src/answer-grader.ts', 'rubrics/answer.json', 'answer.rubric.json',
      'golden/answer.json', 'tests/golden-answers.json', 'expected/answer.json', 'answer.expected.json',
      'expected-output.json', 'expected_outputs/answer.json', 'eval-dataset.json',
      'eval_datasets/answer.json', 'promptfoo.yaml', 'config/promptfoo.config.ts',
    ]) assert.equal(classifyPath(path), 'evals', path)
    for (const path of [
      'src/schema-upgrader.ts', 'src/rubrication.ts', 'src/goldenrod.ts',
      'src/promptfood.ts', 'src/myeval-dataset.ts',
    ]) assert.equal(classifyPath(path), 'runtime', path)
    assert.equal(classifyPath('docs/expected-behavior.md'), 'docs')
    for (const source of ['Copilot CLI', 'Claude Code', 'Codex CLI']) {
      const path = 'docs/expected-behavior.md'
      const records = source === 'Copilot CLI' ? [
        { type: 'tool.execution_start', data: { toolCallId: 'a', toolName: 'create', arguments: { path, file_text: 'line' } } },
        { type: 'tool.execution_complete', data: { toolCallId: 'a', success: true } },
      ] : source === 'Claude Code' ? [
        { type: 'assistant', sessionId: 'a', message: { content: [{ type: 'tool_use', id: 'a', name: 'Write', input: { file_path: path, content: 'line' } }] } },
        { type: 'user', sessionId: 'a', message: { content: [{ type: 'tool_result', tool_use_id: 'a', is_error: false }] } },
      ] : [
        { type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'a', name: 'apply_patch', input: `*** Begin Patch\n*** Add File: ${path}\n+line\n*** End Patch` } },
        { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'a', output: 'Success' } },
      ]
      assert.deepEqual(parseEdits(JSON.stringify(records)).changes.map((change) => change.category), ['docs'], source)
    }
  })

  test('groups Claude edits by main or sidechain and counts MultiEdit and notebook writes', () => {
    const records = [
      { type: 'assistant', sessionId: 'claude-1', isSidechain: false, message: { content: [
        { type: 'tool_use', id: 'multi', name: 'MultiEdit', input: { file_path: 'tests/a.test.ts', edits: [
          { old_string: 'old\n', new_string: 'new\n' }, { old_string: '', new_string: 'more\n' },
        ] } },
      ] } },
      { type: 'user', sessionId: 'claude-1', message: { content: [{ type: 'tool_result', tool_use_id: 'multi', is_error: false }] } },
      { type: 'assistant', sessionId: 'claude-1', isSidechain: true, agentId: 'side-7', message: { content: [
        { type: 'tool_use', id: 'notebook', name: 'NotebookEdit', input: { notebook_path: 'lab.ipynb', new_source: 'print(1)\nprint(2)\n' } },
      ] } },
      { type: 'user', sessionId: 'claude-1', message: { content: [{ type: 'tool_result', tool_use_id: 'notebook', is_error: false }] } },
      { type: 'assistant', sessionId: 'claude-1', isSidechain: false, message: { content: [
        { type: 'tool_use', id: 'failed', name: 'Write', input: { file_path: 'src/failed.ts', content: 'not written' } },
      ] } },
      { type: 'user', sessionId: 'claude-1', message: { content: [{ type: 'tool_result', tool_use_id: 'failed', is_error: true }] } },
    ]
    const analysis = analyzeEdits([parseEdits(records.map((record) => JSON.stringify(record)).join('\n'))])
    assert.equal(analysis.added, 4)
    assert.equal(analysis.removed, 1)
    assert.equal(analysis.failedCalls, 1)
    assert.ok(analysis.agents.some((agent) => agent.label === 'Main agent'))
    assert.ok(analysis.agents.some((agent) => agent.label === 'Subagent · side-7'))
  })

  test('parses Codex apply_patch and labels unavailable attribution explicitly', () => {
    const records = [
      { type: 'session_meta', payload: { id: 'codex-1' } },
      { type: 'response_item', payload: { type: 'function_call', call_id: 'patch', name: 'apply_patch', arguments: '*** Begin Patch\n*** Update File: prompts/system.prompt.md\n@@\n-old\n+new\n*** End Patch' } },
      { type: 'response_item', payload: { type: 'function_call_output', call_id: 'patch', output: 'Exit code: 0' } },
    ]
    const analysis = analyzeEdits([parseEdits(records.map((record) => JSON.stringify(record)).join('\n'))])
    assert.equal(analysis.added, 1)
    assert.equal(analysis.removed, 1)
    assert.equal(analysis.agents[0].label, 'Unknown attribution')
  })

  test('treats Codex Success output as success even when a changed path says failed', () => {
    const patch = (callId: string) => ({ type: 'response_item', payload: { type: 'custom_tool_call', call_id: callId, name: 'apply_patch',
      input: `*** Begin Patch\n*** Add File: src/${callId}.ts\n+line\n*** End Patch` } })
    const output = (callId: string, value: string) => ({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: callId, output: value } })
    const records = [
      { type: 'session_meta', payload: { id: 'codex-2' } },
      patch('failed'), output('failed', 'Success. Updated the following files:\nA src/failed.ts\n'),
      patch('wrapped'), output('wrapped', 'Exit code: 0\nWall time: 0 seconds\nOutput:\nSuccess. Updated the following files:\nA src/failed-wrapped.ts\n'),
      patch('json'), output('json', '{"output":"Updated src/failed-json.ts","metadata":{"exit_code":0}}'),
      patch('rejected'), output('rejected', 'Exit code: 1\nOutput:\nerror: patch did not apply'),
      patch('error'), output('error', 'apply_patch verification failed: missing context'),
    ]
    const imported = parseEdits(records.map((record) => JSON.stringify(record)).join('\n'))
    assert.deepEqual(imported.changes.map((change) => change.path), ['src/failed.ts', 'src/wrapped.ts', 'src/json.ts'])
    assert.equal(imported.failedCalls, 2)
  })

  test('names Copilot sub-agents from subagent.started regardless of event order', () => {
    const records = [
      { type: 'session.start', data: { sessionId: 'copilot-2' } },
      { type: 'tool.execution_start', agentId: 'call_KA4Zabc123', data: { toolCallId: 'named', toolName: 'create', arguments: { path: 'src/named.ts', file_text: 'a\n' } } },
      { type: 'tool.execution_complete', data: { toolCallId: 'named', success: true } },
      { type: 'subagent.started', data: { toolCallId: 'call_KA4Zabc123', agentName: 'general-purpose', agentDisplayName: 'General Purpose Agent' } },
      { type: 'subagent.started', data: { toolCallId: 'call_plain', agentName: 'explore' } },
      { type: 'tool.execution_start', agentId: 'call_plain', data: { toolCallId: 'plain', toolName: 'create', arguments: { path: 'src/plain.ts', file_text: 'b\n' } } },
      { type: 'tool.execution_complete', data: { toolCallId: 'plain', success: true } },
      { type: 'tool.execution_start', agentId: 'call_orphan', data: { toolCallId: 'orphan', toolName: 'create', arguments: { path: 'src/orphan.ts', file_text: 'c\n' } } },
      { type: 'tool.execution_complete', data: { toolCallId: 'orphan', success: true } },
    ]
    const labels = analyzeEdits([parseEdits(records.map((record) => JSON.stringify(record)).join('\n'))]).agents.map((agent) => agent.label)
    assert.deepEqual(labels.sort(), ['explore · _plain', 'General Purpose Agent · abc123', 'Subagent · call_orphan'].sort())
  })

  test('Codex rejected and ambiguous outcomes never enter successful totals in either call format', () => {
    for (const type of ['function', 'custom_tool']) {
      const outcomes = [
        { output: 'Invalid patch: The last line of the patch must be End Patch', failed: 1, unfinished: 0, added: 0 },
        { output: 'error: patch did not apply', failed: 1, unfinished: 0, added: 0 },
        { output: 'apply_patch verification failed: missing context', failed: 1, unfinished: 0, added: 0 },
        { output: 'Updated src/a.ts', failed: 0, unfinished: 1, added: 0 },
        { output: '', failed: 0, unfinished: 1, added: 0 },
        { output: 'Success. Updated src/failed.ts', failed: 0, unfinished: 0, added: 1 },
        { output: 'Exit code: 0\nerror: retained in file content', failed: 0, unfinished: 0, added: 1 },
        { output: 'Exit code: -1\nSuccess', failed: 1, unfinished: 0, added: 0 },
        { output: 'Success', success: false, failed: 1, unfinished: 0, added: 0 },
        { output: 'Exit code: 1\nerror: text', success: true, failed: 0, unfinished: 0, added: 1 },
        { output: 'Exit code: 0\nSuccess', success: false, failed: 1, unfinished: 0, added: 0 },
      ]
      for (const { output, success, failed, unfinished, added } of outcomes) {
        const patch = '*** Begin Patch\n*** Add File: src/a.ts\n+line' +
          (output.startsWith('Invalid patch:') ? '' : '\n*** End Patch')
        const analysis = analyzeEdits([parseEdits(JSON.stringify([
          { type: 'session_meta', payload: { id: 'codex-outcomes' } },
          { type: 'response_item', payload: { type: `${type}_call`, call_id: 'a', name: 'apply_patch',
            ...(type === 'function' ? { arguments: patch } : { input: patch }) } },
          { type: 'response_item', payload: { type: `${type}_call_output`, call_id: 'a', output, success } },
        ]))])
        assert.deepEqual(
          { added: analysis.added, failed: analysis.failedCalls, unfinished: analysis.unconfirmedCalls },
          { added, failed, unfinished }, `${type}: ${output}`,
        )
      }
    }
  })

  test('sample demonstrates all included sources and pending calls are not counted as edits', () => {
    const analysis = analyzeEdits([parseEdits(demoEdits)])
    assert.deepEqual(analysis.sources, ['Copilot CLI', 'Claude Code', 'Codex CLI'])
    assert.ok(analysis.agents.some((agent) => agent.source === 'Copilot CLI · session copilot-demo'))
    const uuid = parseEdits([
      { type: 'session.start', data: { sessionId: '588ba83a-9ddd-4246-ae3c-c8b6f1c61130' } },
      { type: 'tool.execution_start', data: { toolCallId: 'u', toolName: 'create', arguments: { path: 'src/u.ts', file_text: 'u\n' } } },
      { type: 'tool.execution_complete', data: { toolCallId: 'u', success: true } },
    ].map((record) => JSON.stringify(record)).join('\n'))
    assert.equal(uuid.changes[0].source, 'Copilot CLI · session 588ba83a')
    assert.ok(analysis.agents.some((agent) => agent.label === 'Unknown attribution'))
    assert.ok(analysis.agents.some((agent) => agent.categories.some((category) => category.name === 'Evals')))
    const pending = parseEdits(JSON.stringify({ type: 'tool.execution_start', data: {
      toolCallId: 'unfinished', toolName: 'create', arguments: { path: 'src/lost.ts', file_text: 'not saved' },
    } }))
    assert.equal(analyzeEdits([pending]).added, 0)
    assert.equal(pending.unconfirmedCalls, 1)
  })

  test('counts the same path once in the combined file total while retaining per-agent rows', () => {
    const records = [
      { type: 'session.start', data: { sessionId: 'one' } },
      { type: 'tool.execution_start', data: { toolCallId: 'a', toolName: 'create', arguments: { path: 'src/shared.ts', file_text: 'a\n' } } },
      { type: 'tool.execution_complete', data: { toolCallId: 'a', success: true } },
      { type: 'tool.execution_start', agentId: 'helper', data: { toolCallId: 'b', toolName: 'create', arguments: { path: 'src/shared.ts', file_text: 'b\n' } } },
      { type: 'tool.execution_complete', data: { toolCallId: 'b', success: true } },
    ]
    const analysis = analyzeEdits([parseEdits(records.map((record) => JSON.stringify(record)).join('\n'))])
    assert.equal(analysis.filesEdited, 1)
    assert.equal(analysis.agents.length, 2)
    assert.ok(analysis.agents.every((agent) => agent.filesEdited === 1))
    const runtime = summarizeCategories(analysis.agents).find((category) => category.id === 'runtime')
    assert.deepEqual(runtime && { files: runtime.files, added: runtime.added, agents: runtime.changes.map((change) => change.label).sort() },
      { files: 1, added: 2, agents: ['Main agent', 'Subagent · helper'] })
  })

  test('splits displayed paths only after separators', () => {
    assert.deepEqual(pathParts('evals/answer.eval.json'), ['evals/', 'answer.eval.json'])
    assert.deepEqual(pathParts('/repo/AGENTS.md'), ['/', 'repo/', 'AGENTS.md'])
    assert.deepEqual(pathParts('C:\\repo\\src\\'), ['C:\\', 'repo\\', 'src\\'])
    assert.deepEqual(pathParts('README.md'), ['README.md'])
  })
})
