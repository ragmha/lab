import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js'

export const skillLevel = 5
export const searchTime = 500
export const pieceNames: Record<PieceSymbol, string> = {
  k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn',
}
// 12×12 pixel sprites. '#' is the piece body; a 1-pixel outline is traced around it.
const sprites: Record<PieceSymbol, string[]> = {
  k: ['.....##.....', '....####....', '.....##.....', '..##.##.##..', '.##########.', '.##########.',
    '..########..', '...######...', '....####....', '...######...', '..########..', '..########..'],
  q: ['............', '.#..#..#..#.', '.##.####.##.', '.##########.', '..########..', '...######...',
    '....####....', '....####....', '...######...', '..########..', '..########..', '............'],
  r: ['............', '..##.##.##..', '..########..', '...######...', '....####....', '....####....',
    '....####....', '....####....', '...######...', '..########..', '..########..', '............'],
  b: ['............', '.....##.....', '....####....', '...##.###...', '...#.####...', '...######...',
    '....####....', '.....##.....', '....####....', '..########..', '..########..', '............'],
  n: ['............', '....##.#....', '...######...', '..########..', '..##.#####..', '.....#####..',
    '....#####...', '...######...', '...######...', '..########..', '..########..', '............'],
  p: ['............', '............', '.....##.....', '....####....', '....####....', '.....##.....',
    '....####....', '.....##.....', '....####....', '...######...', '..########..', '............'],
}

function spriteSvg(rows: string[]) {
  const filled = (x: number, y: number) => rows[y]?.[x] === '#'
  let body = ''
  let edge = ''
  for (let y = -1; y <= rows.length; y++) {
    for (let x = -1; x <= 12; x++) {
      const cell = `M${x + 1} ${y + 1}h1v1h-1z`
      if (filled(x, y)) body += cell
      else if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) edge += cell
    }
  }
  return `<svg viewBox="0 0 14 14" shape-rendering="crispEdges"><path class="edge" d="${edge}"/><path class="body" d="${body}"/></svg>`
}

export const pieceSprites = Object.fromEntries(
  Object.entries(sprites).map(([type, rows]) => [type, spriteSvg(rows)]),
) as Record<PieceSymbol, string>
export const squares: Square[] = Array.from({ length: 64 }, (_, i) =>
  `${'abcdefgh'[i % 8]}${8 - Math.floor(i / 8)}` as Square,
)

export interface SearchInfo {
  depth?: number
  nodes?: number
  time?: number
  pv?: string[]
}

export function parseSearchInfo(line: string): SearchInfo | null {
  if (!line.startsWith('info ') || line.startsWith('info string ')) return null
  const multipv = /\bmultipv (\d+)/.exec(line)
  if (multipv && multipv[1] !== '1') return null
  const info: SearchInfo = {}
  for (const key of ['depth', 'nodes', 'time'] as const) {
    const value = new RegExp(`\\b${key} (\\d+)\\b`).exec(line)
    if (value) info[key] = Number(value[1])
  }
  const pv = /\bpv ((?:[a-h][1-8][a-h][1-8][qrbn]?(?: |$))+)/.exec(line)
  if (pv) info.pv = pv[1].trim().split(' ')
  return Object.keys(info).length ? info : null
}

export function legalEngineMove(game: Chess, uci: string): Move | undefined {
  return game.moves({ verbose: true }).find((move) => move.lan === uci)
}

export function candidateLine(fen: string, moves: string[]): string {
  const position = new Chess(fen)
  const san: string[] = []
  for (const uci of moves.slice(0, 4)) {
    const move = legalEngineMove(position, uci)
    if (!move) return 'Candidate line could not be decoded.'
    san.push(position.move(move).san)
  }
  return san.join(' → ')
}

export function describeMove(move: Move): string {
  const piece = pieceNames[move.piece]
  if (move.isKingsideCastle()) return 'King castles kingside; the rook moves too.'
  if (move.isQueensideCastle()) return 'King castles queenside; the rook moves too.'
  let description = `${piece[0].toUpperCase()}${piece.slice(1)} ${move.from} → ${move.to}`
  if (move.captured) description += `, captures a ${pieceNames[move.captured]}`
  if (move.isEnPassant()) description += ' en passant'
  if (move.promotion) description += `, promotes to a ${pieceNames[move.promotion]}`
  if (move.san.endsWith('#')) description += '. Checkmate'
  else if (move.san.endsWith('+')) description += '. Check'
  return `${description}.`
}

