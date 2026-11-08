export const categories = [
  { id: 'evals', name: 'Evals', icon: 'EV' },
  { id: 'instructions', name: 'Agent instructions', icon: 'IN' },
  { id: 'skills', name: 'Skills', icon: 'SK' },
  { id: 'prompts', name: 'Prompts', icon: 'PR' },
  { id: 'tools', name: 'Tools & MCP', icon: 'TL' },
  { id: 'tests', name: 'Tests', icon: 'TS' },
  { id: 'dependencies', name: 'Dependencies', icon: 'DP' },
  { id: 'config', name: 'Config', icon: 'CF' },
  { id: 'docs', name: 'Docs', icon: 'DC' },
  { id: 'runtime', name: 'Runtime', icon: 'RT' },
] as const

export type CategoryId = typeof categories[number]['id']
export type EditChange = {
  agent: string
  label: string
  source: string
  path: string
  category: CategoryId
  tool: string
  added: number
  removed: number
}
export type ImportedEdits = {
  changes: EditChange[]
  failedCalls: number
  unconfirmedCalls: number
  sources: string[]
  warnings: string[]
}
export type EditAnalysis = {
  agents: {
    key: string
    label: string
    source: string
    added: number
    removed: number
    filesEdited: number
    categories: { id: CategoryId; name: string; icon: string; added: number; removed: number; files: number; changes: EditChange[] }[]
  }[]
  added: number
  removed: number
  filesEdited: number
  failedCalls: number
  unconfirmedCalls: number
  sources: string[]
  warnings: string[]
}
export type CategorySummary = {
  id: CategoryId
  name: string
  icon: string
  added: number
  removed: number
  files: number
  changes: EditChange[]
}

type Data = Record<string, unknown>
const object = (value: unknown): Data =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const id = (value: unknown) =>
  typeof value === 'string' && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value) ? value : ''
const basename = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
const lines = (value: string) => {
  if (!value) return []
  const result = value.split(/\r\n?|\n/)
  if (/\r?\n$|\r$/.test(value)) result.pop()
  return result
}

