const token = new URLSearchParams(location.search).get('token') ?? ''
const $ = (selector) => document.querySelector(selector)
const cx = (...names) => names.filter(Boolean).join(' ')
const panels = { passport: $('#panel-passport'), round: $('#panel-round'), board: $('#panel-board') }
const tabs = [...document.querySelectorAll('[role="tab"]')]
const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

// The round sorts exact statuses into four readable groups; mixed or non-product statuses stay on the board only.
const buckets = [
  { id: 'ga', label: 'GA', statuses: ['GA'] },
  { id: 'preview', label: 'Preview', statuses: ['Public preview', 'Preview', 'Experimental preview'] },
  { id: 'access', label: 'Available, check access', statuses: ['Available', 'Restricted access'] },
  { id: 'unshipped', label: 'Not confirmed shipped', statuses: ['Announced', 'Not yet available', 'Roadmap'] },
]
const bucketOf = (status) => buckets.find((bucket) => bucket.statuses.includes(status))

let data = null
let selected = 0
let fresh = null
let busy = false
let round = null

function h(tag, props = {}, ...children) {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === false || value == null) continue
    if (key.startsWith('on')) element.addEventListener(key.slice(2), value)
    else element.setAttribute(key, value === true ? '' : value)
  }
  element.append(...children.flat(2).filter((child) => child || child === 0))
  return element
}

async function api(path, command) {
  const response = await fetch(path, {
    method: command ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(command && { 'Content-Type': 'application/json' }) },
    body: command && JSON.stringify(command),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error?.message ?? `The canvas server answered ${response.status}.`)
  return body
}

function announce(message) {
  const live = $('#live')
  live.textContent = ''
  setTimeout(() => { live.textContent = message }, 30)
}

function showError(message) {
  const notice = $('#notice')
  notice.textContent = message
  notice.hidden = !message
}

// Every change is applied by the server first; the view only re-renders from what was actually saved.
async function change(command, message) {
  if (busy) return false
  busy = true
  try {
    data.progress = (await api('/api/progress', command)).progress
    showError('')
    announce(message)
    return true
  } catch (error) {
    showError(`Not saved. ${error.message}`)
    return false
  } finally {
    busy = false
  }
}

function showTab(name, focus = false) {
  for (const tab of tabs) {
    const active = tab.dataset.tab === name
    tab.setAttribute('aria-selected', String(active))
    tab.tabIndex = active ? 0 : -1
    panels[tab.dataset.tab].hidden = !active
    if (active && focus) tab.focus()
  }
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => showTab(tab.dataset.tab))
  tab.addEventListener('keydown', (event) => {
    const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key]
    if (target === undefined) return
    event.preventDefault()
    showTab(tabs[(target + tabs.length) % tabs.length].dataset.tab, true)
  })
})

function sources(keys, inline = false) {
  const links = keys.map((key) => h('a', { href: data.sources[key].url, target: '_blank', rel: 'noreferrer' }, data.sources[key].label))
  return inline
    ? h('p', { class: 'sources-line' }, 'Sources: ', links.flatMap((link, index) => index ? [' · ', link] : [link]))
    : h('ul', { class: 'sources' }, links.map((link) => h('li', {}, link)))
}

function practise(step) {
  showTab('passport')
  select(step)
}

async function load() {
  panels.passport.replaceChildren(h('p', { class: 'state' }, 'Loading your passport…'))
  try {
    data = await api('/api/state')
  } catch (error) {
    for (const panel of Object.values(panels)) {
      panel.replaceChildren(h('div', { class: 'state', role: 'alert' },
        h('p', {}, `Your passport did not load. ${error.message}`),
        h('button', { class: 'button', type: 'button', onclick: load }, 'Try again')))
    }
    return
  }
  selected = nextStep() ?? 0
  $('.scope').textContent = data.scope
  $('#storage').replaceChildren(`Progress is saved on this computer in ${data.storage.file}.`)
  if (data.storage.notice) $('#storage').append(h('strong', {}, ` ${data.storage.notice}`))
  renderPassport()
  renderRound()
  renderBoard()
}

function nextStep() {
  const step = data.lessons.findIndex((_, index) => !data.progress.stamps[index])
  return step === -1 ? null : step
}

const routeLabel = (route) => route === 'practice' ? 'practice route' : 'exercise'

