// @ts-check
/** @typedef {{route: 'exercise' | 'practice' | 'recorded', at: string}} Stamp */
/** @typedef {{stamps: Record<string, Stamp>, bestRound: {score: number, total: number, at: string} | null}} Progress */
export const transferLimit = 16384
export const roundSize = 8
export const progressKey = 'universe-2026-progress-v1'
/** @returns {Progress} */
export const emptyProgress = () => ({ stamps: {}, bestRound: null })
/** @param {unknown} value @returns {value is Record<string, unknown>} */
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
/** @param {unknown} value @returns {value is string} */
const time = (value) => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))

/** @param {unknown} value @param {number} count @returns {Progress} */
export function readProgress(value, count) {
  if (!record(value) || !record(value.stamps)) throw new Error('Invalid passport progress.')
  const result = emptyProgress()
  for (const [key, stamp] of Object.entries(value.stamps)) {
    if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= count || !record(stamp)
      || typeof stamp.route !== 'string' || !['exercise', 'practice', 'recorded'].includes(stamp.route) || !time(stamp.at)) {
      throw new Error('Invalid lesson stamp. No progress was imported.')
    }
    if (stamp.route === 'exercise' || stamp.route === 'practice' || stamp.route === 'recorded') {
      result.stamps[key] = { route: stamp.route, at: stamp.at }
    }
  }
  const best = value.bestRound
  if (best !== null) {
    if (!record(best) || typeof best.score !== 'number' || !Number.isInteger(best.score)
      || best.score < 0 || best.score > roundSize || best.total !== roundSize || !time(best.at)) {
      throw new Error('Invalid status-round result. No progress was imported.')
    }
    result.bestRound = { score: best.score, total: roundSize, at: best.at }
  }
  return result
}

/** @param {Progress} current @param {Progress} incoming @returns {Progress} */
export function mergeProgress(current, incoming) {
  // Keep the destination's route/date when both sides already contain a stamp.
  return {
    stamps: { ...incoming.stamps, ...current.stamps },
    bestRound: incoming.bestRound && (!current.bestRound || incoming.bestRound.score > current.bestRound.score)
      ? incoming.bestRound : current.bestRound,
  }
}

/** @param {Progress} progress */
export function exportProgress(progress) {
  return JSON.stringify({ format: 'universe-passport', version: 1, progress }, null, 2)
}

/** @param {Progress} progress */
export function downloadProgress(progress) {
  const url = URL.createObjectURL(new Blob([exportProgress(progress)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'universe-passport-progress.json'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** @param {string} text @param {number} count */
export function importProgress(text, count) {
  if (text.length > transferLimit) throw new Error('Progress file is too large (maximum 16 KB).')
  let value
  try { value = JSON.parse(text) } catch { throw new Error('Choose a valid Universe Passport JSON export.') }
  if (!record(value) || value.format !== 'universe-passport' || value.version !== 1) {
    throw new Error('This is not a supported Universe Passport export.')
  }
  return readProgress(value.progress, count)
}

/** @param {string | null} raw @param {number} count @returns {Progress} */
export function readStoredProgress(raw, count) {
  if (raw === null) return emptyProgress()
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) return readProgress(parsed, count)
  if (!parsed.every((step) => Number.isInteger(step) && step >= 0 && step < count)) throw new Error('Invalid saved progress.')
  const progress = emptyProgress()
  for (const step of parsed) progress.stamps[step] = { route: 'recorded', at: new Date().toISOString() }
  return progress
}

/** @param {Progress} current @param {unknown} command @param {number} count @returns {Progress} */
export function applyProgress(current, command, count) {
  if (!record(command)) throw new Error('Invalid progress command.')
  if (command.type === 'import' && typeof command.text === 'string') {
    return mergeProgress(current, importProgress(command.text, count))
  }
  const progress = readProgress(current, count)
  const at = new Date().toISOString()
  const lesson = command.lesson
  const known = typeof lesson === 'number' && Number.isInteger(lesson) && lesson >= 0 && lesson < count
  if (command.type === 'stamp' && known && (command.route === 'exercise' || command.route === 'practice')) {
    progress.stamps[lesson] = { route: command.route, at }
  } else if (command.type === 'unstamp' && known) {
    delete progress.stamps[lesson]
  } else if (command.type === 'round' && typeof command.score === 'number' && Number.isInteger(command.score)
    && command.score >= 0 && command.score <= roundSize) {
    if (!progress.bestRound || command.score > progress.bestRound.score) {
      progress.bestRound = { score: command.score, total: roundSize, at }
    }
  } else throw new Error('That progress change is not valid. Reload and retry.')
  return progress
}