export function classifyPath(input: string): CategoryId {
  const path = input.replace(/\\/g, '/').replace(/^\.\/+/, '').toLowerCase()
  const name = basename(path)
  if (/(?:^|\/)(?:evals?|evaluations?)\//.test(path) ||
      /(?:\.eval\.|_eval\.)/.test(name) ||
      /(?:^|[/._ -])(?:graders?|rubrics?|golden|expected[-_ ]outputs?|eval[-_ ]?datasets?|promptfoo)(?=$|[/._ -])/.test(path) ||
      /(?:^|[/._ -])expected(?=$|[/.])/.test(path)) return 'evals'
  if (/^(?:agents|claude|gemini)\.md$/.test(name) || /(?:^|\/)\.github\/copilot-instructions\.md$/.test(path) ||
      /\.instructions\.md$/.test(name) || /(?:^|\/)\.cursor\/rules(?:\/|$)/.test(path) ||
      /^(?:\.cursorrules|\.windsurfrules)$/.test(name)) return 'instructions'
  if (name === 'skill.md' || /(?:^|\/)\.(?:agents|claude|github)\/skills(?:\/|$)/.test(path)) return 'skills'
  if (/(?:^|\/)prompts?(?:\/|$)/.test(path) || /\.(?:prompt(?:\.md)?|prompty)$/.test(name) ||
      /(?:^|\/)\.claude\/commands(?:\/|$)/.test(path) || /(?:^|\/)system[-_. ]prompt(?:s)?(?:\.[^/]*)?$/.test(path)) return 'prompts'
  if (/^(?:\.mcp\.json|mcp\.json)$/.test(name) || /(?:^|\/)[^/]*mcp[^/]*\.(?:json|ya?ml|toml)$/.test(path) ||
      /(?:^|\/)\.claude\/(?:agents|hooks|plugins)(?:\/|$)/.test(path) || /(?:^|\/)\.husky(?:\/|$)/.test(path) ||
      /(?:^|\/)\.claude\/settings\.json$/.test(path) ||
      /(?:^|\/)\.github\/agents(?:\/|$)/.test(path) || /\.agent\.md$/.test(name) ||
      /(?:^|\/)\.claude-plugin(?:\/|$)/.test(path) || /(?:^|\/)hooks\/(?:.*\.)?(?:json|ya?ml)$/.test(path)) return 'tools'
  if (/(?:^|\/)(?:tests?|__tests?__|__mocks__|mocks?|__fixtures__|fixtures|e2e|integration[-_]tests?|integration_test|androidtest|testfixtures|testdata|test[-_]data|testing|cypress|playwright)\//.test(path) ||
  /(?:^|\/)[^/]+\.tests?\//.test(path) ||
      /[._-](?:test|tests|spec|specs|e2e|e2e-spec|unittest|unittests|integration-test|it)\.[^/]+$/.test(name) ||
      /\.cy\.[cm]?[jt]sx?$/.test(name) || /\.test-d\.[cm]?tsx?$/.test(name) ||
      /\.bats$/.test(name) || /(?:^|\/)[^/]+\.t$/.test(path) ||
      /(?:^|\/)test_[^/]+$/.test(path) || /(?:^|\/)test-[^/]+\.r$/.test(path) ||
      /(?:^|\/)(?:conftest|tests?|spec_helper|rails_helper)\.(?:py|rb)$/.test(path) ||
      /\.(?:test|tests|spec|specs|suite|integrationtest|testcase)\.(?:java|kt|kts|scala|groovy|cs|fs|vb|swift|m|mm|php|dart|hs|cpp|cc|cxx|h|hpp)$/.test(name) ||
      /(?:test|tests|spec|specs|suite|integrationtest|testcase)\.(?:java|kt|kts|scala|groovy|cs|fs|vb|swift|m|mm|php|dart|hs|cpp|cc|cxx|h|hpp)$/.test(name) ||
      /(?:^|\/)specs?\//.test(path) && !/\.(?:ya?ml|json|xml|graphql|proto|csv)$/.test(name)) return 'tests'
  if (/^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lock(?:b)?|deno\.lock|cargo\.(?:toml|lock)|go\.(?:mod|sum)|pyproject\.toml|requirements(?:[-_.][^/]*)?\.txt|constraints(?:[-_.][^/]*)?\.txt|pipfile(?:\.lock)?|poetry\.lock|uv\.lock|gemfile(?:\.lock)?|composer\.(?:json|lock)|mix\.exs|mix\.lock|gradle\.lockfile|pom\.xml|packages\.lock\.json)$/.test(name)) return 'dependencies'
  if (/^(?:\.github|\.circleci|\.husky|\.buildkite|\.devcontainer|config|configs|build|scripts\/config)(?:\/|$)/.test(path) ||
      /^(?:\.editorconfig|\.gitattributes|\.gitignore|\.dockerignore|\.npmrc|\.nvmrc|\.env(?:\.[^/]*)?|\.prettierrc(?:\.[^/]+)?|\.eslintrc(?:\.[^/]+)?|\.tool-versions|\.ruby-version|\.python-version|dockerfile|makefile|justfile|astro\.config\.[^/]+|vite\.config\.[^/]+|tsconfig(?:\.[^/]+)?\.json|biome\.jsonc?)$/.test(name) ||
      name.startsWith('.') && name.length > 1 ||
      /\.(?:ya?ml|toml|ini|conf|config|properties)$/.test(name) && !/(?:^|\/)(?:test|tests|eval|evals|fixtures?)\//.test(path)) return 'config'
  if (/(?:^|\/)(?:docs?|documentation|wiki|man|guides?)(?:\/|$)/.test(path) ||
      /^(?:readme|changelog|changes|contributing|license|licence|authors|notice|history|code_of_conduct|security|support|governance|maintainers|citation)(?:\.[^/]*)?$/.test(name) ||
      /\.(?:md|mdx|markdown|rst|adoc|asciidoc|txt|org|rdoc|textile|tex|pod|rmd)$/.test(name) &&
      !/^(?:requirements|constraints|robots|llms)\.txt$/.test(name)) return 'docs'
  return 'runtime'
}

function lineChanges(before: string, after: string): { added: number; removed: number; approximate: boolean } {
  const a = lines(before)
  const b = lines(after)
  if (a.length * b.length > 250_000) {
    let prefix = 0
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
    let suffix = 0
    while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++
    return { added: b.length - prefix - suffix, removed: a.length - prefix - suffix, approximate: true }
  }
  // ponytail: bounded LCS counts changed lines; oversized replacements use one contiguous range.
  const row = new Uint32Array(b.length + 1)
  for (const line of a) {
    let diagonal = 0
    for (let j = 1; j <= b.length; j++) {
      const previous = row[j]
      row[j] = line === b[j - 1] ? diagonal + 1 : Math.max(row[j], row[j - 1])
      diagonal = previous
    }
  }
  const matched = row[b.length]
  return { added: b.length - matched, removed: a.length - matched, approximate: false }
}

type ChangeSeed = { path: string; tool: string; added: number; removed: number }
type Pending = { key: string; label: string; source: string; tool: string; changes: ChangeSeed[]; approximate: boolean; invalid: boolean }

function patchChanges(value: unknown): { changes: ChangeSeed[]; invalid: boolean } {
  const patch = typeof value === 'string' ? value : text(object(value).input)
  const files = new Map<string, ChangeSeed>()
  let current: ChangeSeed | null = null
  for (const line of patch.split(/\r\n?|\n/)) {
    const header = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/)
    if (header) {
      current = { path: header[1].trim(), tool: 'apply_patch', added: 0, removed: 0 }
      files.set(current.path, current)
      continue
    }
    const destination = line.match(/^\*\*\* Move to: (.+)$/)
    if (destination && current) {
      files.delete(current.path)
      current.path = destination[1].trim()
      files.set(current.path, current)
      continue
    }
    if (!current || line.startsWith('*** ')) continue
    if (line.startsWith('+')) current.added++
    if (line.startsWith('-')) current.removed++
  }
  return { changes: [...files.values()], invalid: files.size === 0 }
}

