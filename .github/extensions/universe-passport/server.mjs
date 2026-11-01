import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { lessons, releases, scope, sources, statusNote } from '../../../src/data/universe.mjs'
import { PassportError, roundSize } from './store.mjs'

const deck = 'universe-2026-starter.pptx'
const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.mjs': ['app.mjs', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  [`/downloads/${deck}`]: [`../../../public/downloads/${deck}`, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
}
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'"

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

async function readCommand(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) {
    throw new PassportError('invalid_content_type', 'Send progress changes as JSON.', 415)
  }
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 2048) throw new PassportError('request_too_large', 'That progress change is too large.', 413)
  }
  try {
    return JSON.parse(body)
  } catch {
    throw new PassportError('invalid_json', 'That progress change could not be read. Reload and retry.')
  }
}

export async function startServer(store, onError) {
  const token = randomBytes(32).toString('hex')
  const expectedAuth = Buffer.from(`Bearer ${token}`)
  let origin
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Security-Policy', csp)
    try {
      if (request.headers.host !== new URL(origin).host) {
        throw new PassportError('invalid_host', 'This canvas only answers on its own loopback address.', 403)
      }
      const { pathname } = new URL(request.url, origin)
      if (Object.hasOwn(files, pathname) && ['GET', 'HEAD'].includes(request.method)) {
        const [file, type] = files[pathname]
        const body = await readFile(new URL(file, import.meta.url))
        response.writeHead(200, {
          'Content-Type': type,
          'Content-Length': body.length,
          ...(pathname.startsWith('/downloads/') && { 'Content-Disposition': `attachment; filename="${deck}"` }),
        })
        response.end(request.method === 'HEAD' ? undefined : body)
        return
      }
      if (pathname === '/favicon.ico') {
        response.writeHead(204).end()
        return
      }
      if (!['/api/state', '/api/progress'].includes(pathname)) {
        throw new PassportError('not_found', 'This canvas route does not exist.', 404)
      }
      const providedAuth = Buffer.from(request.headers.authorization ?? '')
      if (providedAuth.length !== expectedAuth.length || !timingSafeEqual(providedAuth, expectedAuth)) {
        throw new PassportError('unauthorized', 'Reopen Universe Passport from Copilot to reconnect this panel.', 401)
      }
      if (request.headers.origin && request.headers.origin !== origin) {
        throw new PassportError('invalid_origin', 'Cross-site access to your passport is not allowed.', 403)
      }
      if (pathname === '/api/state' && request.method === 'GET') {
        const progress = await store.read()
        sendJson(response, 200, {
          lessons, releases, sources, scope, statusNote, roundSize, progress, storage: store.storage,
        })
      } else if (pathname === '/api/progress' && request.method === 'POST') {
        if (request.headers.origin !== origin) {
          throw new PassportError('invalid_origin', 'Open the canvas to change your passport.', 403)
        }
        sendJson(response, 200, { progress: await store.update(await readCommand(request)) })
      } else {
        throw new PassportError('method_not_allowed', 'This method is not supported for this route.', 405)
      }
    } catch (error) {
      if (!(error instanceof PassportError)) onError(error)
      if (response.headersSent || response.destroyed) return
      sendJson(response, error instanceof PassportError ? error.status : 500, {
        error: {
          code: error instanceof PassportError ? error.code : 'internal_error',
          message: error instanceof PassportError ? error.message : 'The passport could not load or save. Your last change was not stored; retry in a moment.',
        },
      })
    }
  })
  server.requestTimeout = 20000
  server.headersTimeout = 15000
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  origin = `http://127.0.0.1:${server.address().port}`
  server.on('error', onError)
  return {
    origin, token, url: `${origin}/?token=${token}`,
    close: async () => {
      server.closeIdleConnections()
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    },
  }
}
