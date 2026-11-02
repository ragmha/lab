import { homedir } from 'node:os'
import { join } from 'node:path'
import { joinSession, createCanvas } from '@github/copilot-sdk/extension'
import { lessons } from '../../../src/data/universe.mjs'
import { createStore } from './store.mjs'
import { startServer } from './server.mjs'

// Progress is personal, so it lives in the user's Copilot home rather than in the repository.
const store = createStore(
  join(process.env.COPILOT_HOME || join(homedir(), '.copilot'), 'extensions', 'universe-passport', 'artifacts', 'progress.json'),
  lessons.length,
)
const servers = new Map()

async function closeAll() {
  const entries = [...servers.values()]
  servers.clear()
  await Promise.allSettled(entries.map((entry) => entry.close()))
}

const session = await joinSession({
  canvases: [
    createCanvas({
      id: 'universe-passport',
      displayName: 'Universe Passport',
      description: 'Learn the GitHub Universe 2026 releases step by step with eight lesson stamps, a GA-or-preview status round, and a searchable release board; nothing runs from the canvas.',
      actions: [
        {
          name: 'get_progress',
          description: 'Read which Universe Passport lessons are stamped, the next lesson, and the best status-round score. Read-only.',
          inputSchema: { type: 'object', additionalProperties: false },
          handler: async () => {
            const progress = await store.read()
            const stamps = Object.entries(progress.stamps)
              .map(([step, stamp]) => ({ step: Number(step), title: lessons[Number(step)].title, ...stamp }))
              .sort((a, b) => a.step - b.step)
            const next = lessons.findIndex((_, step) => !progress.stamps[step])
            return {
              stamped: stamps.length,
              total: lessons.length,
              next: next === -1 ? null : { step: next, title: lessons[next].title, minutes: lessons[next].minutes },
              stamps,
              bestRound: progress.bestRound,
              storage: store.storage,
            }
          },
        },
      ],
      open: async (ctx) => {
        let entry = servers.get(ctx.instanceId)
        if (!entry) {
          entry = await startServer(store, (error) => session.log(`Universe Passport: ${error.message}`, { level: 'error' }))
          servers.set(ctx.instanceId, entry)
        }
        return { title: 'Universe Passport', url: entry.url, status: 'Progress saved on this computer' }
      },
      onClose: async (ctx) => {
        const entry = servers.get(ctx.instanceId)
        if (entry) {
          servers.delete(ctx.instanceId)
          await entry.close()
        }
      },
    }),
  ],
})

async function shutdown() {
  await closeAll()
  process.exit(0)
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
process.once('disconnect', shutdown)