function buildPending(source: string, session: string, name: string, rawInput: unknown, owner: Data): Pending {
  const input = object(rawInput)
  const tool = name
  let agent: string
  let label: string
  if (source === 'Copilot CLI') {
    const agentId = id(owner.agentId)
    const subagent = Boolean(agentId || id(object(owner.data).parentToolCallId))
    agent = `${source}:${session}:${subagent ? `subagent:${agentId || 'unknown'}` : 'main'}`
    label = subagent ? `Subagent${agentId ? ` · ${agentId}` : ' · identity unavailable'}` : 'Main agent'
  } else if (source === 'Claude Code') {
    const agentId = id(owner.agentId)
    const sidechain = owner.isSidechain === true
    const known = owner.isSidechain === true || owner.isSidechain === false
    agent = `${source}:${session}:${sidechain ? `subagent:${agentId || 'unknown'}` : known ? 'main' : 'unknown'}`
    label = sidechain ? `Subagent${agentId ? ` · ${agentId}` : ' · identity unavailable'}` :
      known ? 'Main agent' : 'Unknown attribution'
  } else {
    agent = `${source}:${session}:unknown`
    label = 'Unknown attribution'
  }
  const changes: ChangeSeed[] = []
  let invalid = false
  let approximate = false
  const add = (path: unknown, added: number, removed = 0) => {
    const file = text(path).trim()
    if (!file || file.length > 2048 || /[\u0000-\u001f\u007f]/.test(file)) { invalid = true; return }
    changes.push({ path: file, tool, added, removed })
  }
  if (name === 'edit' || name === 'Edit') {
    const delta = lineChanges(text(input.old_str ?? input.old_string), text(input.new_str ?? input.new_string))
    approximate = delta.approximate
    add(input.path ?? input.file_path, delta.added, delta.removed)
  } else if (name === 'create' || name === 'Write') {
    add(input.path ?? input.file_path, lines(text(input.file_text ?? input.content)).length)
  } else if (name === 'MultiEdit') {
    if (Array.isArray(input.edits)) for (const edit of input.edits) {
      const item = object(edit)
      const delta = lineChanges(text(item.old_string), text(item.new_string))
      approximate ||= delta.approximate
      add(input.file_path, delta.added, delta.removed)
    }
    else invalid = true
  } else if (name === 'NotebookEdit') {
    add(input.notebook_path, lines(text(input.new_source)).length)
  } else if (name === 'apply_patch') {
    const parsed = patchChanges(input.patch ?? input.input ?? input.arguments ?? rawInput)
    changes.push(...parsed.changes)
    invalid ||= parsed.invalid
  }
  return { key: agent, label, source: `${source} · session ${session.length > 12 ? session.slice(0, 8) : session}`, tool, changes, approximate, invalid }
}

