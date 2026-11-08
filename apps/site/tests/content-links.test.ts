import { expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import inventory from '../src/data/content-links.json'
import { checkContentLinks } from '../scripts/check-content-links.mjs'

test('content links report gaps and reject invalid, missing or non-reciprocal pairs', () => {
  const labs = [{ slug: 'token-diet', writing: 'agent-diet' }, { slug: 'universe/passport' }]
  expect(checkContentLinks(labs, [{ slug: 'agent-diet', lab: 'token-diet' }])).toEqual({
    errors: [], gaps: ['lab:universe/passport has no writing'],
  })
  expect(checkContentLinks(labs, []).errors).toHaveLength(1)
  expect(checkContentLinks(labs, [{ slug: 'agent-diet' }]).errors).toHaveLength(1)
  expect(checkContentLinks([{ slug: '../escape', writing: 'https://example.com' }], []).errors.length).toBeGreaterThan(0)
  expect(checkContentLinks([{ slug: 'valid', writing: '../escape' }], []).errors.length).toBeGreaterThan(0)
  expect(checkContentLinks([{ slug: 'same' }, { slug: 'same' }], []).errors).toHaveLength(1)
  expect(checkContentLinks([], undefined).errors).toHaveLength(1)
  expect(checkContentLinks([{ slug: 123 }], []).errors).toHaveLength(1)
  const routes = readdirSync('src/pages', { recursive: true })
    .filter((path) => typeof path === 'string' && path.endsWith('.astro') && !['index.astro', '404.astro'].includes(path))
    .map((path) => String(path).replace(/\.astro$/, ''))
  expect(inventory.labs.map((lab) => lab.slug).sort()).toEqual(routes.sort())
  for (const lab of inventory.labs) {
    const metadata: { slug: string; writing?: string } = lab
    if (metadata.writing !== undefined) expect(metadata.writing).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  }
})
