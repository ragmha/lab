import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Chess } from 'chess.js'
import {
  buildAgentContext, candidateLine, contextBudget, describeMove, gameResult, legalEngineMove,
  parseSearchInfo, recentPlies, squares, type AgentTurn,
} from '../src/lib/chess'

test('the board contains all 64 unique squares, from a8 to h1', () => {
  assert.equal(squares.length, 64)
  assert.equal(new Set(squares).size, 64)
  assert.equal(squares[0], 'a8')
  assert.equal(squares.at(-1), 'h1')
})

test('UCI info reports only actual top-line telemetry, including zero values', () => {
  assert.deepEqual(parseSearchInfo('info depth 8 seldepth 10 multipv 1 score cp 24 nodes 408 time 0 pv e7e5 g1f3'), {
    depth: 8, nodes: 408, time: 0, pv: ['e7e5', 'g1f3'],
  })
  assert.deepEqual(parseSearchInfo('info nodes 0 time 12'), { nodes: 0, time: 12 })
  assert.equal(parseSearchInfo('info depth 9 multipv 2 nodes 700 pv e7e6'), null)
  assert.equal(parseSearchInfo('info string NNUE evaluation enabled'), null)
  assert.equal(parseSearchInfo('info string depth 99 nodes 5000'), null)
  assert.equal(parseSearchInfo('readyok'), null)
})

test('candidate lines are legal SAN forecasts and never alter the board', () => {
  const game = new Chess()
  game.move('e4')
  const fen = game.fen()
  assert.equal(candidateLine(fen, ['e7e5', 'g1f3', 'b8c6']), 'e5 → Nf3 → Nc6')
  assert.equal(candidateLine(fen, ['e7e4']), 'Candidate line could not be decoded.')
  assert.equal(game.fen(), fen)
  assert.deepEqual(game.history(), ['e4'])
})

test('engine replies must be legal in the current position', () => {
  const game = new Chess()
  game.move('e4')
  assert.equal(legalEngineMove(game, 'e7e5')?.san, 'e5')
  for (const invalid of ['e7e4', 'e2e4', '(none)', '0000', 'e7e5junk']) {
    assert.equal(legalEngineMove(game, invalid), undefined)
  }
  assert.equal(game.history().length, 1)
})

test('engine underpromotion is preserved and explained', () => {
  const game = new Chess('7k/8/8/8/8/8/p7/7K b - - 0 1')
  const move = legalEngineMove(game, 'a2a1n')
  assert.ok(move)
  assert.equal(move.promotion, 'n')
  assert.match(describeMove(game.move(move)), /promotes to a knight/)
})

test('move descriptions cover ordinary moves, en passant, and castling', () => {
  const game = new Chess()
  assert.equal(describeMove(game.move('e4')), 'Pawn e2 → e4.')
  for (const san of ['a6', 'e5', 'd5']) game.move(san)
  assert.match(describeMove(game.move('exd6')), /captures a pawn en passant/)
  const castling = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')
  assert.equal(describeMove(castling.move('O-O')), 'King castles kingside; the rook moves too.')
})

test('terminal positions explain who won or why play stopped', () => {
  const game = new Chess()
  assert.equal(gameResult(game), null)
  for (const san of ['f3', 'e5', 'g4']) game.move(san)
  const mate = game.move('Qh4#')
  assert.match(describeMove(mate), /Checkmate/)
  assert.equal(gameResult(game), 'Checkmate. Stockfish won.')
  assert.equal(gameResult(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')), 'Draw by stalemate.')
  assert.equal(gameResult(new Chess('7k/8/6K1/8/8/8/8/8 w - - 0 1')), 'Draw: insufficient material.')
})

test('repetition is detected from the complete game history', () => {
  const game = new Chess()
  for (const san of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) game.move(san)
  assert.equal(gameResult(game), 'Draw by threefold repetition.')
})

test('the agent context keeps state, windows recent moves, summarizes the rest, and stays in budget', () => {
  const game = new Chess()
  const turns: AgentTurn[] = []
  const line = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O', 'Nxe4', 'd4', 'exd4']
  for (let i = 0; i < line.length; i += 2) {
    game.move(line[i])
    turns.push({ fen: game.fen(), info: { depth: 9, pv: ['e7e5', 'g1f3'] }, reply: line[i + 1] })
    game.move(line[i + 1])
  }
  game.move('Re1')
  turns.push({ fen: game.fen(), info: {} })
  const { blocks, used, dropped, transcript } = buildAgentContext(game.history({ verbose: true }), turns)
  const text = (label: string) => blocks.find((block) => block.label === label)?.text
  assert.equal(text('Position'), `FEN ${game.fen()}`)
  assert.equal(text('Recent moves'), '3... Nf6 4. O-O Nxe4 5. d4 exd4 6. Re1')
  assert.equal(text('Recent moves')!.split(' ').filter((part) => !part.endsWith('.')).length, recentPlies)
  assert.equal(text('Earlier moves'), 'Plies 1–5: White captured nothing; Black captured nothing. Castled: neither.')
  assert.match(text('analyze result')!, /still searching/)
  assert.match(text('legal_moves result')!, new RegExp(`→ ${new Chess(game.fen()).moves().length} moves`))
  assert.equal(used, blocks.reduce((sum, block) => sum + block.tokens, 0))
  assert.ok(used <= contextBudget, 'The engineered context fits the budget')
  assert.ok(dropped > 0, 'Earlier tool results are dropped, not resent')
  assert.ok(transcript > contextBudget, 'Resending everything overflows within a few turns')
})

test('a finished game sends no tool results', () => {
  const game = new Chess()
  for (const move of ['f3', 'e5', 'g4']) game.move(move)
  const { blocks } = buildAgentContext(game.history({ verbose: true }), [{ fen: game.fen(), info: {}, gameOver: true }])
  assert.equal(blocks.some((block) => block.policy === 'Tool result'), false)
  assert.equal(blocks.some((block) => block.policy === 'Summary'), false)
})
