// Progressive enhancement only — the page is fully readable with JS disabled.
const root = document.documentElement
const currentTheme = () => (root.dataset.theme === 'dark' ? 'dark' : 'light')
let hasThemeChoice = false

/* ------------------------------------------------------------- theme */

const toggle = document.getElementById('theme-toggle')
const label = toggle?.querySelector('[data-theme-label]')

function paintToggle() {
  if (!toggle || !label) return
  const next = currentTheme() === 'dark' ? 'light' : 'dark'
  label.textContent = next.toUpperCase()
  toggle.setAttribute('aria-label', `Switch to ${next} mode`)
  toggle.title = `Switch to ${next} mode`
  toggle.hidden = false
}

function setTheme(theme) {
  hasThemeChoice = true
  root.dataset.theme = theme
  try {
    localStorage.setItem('theme', theme)
  } catch {
    // Storage may be unavailable (private mode); theme still applies for
    // this page load.
  }
  paintToggle()
}

paintToggle()
toggle?.addEventListener('click', () =>
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark')
)

// Follow the OS only while the visitor has not made an explicit choice.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (root.dataset.themeDefault === 'dark' || hasThemeChoice) return
  let saved = null
  try {
    saved = localStorage.getItem('theme')
  } catch {
    // Ignore storage access errors.
  }
  if (saved !== 'dark' && saved !== 'light') {
    root.dataset.theme = e.matches ? 'dark' : 'light'
    paintToggle()
  }
})
