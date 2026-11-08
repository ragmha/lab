import { Chess, type Move, type Square } from 'chess.js'
import {
  buildAgentContext, candidateLine, contextBudget, describeMove, gameResult, legalEngineMove, parseSearchInfo,
  pieceSprites, pieceNames, searchTime, skillLevel, type SearchInfo,
} from '../lib/chess'

interface Turn {
  player: Move
  fen: string
  legalReplies: number
  commands: string[]
  info: SearchInfo
  phase: 'loading' | 'searching' | 'complete' | 'error' | 'gameover'
  reply?: Move
  error?: string
  errorAt?: 'search' | 'verify'
  result?: string
}

const board = document.querySelector<HTMLElement>('#chess-board')!
const status = document.querySelector<HTMLElement>('#chess-status')!
const reset = document.querySelector<HTMLButtonElement>('#chess-reset')!
const retry = document.querySelector<HTMLButtonElement>('#chess-retry')!
const picker = document.querySelector<HTMLSelectElement>('#chess-turn')!
const flow = document.querySelector<HTMLOListElement>('#chess-flow')!
const commands = document.querySelector<HTMLElement>('#chess-commands')!
const moves = document.querySelector<HTMLElement>('#chess-moves')!
const returnNote = document.querySelector<HTMLElement>('#trace-return')!
const depth = document.querySelector<HTMLElement>('#search-depth')!
const nodes = document.querySelector<HTMLElement>('#search-nodes')!
const time = document.querySelector<HTMLElement>('#search-time')!
const candidate = document.querySelector<HTMLElement>('#search-candidate')!
const trace = document.querySelector<HTMLElement>('.trace')!
const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('.view-switch [data-view]')]
const details = document.querySelector<HTMLElement>('#chess-details')!
const historyView = document.querySelector<HTMLElement>('#chess-history')!
const contextView = document.querySelector<HTMLElement>('#chess-context')!
const contextEmpty = document.querySelector<HTMLElement>('#chess-context-empty')!
const contextBody = document.querySelector<HTMLElement>('#chess-context-body')!
const contextBlocks = document.querySelector<HTMLOListElement>('#chess-context-blocks')!
const views: Record<string, HTMLElement> = { history: historyView, details, context: contextView }
const historyEmpty = document.querySelector<HTMLElement>('#chess-history-empty')!
const timeline = document.querySelector<HTMLOListElement>('#chess-timeline')!
const moveTemplate = document.querySelector<HTMLTemplateElement>('#chess-move-template')!
const buttons = [...board.querySelectorAll<HTMLButtonElement>('button')]
const game = new Chess()
const turns: Turn[] = []
let selected: Square | null = null
let worker: Worker | undefined
let ready = false
let pending: Turn | undefined
let timeout: ReturnType<typeof setTimeout> | undefined

function setStep(name: string, state: string, text: string, active = false) {
  const step = flow.querySelector<HTMLElement>(`[data-step="${name}"]`)!
  step.querySelector<HTMLElement>('[data-state]')!.textContent = state
  step.querySelector<HTMLElement>('[data-copy]')!.textContent = text
  step.dataset.active = String(active)
  step.dataset.failed = String(state === 'Failed')
}

function revealLatestMove() {
  const last = timeline.lastElementChild
  if (historyView.hidden || !last) return
  const bottom = last.getBoundingClientRect().bottom - trace.getBoundingClientRect().bottom + 8
  if (bottom > 0) trace.scrollTop += bottom
}

function renderTimeline() {
  const turn = turns.at(-1)
  if (!turn) return
  const last = timeline.lastElementChild
  const panel = trace.getBoundingClientRect()
  const lastBottom = last?.getBoundingClientRect().bottom
  const following = lastBottom === undefined || (lastBottom <= panel.bottom + 24 && lastBottom > panel.top)
  const number = turns.length
  const stats = [
    turn.info.depth === undefined ? '' : `Depth ${turn.info.depth}`,
    turn.info.nodes === undefined ? '' : `${turn.info.nodes.toLocaleString('en-US')} nodes`,
    turn.info.time === undefined ? '' : `${turn.info.time} ms`,
  ].filter(Boolean).join(' · ')
  historyEmpty.hidden = true
  for (const actor of ['player', 'engine'] as const) {
    if (actor === 'engine' && turn.phase === 'gameover') continue
    let entry = timeline.querySelector<HTMLLIElement>(`[data-turn="${number}"][data-actor="${actor}"]`)
    if (!entry) {
      entry = moveTemplate.content.firstElementChild!.cloneNode(true) as HTMLLIElement
      entry.dataset.turn = String(number)
      entry.dataset.actor = actor
      timeline.append(entry)
    }
    const move = actor === 'player' ? turn.player : turn.reply
    const failed = actor === 'engine' && turn.phase === 'error'
    const state = move ? 'Played' : failed ? 'Stopped' : turn.phase === 'loading' ? 'Loading' : 'Searching'
    const fields = {
      actor: actor === 'player' ? 'You / White' : 'Stockfish / Black',
      state,
      title: move ? `${number}${actor === 'player' ? '.' : '...'} ${move.san}` : failed ? 'No reply played' : 'Finding a reply…',
      copy: move ? describeMove(move) : failed ? `${turn.error} Retry above the board.`
        : turn.phase === 'loading' ? 'Starting the engine on your device.' : 'Checking possible replies locally.',
      meta: actor === 'player' ? (turn.phase === 'gameover' ? turn.result ?? '' : '')
        : [stats, turn.result].filter(Boolean).join(' · '),
    }
    for (const [name, text] of Object.entries(fields)) {
      const field = entry.querySelector<HTMLElement>(`[data-move-${name}]`)!
      if (field.textContent !== text) field.textContent = text
      if (name === 'meta') field.hidden = !text
    }
    entry.dataset.pending = String(!move && !failed)
    entry.dataset.failed = String(failed)
  }
  if (following) revealLatestMove()
}