export function parseEdits(input: string, fileIndex = 0): ImportedEdits {
  const result: ImportedEdits = { changes: [], failedCalls: 0, unconfirmedCalls: 0, sources: [], warnings: [] }
  const warn = (message: string) => { if (result.warnings.length < 20) result.warnings.push(message) }
  let source = ''
  let session = `log-${fileIndex + 1}`
  const recognizedSources = new Set<string>()
  const useSource = (name: string) => { source = name; recognizedSources.add(name) }
  const pending = new Map<string, Pending>()
  const agentNames = new Map<string, string>()
  let visited = 0
  const commit = (operation: Pending, success: boolean | null) => {
    if (success === false) { result.failedCalls++; return }
    if (success === null) { result.unconfirmedCalls++; return }
    if (operation.invalid) warn(`${operation.tool}: an edit input had no usable file path or patch.`)
    if (operation.approximate) warn('A large replacement used a contiguous-line estimate.')
    for (const change of operation.changes) result.changes.push({
      ...change, agent: operation.key, label: operation.label, source: operation.source,
      category: classifyPath(change.path),
    })
  }
  const accept = (value: unknown) => {
    if (++visited > 100_000) throw new Error('Import exceeds the 100,000-record limit.')
    const record = object(value)
    const data = object(record.data)
    const payload = object(record.payload)
    if (record.type === 'session.start') {
      useSource('Copilot CLI')
      session = id(data.sessionId) || session
    } else if (record.type === 'session_meta') {
      useSource('Codex CLI')
      session = id(payload.session_id ?? payload.id) || session
    } else if (record.type === 'turn_context') {
      useSource('Codex CLI')
    } else if (typeof record.sessionId === 'string' &&
        ['assistant', 'user', 'system', 'summary'].includes(String(record.type))) {
      useSource('Claude Code')
      session = id(record.sessionId) || session
    } else if (typeof record.type === 'string' &&
        /^(?:session|assistant|user|tool|subagent|permission|elicitation)[.]/.test(record.type)) {
      useSource('Copilot CLI')
    } else if (record.type === 'response_item') {
      useSource('Codex CLI')
    }

    if (record.type === 'subagent.started') {
      const name = text(data.agentDisplayName || data.agentName).trim()
      if (id(data.toolCallId) && name) agentNames.set(id(data.toolCallId), name.slice(0, 80))
    } else if (record.type === 'tool.execution_start' && data.toolName &&
        ['edit', 'create', 'apply_patch'].includes(String(data.toolName))) {
      const callId = id(data.toolCallId)
      if (!callId) { warn('Copilot edit call had no tool-call ID.'); return }
      pending.set(callId, buildPending('Copilot CLI', session, String(data.toolName), data.arguments, record))
    } else if (record.type === 'tool.execution_complete') {
      const operation = pending.get(id(data.toolCallId))
      if (operation) {
        commit(operation, data.success === false ? false : data.success === true ? true : null)
        pending.delete(id(data.toolCallId))
      }
    } else if (record.type === 'assistant' || record.type === 'user') {
      const content = object(record.message).content
      if (Array.isArray(content)) for (const item of content) {
        const block = object(item)
        if (block.type === 'tool_use' && typeof block.id === 'string') {
          const name = String(block.name ?? '')
          if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(name) && !pending.has(block.id)) {
            pending.set(block.id, buildPending('Claude Code', session, name, object(block.input), record))
          }
        } else if (block.type === 'tool_result') {
          const callId = id(block.tool_use_id)
          const operation = pending.get(callId)
          if (operation) {
            commit(operation, block.is_error === true ? false : true)
            pending.delete(callId)
          }
        }
      }
    } else if (record.type === 'response_item' &&
        /^(?:function|custom_tool)_call$/.test(String(payload.type)) && payload.name === 'apply_patch') {
      const callId = id(payload.call_id)
      if (callId) pending.set(callId, buildPending('Codex CLI', session, 'apply_patch', {
        input: payload.input ?? payload.arguments,
      }, record))
    } else if (record.type === 'response_item' &&
        /^(?:function|custom_tool)_call_output$/.test(String(payload.type))) {
      const callId = id(payload.call_id)
      const operation = pending.get(callId)
      if (operation) {
        const output = text(payload.output)
        const exitCode = /exit[ _]code"?\s*:\s*(-?\d+)/i.exec(output)?.[1]
        const success = typeof payload.success === 'boolean' ? payload.success :
          exitCode !== undefined ? exitCode === '0' :
          /^\s*Success\b/.test(output) ? true :
          /\b(?:error:|failed\b|invalid patch\b)/i.test(output) ? false : null
        commit(operation, success)
        pending.delete(callId)
      }
    }
  }
  const raw = input.replace(/^\uFEFF/, '').trim()
  if (!raw) throw new Error('The file is empty.')
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) parsed.forEach(accept)
    else accept(parsed)
  } catch (error) {
    if (error instanceof Error && /100,000-record/.test(error.message)) throw error
    if (raw.startsWith('[')) throw new Error('Invalid JSON array.')
    for (const [index, line] of raw.split(/\r?\n/).entries()) {
      if (!line.trim()) continue
      try { accept(JSON.parse(line)) } catch (lineError) {
        if (lineError instanceof Error && /100,000-record/.test(lineError.message)) throw lineError
        warn(`Line ${index + 1}: invalid JSON.`)
      }
    }
  }
  if (!source) throw new Error('No supported Copilot CLI, Claude Code, or Codex session records found.')
  result.sources.push(...recognizedSources)
  for (const [callId, operation] of pending) {
    commit(operation, null)
    pending.delete(callId)
  }
  for (const change of result.changes) {
    const agentId = /^Copilot CLI:.*?:subagent:(.+)$/.exec(change.agent)?.[1]
    const name = agentId && agentNames.get(agentId)
    if (name) change.label = `${name} · ${agentId.slice(-6)}`
  }
  return result
}