function slot(lesson, step, next) {
  const stamp = data.progress.stamps[step]
  const state = stamp ? `stamped ${day.format(new Date(stamp.at))} by ${routeLabel(stamp.route)}` : step === next ? 'next stop' : 'not stamped'
  return h('button', {
    type: 'button',
    class: cx('slot', stamp && 'is-inked', step === fresh && 'is-fresh'),
    'aria-current': step === selected ? 'true' : null,
    onclick: () => select(step),
  },
    h('span', { class: 'sr-only' }, `Step ${step}: `),
    h('span', { class: 'slot-step', 'aria-hidden': 'true' }, step),
    h('span', { class: 'slot-name' }, lesson.short),
    h('span', { class: 'slot-meta' }, `${lesson.minutes} min`),
    h('span', { class: 'sr-only' }, `, ${state}`),
    stamp
      ? h('span', { class: 'slot-mark', 'aria-hidden': 'true' }, stamp.route === 'practice' ? 'Practice' : 'Done', h('small', {}, day.format(new Date(stamp.at))))
      : step === next && h('span', { class: 'slot-next', 'aria-hidden': 'true' }, 'Next'))
}

function completion() {
  const stamps = Object.values(data.progress.stamps)
  const practice = stamps.filter((stamp) => stamp.route === 'practice').length
  const best = data.progress.bestRound
  const last = new Date(Math.max(...stamps.map((stamp) => Date.parse(stamp.at))))
  return h('section', { class: 'complete', 'aria-labelledby': 'complete-title' },
    h('div', { class: 'seal', 'aria-hidden': 'true' }, h('span', {}, 'Universe'), h('strong', {}, '2026'), h('span', {}, day.format(last))),
    h('div', {},
      h('h2', { id: 'complete-title', tabindex: '-1' }, 'Passport complete'),
      h('p', {}, `All ${data.lessons.length} steps stamped${practice ? `, ${practice} by practice route` : ''}. `,
        best ? `Best status round: ${best.score} of ${best.total}.` : 'Status round not played yet.'),
      h('p', { class: 'fine' }, 'A personal progress card, not a GitHub certification.')))
}

function stampRow(stamp) {
  if (!stamp) {
    return h('div', { class: 'stamp-row' },
      h('button', { class: 'button button-primary', type: 'button', onclick: () => stampStep('exercise') }, `Stamp step ${selected}`))
  }
  const next = nextStep()
  return h('div', { class: 'stamp-row' },
    h('p', {}, h('strong', {}, `Stamped ${day.format(new Date(stamp.at))}`), ` by ${routeLabel(stamp.route)}.`),
    next !== null && h('button', { class: 'button button-primary', type: 'button', onclick: () => select(next) }, `Next stop: step ${next}`),
    h('button', { class: 'button button-quiet', type: 'button', onclick: unstampStep }, 'Remove stamp'))
}

function lessonView() {
  const lesson = data.lessons[selected]
  const stamp = data.progress.stamps[selected]
  return h('article', { class: 'lesson', 'aria-labelledby': 'lesson-title' },
    h('h2', { id: 'lesson-title', tabindex: '-1' }, lesson.title),
    h('p', { class: 'lesson-meta' }, `Step ${selected} · ${lesson.day} · about ${lesson.minutes} min (editorial estimate)`),
    h('p', { class: 'lede' }, lesson.what),
    h('p', {}, lesson.why),
    h('h3', {}, 'Before you start'),
    h('p', {}, lesson.prerequisites),
    lesson.warning && h('div', { class: 'gate', role: 'note' }, h('h3', {}, 'Permission & credit gate'), h('p', {}, lesson.warning)),
    h('h3', {}, 'Do this'),
    h('ol', { class: 'steps' }, lesson.steps.map((text) => h('li', {}, text))),
    lesson.prompt && [
      h('h3', {}, 'Safe prompt'),
      h('div', { class: 'prompt' },
        h('p', { id: 'prompt' }, lesson.prompt),
        h('div', { class: 'button-row' },
          h('button', { class: 'button', type: 'button', onclick: copyPrompt }, 'Copy prompt'),
          h('span', { class: 'copy-status', role: 'status' }))),
    ],
    h('h3', {}, "You're done when"),
    h('p', {}, lesson.done),
    stampRow(stamp),
    h('details', {}, h('summary', {}, 'No access? Practice route'), h('p', {}, lesson.fallback),
      !stamp && h('button', { class: 'button', type: 'button', onclick: () => stampStep('practice') }, 'Stamp with practice route')),
    h('details', {}, h('summary', {}, `Official reading (${lesson.reading.length})`), sources(lesson.reading)),
    h('nav', { class: 'pager', 'aria-label': 'Lessons' },
      selected > 0 && h('button', { class: 'button', type: 'button', onclick: () => select(selected - 1) }, `Previous: step ${selected - 1}`),
      selected < data.lessons.length - 1 && h('button', { class: 'button', type: 'button', onclick: () => select(selected + 1) }, `Next: step ${selected + 1}`)))
}

