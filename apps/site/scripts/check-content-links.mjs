import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import inventory from '../src/data/content-links.json' with { type: 'json' }

const writingSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const labSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/

export function checkContentLinks(labs, writings) {
  const errors = []
  const gaps = []
  for (const [name, entries, slugPattern, target, targetPattern] of [
    ['lab', labs, labSlug, 'writing', writingSlug],
    ['writing', writings, writingSlug, 'lab', labSlug],
  ]) {
    if (!Array.isArray(entries)) {
      errors.push(`Missing ${name} inventory array`)
      continue
    }
    const seen = new Set()
    for (const entry of entries) {
      if (!entry || typeof entry.slug !== 'string' || !slugPattern.test(entry.slug) || seen.has(entry.slug)) {
        errors.push(`Invalid or duplicate ${name} slug: ${entry?.slug}`)
        continue
      }
      seen.add(entry.slug)
      if (entry[target] === undefined) gaps.push(`${name}:${entry.slug} has no ${target}`)
      else if (typeof entry[target] !== 'string' || !targetPattern.test(entry[target])) {
        errors.push(`Invalid ${target} on ${name}:${entry.slug}`)
      }
    }
  }
  for (const [entries, targets, field, reciprocal] of [
    [labs, writings, 'writing', 'lab'],
    [writings, labs, 'lab', 'writing'],
  ]) {
    if (!Array.isArray(entries) || !Array.isArray(targets)) continue
    for (const entry of entries) {
      if (!entry?.[field]) continue
      const match = targets.find((target) => target?.slug === entry[field])
      if (!match) errors.push(`${entry.slug}: missing ${field}:${entry[field]}`)
      else if (match[reciprocal] !== entry.slug) errors.push(`${entry.slug}: ${entry[field]} does not link back`)
    }
  }
  return { errors, gaps }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const source = process.argv[2] ?? 'https://raghib.io/content-links.json'
    let remote
    if (source.startsWith('https://')) {
      const response = await fetch(source, { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error(`Writing inventory returned HTTP ${response.status}`)
      remote = await response.json()
    } else {
      remote = JSON.parse(await readFile(source, 'utf8'))
    }
    const result = checkContentLinks(inventory.labs, remote.writings)
    for (const gap of result.gaps) console.log(`GAP ${gap}`)
    for (const error of result.errors) console.error(`ERROR ${error}`)
    console.log(`${result.errors.length} errors; ${result.gaps.length} editorial gaps`)
    if (result.errors.length) process.exitCode = 1
  } catch (error) {
    console.error(`Content link check failed: ${error.message}`)
    process.exitCode = 1
  }
}