function meter(name: string, tokens: number) {
  document.querySelector('#context-' + name)!.textContent =
    `≈ ${tokens.toLocaleString('en-US')} / ${contextBudget} tokens${tokens > contextBudget ? ' · over budget' : ''}`
  const bar = document.querySelector<HTMLElement>(`#context-${name}-bar`)!
  bar.style.width = `${Math.min(100, (tokens / contextBudget) * 100)}%`
  bar.dataset.over = String(tokens > contextBudget)
}

function renderContext() {
  if (contextView.hidden) return
  contextEmpty.hidden = turns.length > 0
  contextBody.hidden = turns.length === 0
  if (!turns.length) return
  const plies = turns.flatMap((turn, i) => i === turns.length - 1 ? [turn.player] : [turn.player, turn.reply!])
  const { blocks, used, dropped, transcript } = buildAgentContext(plies, turns.map((turn) => ({
    fen: turn.fen, info: turn.info, reply: turn.reply?.lan, gameOver: turn.phase === 'gameover',
  })))
  meter('used', used)
  meter('transcript', transcript)
  contextBlocks.replaceChildren(...blocks.map((block) => {
    const item = document.createElement('li')
    item.dataset.policy = block.policy
    const label = document.createElement('div')
    label.className = 'step-label'
    label.append(Object.assign(document.createElement('strong'), { textContent: block.label }),
      Object.assign(document.createElement('span'), { textContent: `${block.policy} · ${block.tokens} tokens` }))
    item.append(label, Object.assign(document.createElement('code'), { textContent: block.text }))
    return item
  }))
  document.querySelector('#context-dropped')!.textContent = turns.at(-1)!.phase === 'gameover'
    ? 'Game over: no tool calls and no answer needed.'
    : `Left out: tool results from ${turns.length - 1} earlier ${turns.length === 2 ? 'turn' : 'turns'} (≈ ${dropped} tokens). The position already reflects them.`
}

function renderTrace() {
  renderTimeline()
  renderContext()
  const turn = turns[Number(picker.value)]
  if (!turn) return
  const terminal = turn.phase === 'gameover'
  const finished = turn.phase === 'complete'
  const failed = turn.phase === 'error'
  setStep('player', 'Played', `${turn.player.san} · ${describeMove(turn.player)}`)
  setStep('validate', 'Accepted', terminal
    ? `Legal move. ${turn.result}`
    : `Legal move. Position updated; black has ${turn.legalReplies} legal replies.`)
  setStep('search', terminal ? 'Skipped' : failed && turn.errorAt === 'search' ? 'Failed' : finished || turn.errorAt === 'verify' ? 'Finished' : turn.phase === 'loading' ? 'Loading' : 'Searching',
    terminal ? 'The game ended. No engine search was requested.'
      : failed && turn.errorAt === 'search' ? turn.error!
      : turn.phase === 'loading' ? 'Loading the local engine and waiting for it to be ready.'
      : 'Stockfish searches replies and evaluates positions locally.',
    turn.phase === 'searching' || turn.phase === 'loading')
  setStep('verify', turn.errorAt === 'verify' ? 'Failed' : finished ? 'Accepted' : terminal ? 'Skipped' : failed ? 'Stopped' : 'Waiting',
    turn.errorAt === 'verify' ? turn.error!
      : turn.reply ? `Reply ${turn.reply.lan} is legal. Applied to the board.`
      : terminal ? 'No reply to check.' : 'The board will only accept a legal engine reply.')
  setStep('reply', finished ? 'Played' : terminal ? 'Skipped' : failed ? 'Stopped' : 'Waiting',
    turn.reply ? `${turn.reply.san} · ${describeMove(turn.reply)}`
      : terminal ? 'No reply: the game is over.' : 'No engine move has been played yet.')
  depth.textContent = turn.info.depth === undefined ? '—' : String(turn.info.depth)
  nodes.textContent = turn.info.nodes === undefined ? '—' : turn.info.nodes.toLocaleString('en-US')
  time.textContent = turn.info.time === undefined ? '—' : `${turn.info.time} ms`
  candidate.textContent = turn.info.pv
    ? `Top search line: ${candidateLine(turn.fen, turn.info.pv)}`
    : terminal ? 'No candidate line needed.' : 'No candidate line reported yet.'
  commands.textContent = turn.commands.length ? turn.commands.join('\n') : 'No search sent: the game is over.'
  returnNote.textContent = turn.result ?? (failed ? 'Search stopped. Retry above the board.'
    : finished ? '↳ Back to you. The loop repeats.' : 'Waiting for the local engine.')
}