function renderPassport() {
  const next = nextStep()
  const stamped = Object.keys(data.progress.stamps).length
  panels.passport.replaceChildren(
    h('div', { class: 'passport-layout' },
      h('section', { class: 'passport', 'aria-labelledby': 'passport-title' },
        h('h2', { id: 'passport-title' }, 'Your passport'),
        h('p', { class: 'tally' }, h('strong', {}, `${stamped} of ${data.lessons.length} stamped`),
          next === null ? '' : ` · next: step ${next}, ${data.lessons[next].short}`),
        h('ol', { class: 'stamps' }, data.lessons.map((lesson, step) => h('li', {}, slot(lesson, step, next))))),
      lessonView()))
  if (next === null) panels.passport.prepend(completion())
  // The ink animation belongs to the render right after stamping only.
  fresh = null
}

function select(step) {
  selected = step
  renderPassport()
  $('#lesson-title').focus()
}

async function stampStep(route) {
  const step = selected
  if (!(await change({ type: 'stamp', lesson: step, route }, `Step ${step} stamped.`))) return
  fresh = step
  renderPassport()
  $(nextStep() === null ? '#complete-title' : '.stamp-row .button-primary').focus()
}

async function unstampStep() {
  if (!(await change({ type: 'unstamp', lesson: selected }, `Stamp removed from step ${selected}.`))) return
  renderPassport()
  $('.stamp-row button').focus()
}

async function copyPrompt(event) {
  const status = event.currentTarget.nextElementSibling
  const prompt = $('#prompt')
  try {
    await navigator.clipboard.writeText(prompt.textContent)
    status.textContent = 'Copied.'
  } catch {
    // Canvas iframes may not grant clipboard access; fall back to a selection the user can copy.
    getSelection().selectAllChildren(prompt)
    let copied = false
    try { copied = document.execCommand('copy') } catch {}
    status.textContent = copied ? 'Copied.' : 'Copy is blocked here. The prompt is selected: press ⌘C or Ctrl+C.'
  }
}

function shuffle(items) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]]
  }
  return copy
}

// Two cards per group keeps every round honest about all four kinds of status.
function startRound() {
  const pool = shuffle(data.releases.filter((release) => bucketOf(release.status)))
  const picked = buckets.flatMap((bucket) => pool.filter((release) => bucketOf(release.status) === bucket).slice(0, 2))
  const rest = pool.filter((release) => !picked.includes(release))
  round = { cards: shuffle([...picked, ...rest].slice(0, data.roundSize)), index: 0, answers: [] }
  renderRound()
  $('#card-title').focus()
}

const isRight = (card, answer) => bucketOf(card.status).id === answer
const bestLine = () => data.progress.bestRound
  ? `Best round: ${data.progress.bestRound.score} of ${data.progress.bestRound.total}.`
  : 'No round saved yet.'

function cardView() {
  const card = round.cards[round.index]
  const answer = round.answers[round.index]
  const official = bucketOf(card.status)
  const score = round.answers.filter((value, index) => isRight(round.cards[index], value)).length
  const last = round.index === round.cards.length - 1
  return h('div', { class: 'round' },
    h('p', { class: 'round-progress' }, `Card ${round.index + 1} of ${round.cards.length} · ${score} right so far`),
    h('h2', { id: 'card-title', tabindex: '-1' }, card.name),
    h('p', { class: 'muted' }, card.group),
    h('fieldset', { class: 'choices' },
      h('legend', {}, 'Status as of 1 Nov 2026'),
      buckets.map((bucket) => h('button', {
        type: 'button',
        class: cx('button', 'choice', answer && bucket === official && 'is-official', answer === bucket.id && bucket !== official && 'is-wrong'),
        disabled: Boolean(answer),
        onclick: () => {
          round.answers[round.index] = bucket.id
          renderRound()
          $('#verdict').focus()
        },
      }, bucket.label,
        answer && bucket === official && h('span', { class: 'choice-tag' }, 'Official'),
        answer === bucket.id && bucket !== official && h('span', { class: 'choice-tag' }, 'Your pick')))),
    answer && h('div', { class: 'reveal' },
      h('p', { id: 'verdict', class: cx('verdict', isRight(card, answer) ? 'is-right' : 'is-wrong'), tabindex: '-1' },
        h('strong', {}, isRight(card, answer) ? 'Right.' : 'Not quite.'), ` Official status: ${card.status}.`),
      h('p', {}, card.detail),
      h('p', {}, h('strong', {}, 'Gate: '), card.gate),
      sources(card.reading, true),
      h('div', { class: 'button-row' },
        h('button', { class: 'button button-primary', type: 'button', onclick: last ? finishRound : nextCard }, last ? 'See results' : 'Next card'),
        h('button', { class: 'button', type: 'button', onclick: () => practise(card.lesson) }, `Practise in step ${card.lesson}`))))
}

function nextCard() {
  round.index += 1
  renderRound()
  $('#card-title').focus()
}

