import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import { applyProgress, emptyProgress, readProgress, roundSize } from '../../../src/data/universe-progress.mjs'

export { roundSize }

export class PassportError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
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
        if (error.code === 'ENOENT') return emptyProgress()
        throw error
      }
      try {
        return readProgress(JSON.parse(raw), lessonCount)
      } catch (error) {
        if (!(error instanceof Error)) throw error
      }
      // Never overwrite progress we cannot read; set it aside where the user can recover it.
      const aside = `${file}.unreadable-${Date.now()}`
      await rename(file, aside)
      store.notice = `Saved progress could not be read, so it was moved to ${aside}. This passport starts empty.`
      return emptyProgress()
    },
    // Changes apply in order to the file's current contents, so two open panels cannot erase each other's stamps.
    update(command) {
      const run = queue.then(async () => {
        const current = await store.read()
        let next
        try { next = applyProgress(current, command, lessonCount) }
        catch (error) { throw new PassportError(command?.type === 'import' ? 'invalid_import' : 'invalid_command', error.message) }
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
