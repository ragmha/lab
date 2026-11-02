import { downloadProgress, emptyProgress, importProgress, mergeProgress, progressKey, readStoredProgress, transferLimit } from '../data/universe-progress.mjs'
const articles = [...document.querySelectorAll<HTMLElement>('[data-lesson]')]
const checks = [...document.querySelectorAll<HTMLInputElement>('[data-complete]')]
const progress = document.querySelector<HTMLProgressElement>('#guide-progress')!
const progressLabel = document.querySelector<HTMLElement>('#progress-label')!
const storageStatus = document.querySelector<HTMLElement>('#storage-status')!
const reset = document.querySelector<HTMLButtonElement>('#reset-progress')!
const storageKey = progressKey
let passport = emptyProgress()
let canStore = true

function storageError(message: string) {
  canStore = false
  storageStatus.textContent = `${message} Progress works for this tab only; it will not survive a reload.`
}

try {
  passport = readStoredProgress(localStorage.getItem(storageKey), articles.length)
  // Test writes too: some browsers allow reads but reject storage writes.
  localStorage.setItem(storageKey, JSON.stringify(passport))
} catch {
  storageError('Saved progress is unavailable or unreadable.')
}

function updateProgress() {
  const completed = Object.keys(passport.stamps).map(Number)
  checks.forEach((check) => { check.checked = completed.includes(Number(check.dataset.complete)) })
  document.querySelectorAll<HTMLElement>('.lesson-nav [data-lesson-link]').forEach((link) => {
    const marker = link.querySelector<HTMLElement>('.nav-done')!
    marker.hidden = !completed.includes(Number(link.dataset.lessonLink))
  })
  progress.value = completed.length
  progressLabel.textContent = `${completed.length} of ${articles.length} lessons complete`
  reset.disabled = completed.length === 0
}

function saveProgress() {
  if (canStore) {
    try { localStorage.setItem(storageKey, JSON.stringify(passport)) }
    catch { storageError('This browser could not save progress.') }
  }
  updateProgress()
}

checks.forEach((check) => {
  check.disabled = false
  check.addEventListener('change', () => {
    const index = Number(check.dataset.complete)
    if (check.checked) passport.stamps[index] = { route: 'recorded', at: new Date().toISOString() }
    else delete passport.stamps[index]
    saveProgress()
  })
})
reset.addEventListener('click', () => {
  if (window.confirm('Reset the completed lessons in this browser?')) {
    passport = emptyProgress()
    saveProgress()
  }
})
updateProgress()

window.addEventListener('storage', (event) => {
  if (event.key !== storageKey || !canStore) return
  try {
    passport = readStoredProgress(event.newValue, articles.length)
    updateProgress()
  } catch { storageError('Another tab changed progress to an unreadable value.') }
})

const exportButton = document.querySelector<HTMLButtonElement>('#export-progress')!
const importFile = document.querySelector<HTMLInputElement>('#import-progress')!
const transferStatus = document.querySelector<HTMLElement>('#transfer-status')!
exportButton.disabled = importFile.disabled = false
exportButton.addEventListener('click', () => {
  try {
    downloadProgress(passport)
    transferStatus.textContent = 'Export requested. Import the JSON file in the other surface.'
  } catch (error) { transferStatus.textContent = `Export failed. ${error instanceof Error ? error.message : String(error)}` }
})
importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0]
  if (!file) return
  try {
    if (file.size > transferLimit) throw new Error('Progress file is too large (maximum 16 KB).')
    const incoming = importProgress(await file.text(), articles.length)
    passport = mergeProgress(passport, incoming)
    saveProgress()
    transferStatus.textContent = canStore
      ? 'Progress imported. Existing stamps were kept.'
      : 'Imported in this tab only. Export before leaving; browser storage is unavailable.'
  } catch (error) { transferStatus.textContent = `Import failed. ${error instanceof Error ? error.message : String(error)}` }
  finally { importFile.value = '' }
})

function showLesson(focus = false) {
  const match = /^#lesson-(\d+)$/.exec(location.hash)
  const index = match ? Number(match[1]) : 0
  if (index >= articles.length) return
  articles.forEach((article, position) => { article.hidden = position !== index })
  document.querySelectorAll<HTMLElement>('.lesson-nav [data-lesson-link]').forEach((link) => {
    if (Number(link.dataset.lessonLink) === index) link.setAttribute('aria-current', 'step')
    else link.removeAttribute('aria-current')
  })
  if (focus) {
    const content = document.querySelector<HTMLElement>('#lesson-content')!
    content.focus({ preventScroll: true })
    content.scrollIntoView({ block: 'start', behavior: 'instant' })
  }
}
showLesson()
document.querySelectorAll<HTMLAnchorElement>('[data-lesson-link]').forEach((link) => {
  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (location.hash !== link.hash) history.pushState(null, '', link.hash)
    showLesson(true)
  })
})
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#lesson-')) showLesson(true)
  openLinkedLab()
})
function openLinkedLab() {
  const target = document.getElementById(location.hash.slice(1))
  if (target instanceof HTMLDetailsElement && target.classList.contains('field-lab')) {
    target.open = true
    target.querySelector('summary')?.focus()
  }
}
openLinkedLab()

const copyStatus = document.querySelector<HTMLElement>('#copy-status')!
document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((button) => {
  button.disabled = false
  button.addEventListener('click', async () => {
    const prompt = document.getElementById(`prompt-${button.dataset.copy}`)!
    button.disabled = true
    try {
      await navigator.clipboard.writeText(prompt.textContent ?? '')
      copyStatus.textContent = 'Prompt copied. Review permissions and credits before running it.'
    } catch {
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(prompt)
      selection?.removeAllRanges()
      selection?.addRange(range)
      copyStatus.textContent = 'Clipboard unavailable. The prompt is selected; copy it manually.'
    } finally { button.disabled = false }
  })
})

const search = document.querySelector<HTMLInputElement>('#release-search')!
const group = document.querySelector<HTMLSelectElement>('#release-group')!
const status = document.querySelector<HTMLSelectElement>('#release-status')!
const clear = document.querySelector<HTMLButtonElement>('#clear-filters')!
const releases = [...document.querySelectorAll<HTMLElement>('.release')]
const count = document.querySelector<HTMLElement>('#result-count')!
const empty = document.querySelector<HTMLElement>('#empty-results')!
function filter() {
  const query = search.value.trim().toLocaleLowerCase()
  let visible = 0
  releases.forEach((release) => {
    const matches = (!query || release.textContent?.toLocaleLowerCase().includes(query))
      && (!group.value || release.dataset.group === group.value)
      && (!status.value || release.dataset.status === status.value)
    release.hidden = !matches
    if (matches) visible++
  })
  count.textContent = `${visible} of ${releases.length} announcements`
  empty.hidden = visible !== 0
}
for (const control of [search, group, status, clear]) control.disabled = false
search.addEventListener('input', filter)
group.addEventListener('change', filter)
status.addEventListener('change', filter)
clear.addEventListener('click', () => {
  search.value = ''
  group.value = ''
  status.value = ''
  filter()
  search.focus()
})