async function finishRound() {
  round.index = round.cards.length
  const score = round.answers.filter((value, index) => isRight(round.cards[index], value)).length
  await change({ type: 'round', score }, `Round saved: ${score} of ${round.cards.length}.`)
  renderRound()
  if (nextStep() === null) renderPassport()
  $('#results-title').focus()
}

function resultsView() {
  const misses = round.cards.map((card, index) => ({ card, answer: round.answers[index] })).filter(({ card, answer }) => !isRight(card, answer))
  const score = round.cards.length - misses.length
  return h('div', { class: 'round' },
    h('h2', { id: 'results-title', tabindex: '-1' }, `You read ${score} of ${round.cards.length} statuses correctly`),
    h('p', { class: 'muted' }, bestLine()),
    misses.length
      ? [h('h3', {}, 'Review these'), h('ul', { class: 'misses' }, misses.map(({ card, answer }) => h('li', {},
          h('strong', {}, card.name), `: you picked ${buckets.find((bucket) => bucket.id === answer).label}; official status is ${card.status}. `,
          h('button', { class: 'link-button', type: 'button', onclick: () => practise(card.lesson) }, `Practise in step ${card.lesson}`))))]
      : h('p', {}, 'Every status read correctly.'),
    h('div', { class: 'button-row' }, h('button', { class: 'button button-primary', type: 'button', onclick: startRound }, 'Play another round')))
}

function renderRound() {
  if (round) {
    panels.round.replaceChildren(round.index < round.cards.length ? cardView() : resultsView())
    return
  }
  panels.round.replaceChildren(h('div', { class: 'round' },
    h('h2', {}, 'Status round'),
    h('p', {}, `Eight releases from the board, two from each status group. Pick the status the official sources give each one, then read the gate. Nothing here spends credits.`),
    h('ul', { class: 'bucket-key' }, buckets.map((bucket) => h('li', {}, h('strong', {}, bucket.label), `: ${bucket.statuses.join(', ')}`))),
    h('p', { class: 'muted' }, bestLine()),
    h('div', { class: 'button-row' }, h('button', { class: 'button button-primary', type: 'button', onclick: startRound }, 'Start a round'))))
}

function release(item) {
  return h('li', { class: 'release' },
    h('h3', {}, item.name),
    h('p', { class: 'release-meta' },
      h('span', { class: cx('status', `status-${bucketOf(item.status)?.id ?? 'other'}`) }, item.status),
      h('span', {}, item.group),
      h('button', { class: 'link-button', type: 'button', onclick: () => practise(item.lesson) }, `Practise in step ${item.lesson}`)),
    h('p', {}, item.detail),
    h('p', { class: 'gate-line' }, h('strong', {}, 'Gate: '), item.gate),
    sources(item.reading, true))
}

function renderBoard() {
  const unique = (key) => [...new Set(data.releases.map((item) => item[key]))].sort()
  const list = h('ul', { class: 'releases' })
  const count = h('p', { class: 'count', role: 'status' })
  const query = h('input', { id: 'release-search', type: 'search', placeholder: 'Try “security” or “credits”', autocomplete: 'off', oninput: update })
  const group = h('select', { id: 'release-group', onchange: update }, h('option', { value: '' }, 'All themes'), unique('group').map((value) => h('option', {}, value)))
  const status = h('select', { id: 'release-status', onchange: update }, h('option', { value: '' }, 'All statuses'), unique('status').map((value) => h('option', {}, value)))
  const clear = () => {
    query.value = group.value = status.value = ''
    update()
    query.focus()
  }
  const empty = h('div', { class: 'state', hidden: true },
    h('p', {}, 'No announcement matches these filters.'),
    h('button', { class: 'button', type: 'button', onclick: clear }, 'Clear filters'))

  function update() {
    const words = query.value.trim().toLowerCase()
    const matches = data.releases.filter((item) => (!group.value || item.group === group.value)
      && (!status.value || item.status === status.value)
      && (!words || [item.name, item.status, item.group, item.detail, item.gate].join(' ').toLowerCase().includes(words)))
    list.replaceChildren(...matches.map(release))
    count.textContent = `Showing ${matches.length} of ${data.releases.length} announcements`
    empty.hidden = matches.length > 0
  }

  panels.board.replaceChildren(
    h('h2', {}, 'Release board'),
    h('p', { class: 'scope-note' }, h('strong', {}, 'Read the status literally. '), data.statusNote),
    h('div', { class: 'filters', role: 'search' },
      h('div', {}, h('label', { for: 'release-search' }, 'Find an announcement'), query),
      h('div', {}, h('label', { for: 'release-group' }, 'Theme'), group),
      h('div', {}, h('label', { for: 'release-status' }, 'Status'), status),
      h('button', { class: 'button', type: 'button', onclick: clear }, 'Clear')),
    count, list, empty)
  update()
}

load()
