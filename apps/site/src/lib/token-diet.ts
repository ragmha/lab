// Math for the token-diet experiment, shared by the page, its animation and the tests.

// Order matters: it is the left-to-right order of segments inside each call block.
export const kinds = ['cacheRead', 'cacheWrite', 'fresh', 'output'] as const
export type Kind = (typeof kinds)[number]
export type Tokens = Record<Kind, number>

export interface Tool {
  name: string
  ok: boolean
  label: string
  outTokens: number
}

export interface Call extends Tokens {
  ms: number
  tools: Tool[]
}

export interface Run {
  id: string
  variant: string
  rep: number
  ranAt: string
  success: boolean
  committed: boolean
  subjectOk: boolean
  testsPass: boolean
  testsChanged: boolean
  subjects: string[]
  wallMs: number
  nanoAiu: number
  totals: Tokens
  skills: number
  hookChars: number
  proseChars: number
  argChars: number
  testRuns: number
  testRunsUnpiped: number
  rtk: { commands: number; input: number; output: number; saved: number } | null
  calls: Call[]
}

export const total = (tokens: Tokens) => kinds.reduce((sum, kind) => sum + tokens[kind], 0)

/** The instructions file the principles setups installed, rebuilt from the published list. */
export const instructions = (principles: string[]) =>
  `# Working principles\n\n${principles.map((principle) => `- ${principle}`).join('\n')}\n`

/** Charge in nano-AIU: tokens of each kind times that kind's rate. */
export const cost = (tokens: Tokens, rates: Tokens) =>
  kinds.reduce((sum, kind) => sum + tokens[kind] * rates[kind], 0)

export function median(values: number[]) {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** The run with the median token total; the lower middle when the count is even, so it is always a real run. */
export function medianRun<T extends { totals: Tokens }>(runs: T[]) {
  const sorted = [...runs].sort((a, b) => total(a.totals) - total(b.totals))
  return sorted[(sorted.length - 1) >> 1]
}

/** What a playhead `at` tokens along a run has passed: tokens by kind, and how many calls it has entered. */
export function reveal(calls: Tokens[], at: number) {
  const tokens: Tokens = { cacheRead: 0, cacheWrite: 0, fresh: 0, output: 0 }
  let left = Math.max(0, at)
  let started = 0
  for (const call of calls) {
    if (left <= 0) break
    started++
    for (const kind of kinds) {
      const taken = Math.min(left, call[kind])
      tokens[kind] += taken
      left -= taken
    }
  }
  return { tokens, calls: started }
}

/** Pearson correlation coefficient. */
export function correlation(xs: number[], ys: number[]) {
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
  const mx = mean(xs)
  const my = mean(ys)
  let xy = 0
  let xx = 0
  let yy = 0
  xs.forEach((x, i) => {
    xy += (x - mx) * (ys[i] - my)
    xx += (x - mx) ** 2
    yy += (ys[i] - my) ** 2
  })
  return xy / Math.sqrt(xx * yy)
}