export function gameResult(game: Chess): string | null {
  if (game.isCheckmate()) return `Checkmate. ${game.turn() === 'w' ? 'Stockfish' : 'You'} won.`
  if (game.isStalemate()) return 'Draw by stalemate.'
  if (game.isThreefoldRepetition()) return 'Draw by threefold repetition.'
  if (game.isInsufficientMaterial()) return 'Draw: insufficient material.'
  if (game.isDrawByFiftyMoves()) return 'Draw by the fifty-move rule.'
  return null
}

// Illustrative context engineering: what a harness would send a language model playing Black.
export const contextBudget = 512
export const recentPlies = 6
export const estimateTokens = (text: string) => Math.ceil(text.length / 4)

export interface ContextBlock {
  label: string
  policy: 'Pinned' | 'Replaced' | 'Window' | 'Summary' | 'Tool result'
  text: string
  tokens: number
}

export interface AgentTurn {
  fen: string
  info: SearchInfo
  reply?: string
  gameOver?: boolean
}

const systemPrompt = 'You play Black. Call legal_moves and analyze, then answer with one legal move in UCI, such as e7e5.'
const toolSpec = 'legal_moves(fen) → legal moves in UCI [chess.js]\nanalyze(fen, ms) → best move, depth, line [Stockfish]'

function numbered(plies: Move[], offset: number) {
  return plies.map((move, i) => {
    const ply = offset + i
    const number = Math.floor(ply / 2) + 1
    return ply % 2 === 0 ? `${number}. ${move.san}` : i === 0 ? `${number}... ${move.san}` : move.san
  }).join(' ')
}

function summarize(plies: Move[]) {
  const side = (color: 'w' | 'b') => {
    const captured = plies.filter((move) => move.color === color && move.captured).map((move) => pieceNames[move.captured!])
    return captured.length ? `${captured.length} (${captured.join(', ')})` : 'nothing'
  }
  const castled = (['w', 'b'] as const).filter((color) =>
    plies.some((move) => move.color === color && (move.isKingsideCastle() || move.isQueensideCastle())))
  return `Plies 1–${plies.length}: White captured ${side('w')}; Black captured ${side('b')}. `
    + `Castled: ${castled.length ? castled.map((color) => color === 'w' ? 'White' : 'Black').join(', ') : 'neither'}.`
}

function toolResults(turn: AgentTurn) {
  if (turn.gameOver) return []
  const legal = new Chess(turn.fen).moves({ verbose: true }).map((move) => move.lan)
  const { depth, pv } = turn.info
  return [
    `legal_moves → ${legal.length} moves: ${legal.join(' ')}`,
    pv?.length && depth !== undefined
      ? `analyze → depth ${depth}, best ${pv[0]}, line ${pv.slice(0, 4).join(' ')}`
      : 'analyze → still searching…',
  ]
}

/** `plies` ends with the player's latest move; `turns` is every turn so far, oldest first. */
export function buildAgentContext(plies: Move[], turns: AgentTurn[]) {
  const block = (label: string, policy: ContextBlock['policy'], text: string): ContextBlock =>
    ({ label, policy, text, tokens: estimateTokens(text) })
  const latest = turns.at(-1)!
  const cut = Math.max(0, plies.length - recentPlies)
  const blocks = [
    block('System prompt', 'Pinned', systemPrompt),
    block('Tool definitions', 'Pinned', toolSpec),
    block('Position', 'Replaced', `FEN ${latest.fen}`),
    ...(cut ? [block('Earlier moves', 'Summary', summarize(plies.slice(0, cut)))] : []),
    block('Recent moves', 'Window', numbered(plies.slice(cut), cut)),
    ...toolResults(latest).map((text) => block(text.startsWith('legal') ? 'legal_moves result' : 'analyze result', 'Tool result', text)),
  ]
  const used = blocks.reduce((sum, item) => sum + item.tokens, 0)
  // Earlier tool results are left out: the FEN already reflects every move they led to.
  const dropped = turns.slice(0, -1).reduce((sum, turn) => sum + estimateTokens(toolResults(turn).join('\n')), 0)
  // A naive harness resends a drawn board, every tool result, and every reply on every turn.
  const transcript = estimateTokens(systemPrompt + toolSpec) + turns.reduce((sum, turn) =>
    sum + estimateTokens(new Chess(turn.fen).ascii() + toolResults(turn).join('\n') + (turn.reply ?? '')), 0)
  return { blocks, used, dropped, transcript }
}
