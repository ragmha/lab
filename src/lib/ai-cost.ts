export type Row = { name: string; credits: number }

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

// Adds credits per name across lists, largest first.
export function combine(...lists: Row[][]): Row[] {
  const totals = new Map<string, number>()
  for (const row of lists.flat()) totals.set(row.name, (totals.get(row.name) ?? 0) + row.credits)
  return [...totals].map(([name, credits]) => ({ name, credits })).sort((a, b) => b.credits - a.credits)
}

// The `limit` largest rows that used credits, and how many used rows are left out.
export function topN(rows: Row[], limit: number) {
  const used = combine(rows).filter((row) => row.credits > 0)
  const top = used.slice(0, limit)
  return { top, hidden: used.length - top.length }
}

// A round axis maximum with evenly spaced ticks from zero, about `ticks` of them.
export function niceScale(max: number, ticks = 4) {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] }
  const raw = max / ticks
  const base = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((multiple) => multiple * base).find((candidate) => candidate >= raw)!
  const top = Math.ceil(max / step) * step
  return { max: top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) }
}

// Mean of the last `size` values against the `size` before them; undefined without two full windows.
export function windowDelta(values: number[], size = 7) {
  if (values.length < size * 2) return undefined
  const mean = (part: number[]) => sum(part) / size
  const current = mean(values.slice(-size))
  const previous = mean(values.slice(-size * 2, -size))
  return { current, previous, change: previous === 0 ? undefined : current / previous - 1 }
}
