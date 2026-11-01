import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname } from 'node:path'

export const roundSize = 8
const routes = ['exercise', 'practice']

export class PassportError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

const isTime = (value) => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value))

function isProgress(value, lessonCount) {
  if (!value?.stamps || typeof value.stamps !== 'object' || Array.isArray(value.stamps)) return false
  const best = value.bestRound
  return Object.entries(value.stamps).every(([key, stamp]) =>
    /^\d+$/.test(key) && Number(key) < lessonCount && routes.includes(stamp?.route) && isTime(stamp.at))
    && (best === null || (Number.isInteger(best?.score) && best.score >= 0 && best.score <= roundSize
      && best.total === roundSize && isTime(best.at)))
}

function apply(progress, command, lessonCount) {
  const at = new Date().toISOString()
  const lesson = command?.lesson
  const known = Number.isInteger(lesson) && lesson >= 0 && lesson < lessonCount
  if (command?.type === 'stamp' && known && routes.includes(command.route)) {
    progress.stamps[lesson] = { route: command.route, at }
  } else if (command?.type === 'unstamp' && known) {
    delete progress.stamps[lesson]
  } else if (command?.type === 'round' && Number.isInteger(command.score) && command.score >= 0 && command.score <= roundSize) {
    if (!progress.bestRound || command.score > progress.bestRound.score) {
      progress.bestRound = { score: command.score, total: roundSize, at }
    }
  } else {
    throw new PassportError('invalid_command', 'That progress change is not valid. Reload the canvas and try again.')
  }
  return progress
}

export function createStore(file, lessonCount) {
  let queue = Promise.resolve()
  const store = {
    file,
    notice: null,
    // What the panel and the agent show; ~ keeps long paths readable in a narrow panel.
    get storage() {
      return { file: file.replace(homedir(), '~'), notice: store.notice && store.notice.replace(homedir(), '~') }
    },
    async read() {
      let raw
      try {
        raw = await readFile(file, 'utf8')
      } catch (error) {
        if (error.code === 'ENOENT') return { stamps: {}, bestRound: null }
        throw error
      }
      try {
        const progress = JSON.parse(raw)
        if (isProgress(progress, lessonCount)) return progress
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
      }
      // Never overwrite progress we cannot read; set it aside where the user can recover it.
      const aside = `${file}.unreadable-${Date.now()}`
      await rename(file, aside)
      store.notice = `Saved progress could not be read, so it was moved to ${aside}. This passport starts empty.`
      return { stamps: {}, bestRound: null }
    },
    // Changes apply in order to the file's current contents, so two open panels cannot erase each other's stamps.
    update(command) {
      const run = queue.then(async () => {
        const next = apply(await store.read(), command, lessonCount)
        await mkdir(dirname(file), { recursive: true })
        const temp = `${file}.${process.pid}.tmp`
        await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`)
        await rename(temp, file)
        return next
      })
      queue = run.catch(() => {})
      return run
    },
  }
  return store
}