export function analyzeEdits(imports: ImportedEdits[]): EditAnalysis {
  const agents = new Map<string, { key: string; label: string; source: string; changes: EditChange[] }>()
  const allChanges: EditChange[] = []
  const warnings: string[] = []
  const sources: string[] = []
  let failedCalls = 0
  let unconfirmedCalls = 0
  for (const imported of imports) {
    allChanges.push(...imported.changes)
    failedCalls += imported.failedCalls
    unconfirmedCalls += imported.unconfirmedCalls
    for (const source of imported.sources) if (!sources.includes(source)) sources.push(source)
    for (const warning of imported.warnings) if (warnings.length < 20 && !warnings.includes(warning)) warnings.push(warning)
  }
  for (const change of allChanges) {
    let agent = agents.get(change.agent)
    if (!agent) {
      agent = { key: change.agent, label: change.label, source: change.source, changes: [] }
      agents.set(change.agent, agent)
    }
    agent.changes.push(change)
  }
  const output = [...agents.values()].map(({ key, label, source, changes }) => {
    const fileMap = new Map<string, EditChange>()
    for (const change of changes) {
      const fileKey = `${change.category}:${change.path}`
      const previous = fileMap.get(fileKey)
      if (previous) {
        previous.added += change.added
        previous.removed += change.removed
        previous.tool = previous.tool === change.tool ? change.tool : 'multiple tools'
      } else fileMap.set(fileKey, { ...change })
    }
    const files = [...fileMap.values()]
    const groups = categories.flatMap((category) => {
      const entries = files.filter((file) => file.category === category.id)
      return entries.length ? [{
        ...category, added: entries.reduce((sum, file) => sum + file.added, 0),
        removed: entries.reduce((sum, file) => sum + file.removed, 0), files: entries.length, changes: entries,
      }] : []
    })
    return {
      key, label, source,
      added: files.reduce((sum, file) => sum + file.added, 0),
      removed: files.reduce((sum, file) => sum + file.removed, 0),
      filesEdited: files.length, categories: groups,
    }
  }).sort((a, b) => a.label.localeCompare(b.label))
  return {
    agents: output,
    added: output.reduce((sum, agent) => sum + agent.added, 0),
    removed: output.reduce((sum, agent) => sum + agent.removed, 0),
    filesEdited: new Set(allChanges.map((change) => change.path)).size,
    failedCalls, unconfirmedCalls, sources, warnings,
  }
}