function renderBoard(message?: string) {
  const history = game.history({ verbose: true })
  const last = history.at(-1)
  const legal = selected ? game.moves({ square: selected, verbose: true }).map((move) => move.to) : []
  for (const button of buttons) {
    const square = button.dataset.square as Square
    const piece = game.get(square)
    button.querySelector<HTMLElement>('.piece')!.innerHTML = piece ? pieceSprites[piece.type] : ''
    if (piece) button.dataset.color = piece.color
    else delete button.dataset.color
    button.ariaLabel = piece ? `${square} ${piece.color === 'w' ? 'white' : 'black'} ${pieceNames[piece.type]}` : square
    button.ariaPressed = String(square === selected)
    button.dataset.legal = String(legal.includes(square))
    button.dataset.last = String(square === last?.from || square === last?.to)
    button.disabled = game.turn() !== 'w' || game.isGameOver()
  }
  const result = gameResult(game)
  status.textContent = message ?? result ?? (game.turn() === 'w'
    ? selected ? `${pieceNames[game.get(selected)!.type]} on ${selected}. Choose a marked square.`
      : `Your move.${game.isCheck() ? ' You are in check.' : ''}`
    : 'Stockfish is thinking on your device…')
  moves.textContent = history.length ? history.map((move, index) =>
    `${index % 2 === 0 ? `${Math.floor(index / 2) + 1}. ` : ''}${move.san}`,
  ).join(' ') : 'No moves yet.'
  reset.disabled = false
}

function disposeEngine() {
  clearTimeout(timeout)
  worker?.terminate()
  worker = undefined
  ready = false
}

function failEngine(message: string, at: 'search' | 'verify' = 'search') {
  if (!pending) return
  pending.phase = 'error'
  pending.error = message
  pending.errorAt = at
  pending = undefined
  disposeEngine()
  retry.hidden = false
  renderTrace()
  renderBoard(`${message} Use Retry engine or start a new game.`)
}

function armTimeout() {
  clearTimeout(timeout)
  timeout = setTimeout(() => failEngine('The engine did not respond in time.'), 20_000)
}

function send(command: string) {
  if (!worker || !pending) return
  pending.commands.push(`→ ${command}`)
  worker.postMessage(command)
}

function beginSearch() {
  if (!pending) return
  pending.phase = 'searching'
  // Include move history so the engine can recognize repetitions.
  send(`position startpos moves ${game.history({ verbose: true }).map((move) => move.lan).join(' ')}`)
  send(`go movetime ${searchTime}`)
  armTimeout()
  renderTrace()
}

function handleEngineLine(line: string) {
  if (!pending) return
  if (line === 'uciok') {
    pending.commands.push('← uciok')
    send(`setoption name Skill Level value ${skillLevel}`)
    send('isready')
  } else if (line === 'readyok') {
    pending.commands.push('← readyok')
    ready = true
    beginSearch()
  } else if (pending.phase === 'searching' && line.startsWith('info ')) {
    const info = parseSearchInfo(line)
    if (info) {
      Object.assign(pending.info, info)
      renderTrace()
    }
  } else if (pending.phase === 'searching' && line.startsWith('bestmove ')) {
    pending.commands.push(`← ${line}`)
    const move = legalEngineMove(game, line.split(/\s+/)[1])
    if (!move) {
      failEngine('The engine returned an invalid move. The board was not changed.', 'verify')
      return
    }
    clearTimeout(timeout)
    const turn = pending
    turn.reply = game.move(move)
    turn.phase = 'complete'
    turn.result = gameResult(game) ?? undefined
    picker.options[turns.indexOf(turn)].textContent = `${turns.indexOf(turn) + 1}. ${turn.player.san} / ${turn.reply.san}`
    pending = undefined
    renderBoard()
    renderTrace()
  }
}

