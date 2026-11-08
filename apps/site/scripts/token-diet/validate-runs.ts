export function assertCompleteRuns(runs: { variant: string }[], requireOptimizer: boolean) {
  const variants = requireOptimizer || runs.some((run) => run.variant === 'f') ? 'abcdef' : 'abcde'
  for (const variant of variants) {
    const count = runs.filter((run) => run.variant === variant).length
    if (count !== 5) throw new Error(`expected five runs for setup ${variant}, found ${count}`)
  }
  if (runs.length !== variants.length * 5) throw new Error('dataset contains unexpected setups')
}