export function summarizeCategories(agents: EditAnalysis['agents']): CategorySummary[] {
  const grouped = new Map<CategoryId, CategorySummary & { paths: Set<string> }>()
  for (const agent of agents) for (const category of agent.categories) {
    let summary = grouped.get(category.id)
    if (!summary) {
      summary = { ...category, added: 0, removed: 0, files: 0, changes: [], paths: new Set() }
      grouped.set(category.id, summary)
    }
    summary.added += category.added
    summary.removed += category.removed
    for (const change of category.changes) {
      summary.paths.add(change.path)
      summary.changes.push(change)
    }
  }
  return categories.flatMap(({ id }) => {
    const summary = grouped.get(id)
    if (!summary) return []
    const { paths, ...category } = summary
    return [{ ...category, files: paths.size }]
  })
}

/** Splits after each path separator so the UI can wrap between segments instead of inside them. */
export const pathParts = (path: string) => path.match(/[^\\/]*[\\/]|[^\\/]+$/g) ?? [path]

export const demoEdits = [
  { type: 'session.start', data: { sessionId: 'copilot-demo' } },
  { type: 'tool.execution_start', data: { toolCallId: 'main-1', toolName: 'edit', arguments: { path: 'src/agent.ts', old_str: 'const run = false\n', new_str: 'const run = true\n' } } },
  { type: 'tool.execution_complete', data: { toolCallId: 'main-1', success: true } },
  { type: 'subagent.started', data: { toolCallId: 'call_e7a1f9', agentName: 'general-purpose', agentDisplayName: 'General Purpose Agent' } },
  { type: 'tool.execution_start', agentId: 'call_e7a1f9', data: { toolCallId: 'sub-1', toolName: 'create', arguments: { path: 'evals/answer.eval.json', file_text: '{\n  "expected": "42"\n}\n' } } },
  { type: 'tool.execution_complete', data: { toolCallId: 'sub-1', success: true } },
  { type: 'assistant', sessionId: 'claude-demo', isSidechain: false, message: { content: [
    { type: 'tool_use', id: 'claude-1', name: 'Edit', input: { file_path: '.github/copilot-instructions.md', old_string: 'Be concise.\n', new_string: 'Be clear and concise.\n' } },
  ] } },
  { type: 'user', sessionId: 'claude-demo', message: { content: [
    { type: 'tool_result', tool_use_id: 'claude-1', is_error: false },
  ] } },
  { type: 'session_meta', payload: { id: 'codex-demo' } },
  { type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'codex-1', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: tests/agent.test.ts\n@@\n-old assertion\n+new assertion\n*** End Patch' } },
  { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'codex-1', output: 'Success' } },
].map((record) => JSON.stringify(record)).join('\n')