function requestReply(turn: Turn) {
  pending = turn
  retry.hidden = true
  turn.info = {}
  turn.error = undefined
  turn.errorAt = undefined
  turn.commands = []
  turn.phase = ready ? 'searching' : 'loading'
  renderTrace()
  renderBoard()
  if (ready) {
    beginSearch()
    return
  }
  try {
    const activeWorker = new Worker('/chess/stockfish-19-lite-single.js')
    worker = activeWorker
    activeWorker.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (worker !== activeWorker) return
      if (typeof data !== 'string') {
        failEngine('The engine returned an unreadable message.')
        return
      }
      for (const line of data.split('\n')) handleEngineLine(line.trim())
    }
    activeWorker.onerror = () => {
      if (worker === activeWorker) failEngine('The local engine could not load or stopped unexpectedly.')
    }
    activeWorker.onmessageerror = () => {
      if (worker === activeWorker) failEngine('The engine message could not be read.')
    }
    send('uci')
    armTimeout()
  } catch (error) {
    failEngine(`Could not start the local engine: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function clickSquare(square: Square) {
  if (game.turn() !== 'w' || game.isGameOver()) return
  const move = selected ? game.moves({ square: selected, verbose: true }).find(
    (candidate) => candidate.to === square && (!candidate.promotion || candidate.promotion === 'q'),
  ) : undefined
  if (!move) {
    selected = selected === square ? null : game.get(square)?.color === 'w' ? square : null
    renderBoard()
    return
  }
  const player = game.move(move)
  selected = null
  const result = gameResult(game)
  const turn: Turn = {
    player, fen: game.fen(), legalReplies: game.moves().length, commands: [], info: {},
    phase: result ? 'gameover' : 'loading', result: result ?? undefined,
  }
  turns.push(turn)
  if (turns.length === 1) picker.replaceChildren()
  picker.add(new Option(`${turns.length}. ${player.san} / ${result ? 'game over' : '…'}`, String(turns.length - 1)))
  picker.value = String(turns.length - 1)
  picker.disabled = false
  renderBoard()
  renderTrace()
  if (!result) requestReply(turn)
}

buttons.forEach((button, index) => {
  button.tabIndex = button.dataset.square === 'e2' ? 0 : -1
  button.addEventListener('click', () => clickSquare(button.dataset.square as Square))
  button.addEventListener('focus', () => {
    for (const other of buttons) other.tabIndex = other === button ? 0 : -1
  })
  button.addEventListener('keydown', (event) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[event.key]
    if (delta === undefined) return
    event.preventDefault()
    const next = index + delta
    if (next < 0 || next > 63 || (Math.abs(delta) === 1 && Math.floor(next / 8) !== Math.floor(index / 8))) return
    buttons[next].focus()
  })
})
picker.addEventListener('change', renderTrace)
for (const button of viewButtons) {
  button.addEventListener('click', () => {
    for (const other of viewButtons) {
      other.ariaPressed = String(other === button)
      views[other.dataset.view!].hidden = other !== button
    }
    trace.scrollTop = 0
    revealLatestMove()
    renderContext()
  })
}
retry.addEventListener('click', () => {
  const turn = turns.at(-1)
  if (!turn || turn.phase !== 'error') return
  picker.value = String(turns.length - 1)
  requestReply(turn)
})
reset.addEventListener('click', () => {
  pending = undefined
  disposeEngine()
  turns.length = 0
  timeline.replaceChildren()
  historyEmpty.hidden = false
  trace.scrollTop = 0
  renderContext()
  game.reset()
  selected = null
  picker.replaceChildren(new Option('Waiting for your first move', ''))
  picker.disabled = true
  retry.hidden = true
  setStep('player', 'Waiting', 'Select a piece to begin.')
  setStep('validate', 'Next', 'Checks the move against the rules and updates the position.')
  setStep('search', 'Next', 'Stockfish explores replies; its neural network evaluates positions.')
  setStep('verify', 'Next', "Checks the engine's reply before it reaches the board.")
  setStep('reply', 'Next', 'The reply appears here. Then it is your turn again.')
  depth.textContent = nodes.textContent = time.textContent = '—'
  candidate.textContent = 'Candidate line appears during search.'
  commands.textContent = 'No search sent yet.'
  returnNote.textContent = 'Your move starts the loop.'
  renderBoard()
  buttons.find((button) => button.dataset.square === 'e2')!.focus()
})
window.addEventListener('pagehide', disposeEngine)
for (const button of viewButtons) button.disabled = false
renderBoard()
