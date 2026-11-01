export {}
const articles = [...document.querySelectorAll<HTMLElement>('[data-lesson]')]
const checks = [...document.querySelectorAll<HTMLInputElement>('[data-complete]')]
const progress = document.querySelector<HTMLProgressElement>('#guide-progress')!
const progressLabel = document.querySelector<HTMLElement>('#progress-label')!
const storageStatus = document.querySelector<HTMLElement>('#storage-status')!
const reset = document.querySelector<HTMLButtonElement>('#reset-progress')!
const storageKey = 'universe-2026-progress-v1'
let completed: number[] = []
let canStore = true

function storageError(message: string) {
  canStore = false
  storageStatus.textContent = `${message} Progress works for this tab only; it will not survive a reload.`
}

try {
  const raw = localStorage.getItem(storageKey)
  if (raw !== null) {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every((value) => Number.isInteger(value) && value >= 0 && value < articles.length)) {
      throw new Error('Invalid progress data')
    }
    completed = [...new Set(parsed)]
  }
  // Test writes too: some browsers allow reads but reject storage writes.
  localStorage.setItem(storageKey, JSON.stringify(completed))
} catch {
  storageError('Saved progress is unavailable or unreadable.')
}

function updateProgress() {
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
    try { localStorage.setItem(storageKey, JSON.stringify(completed)) }
    catch { storageError('This browser could not save progress.') }
  }
  updateProgress()
}

checks.forEach((check) => {
  check.disabled = false
  check.addEventListener('change', () => {
    const index = Number(check.dataset.complete)
    completed = check.checked ? [...new Set([...completed, index])] : completed.filter((value) => value !== index)
    saveProgress()
  })
})
reset.addEventListener('click', () => {
  if (window.confirm('Reset the completed lessons in this browser?')) {
    completed = []
    saveProgress()
  }
})
updateProgress()

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
})

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
