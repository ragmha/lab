import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const initComponent = readFileSync(
  new URL('../src/components/ThemeInit.astro', import.meta.url),
  'utf8'
)
const initSource = initComponent.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const pageDefault = initComponent.match(/defaultTheme = '([^']+)'/)[1]
const controllerSource = readFileSync(
  new URL('../src/scripts/theme.js', import.meta.url),
  'utf8'
)

function createPage({
  defaultTheme = pageDefault,
  systemDark = false,
  saved = null,
  storageBlocked = false,
} = {}) {
  const root = { dataset: {} }
  const label = { textContent: '' }
  const attributes = {}
  let onClick
  let onSystemChange
  const toggle = {
    hidden: true,
    querySelector: () => label,
    setAttribute: (key, value) => { attributes[key] = value },
    addEventListener: (_, listener) => { onClick = listener },
  }
  const context = {
    defaultTheme,
    document: {
      documentElement: root,
      getElementById: () => toggle,
      querySelectorAll: () => [],
    },
    window: {
      matchMedia: () => ({
        matches: systemDark,
        addEventListener: (_, listener) => { onSystemChange = listener },
      }),
    },
    localStorage: {
      getItem: () => {
        if (storageBlocked) throw new Error('Storage blocked')
        return saved
      },
      setItem: (_, value) => {
        if (storageBlocked) throw new Error('Storage blocked')
        saved = value
      },
    },
  }
  runInNewContext(`${initSource}\n${controllerSource}`, context)
  return {
    root, label, toggle, attributes,
    click: () => onClick(),
    systemChange: (matches) => onSystemChange({ matches }),
    stored: () => saved,
  }
}

test('shared page default is dark regardless of OS and ignores OS changes', () => {
  assert.equal(pageDefault, 'dark')
  for (const systemDark of [false, true]) {
    const page = createPage({ systemDark })
    assert.equal(page.root.dataset.theme, 'dark')
    assert.equal(page.label.textContent, 'LIGHT')
    assert.equal(page.attributes['aria-label'], 'Switch to light mode')
    assert.equal(page.toggle.hidden, false)
    page.systemChange(false)
    assert.equal(page.root.dataset.theme, 'dark')
  }
})

test('saved choices take precedence on both Home and Writing', () => {
  for (const defaultTheme of ['dark', 'system']) {
    for (const saved of ['dark', 'light']) {
      const page = createPage({ defaultTheme, saved })
      page.systemChange(saved !== 'dark')
      assert.equal(page.root.dataset.theme, saved)
    }
  }
})

test('toggle updates the theme, accessible label, and persisted choice', () => {
  const page = createPage()
  page.click()
  assert.equal(page.root.dataset.theme, 'light')
  assert.equal(page.label.textContent, 'DARK')
  assert.equal(page.attributes['aria-label'], 'Switch to dark mode')
  assert.equal(page.stored(), 'light')
  assert.equal(createPage({ saved: page.stored() }).root.dataset.theme, 'light')
  page.click()
  assert.equal(page.root.dataset.theme, 'dark')
  assert.equal(page.stored(), 'dark')
})

test('explicit system mode follows the OS until the visitor makes a choice', () => {
  const page = createPage({ defaultTheme: 'system' })
  assert.equal(page.root.dataset.theme, 'light')
  page.systemChange(true)
  assert.equal(page.root.dataset.theme, 'dark')
  page.click()
  page.systemChange(true)
  assert.equal(page.root.dataset.theme, 'light')
})

test('blocked storage preserves page defaults and in-memory choices', () => {
  const home = createPage({ storageBlocked: true })
  assert.equal(home.root.dataset.theme, 'dark')
  home.click()
  assert.equal(home.root.dataset.theme, 'light')
  const writing = createPage({ defaultTheme: 'system', storageBlocked: true })
  writing.click()
  writing.systemChange(false)
  assert.equal(writing.root.dataset.theme, 'dark')
})

test('invalid saved values are ignored', () => {
  assert.equal(createPage({ saved: 'invalid' }).root.dataset.theme, 'dark')
  const writing = createPage({ defaultTheme: 'system', saved: 'invalid' })
  assert.equal(writing.root.dataset.theme, 'light')
  writing.systemChange(true)
  assert.equal(writing.root.dataset.theme, 'dark')
})
