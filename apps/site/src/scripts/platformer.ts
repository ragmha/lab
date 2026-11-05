// Canvas front end for the pixel platformer, with keyboard, touch, and gamepad controls.
import {
  Controls, EMPTY, LEVELS, ROWS, Session, TILE, VIEW_H, VIEW_W, World,
  type GameEvent, type Level,
} from '../lib/platformer'

const SKY = { day: '#5c94fc', cave: '#000000', dusk: '#342c6e', cloud: '#96c8ff', castle: '#280814' }
const BLACK = '#000000'
const WHITE = '#ffffff'
const GOLD = '#ffd64a'
const DIM = 'rgba(0, 0, 0, 0.67)'
const PANEL = 'rgba(16, 12, 40, 0.88)'
const HUD = 7
const BIG = 13
const ITEM_SPRITES = { chip: 7, sparkle: 12, '1up': 11 }
const [STAND, WALK1, WALK2, JUMP, SKID, CROUCH, DEAD, CLIMB] = [0, 1, 2, 3, 4, 5, 6, 7]

const canvas = document.getElementById('game-screen') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
let scale = 4

const sheet = (name: string) => Object.assign(new Image(), { src: `/platformer/${name}.png` })
const TILES = sheet('tiles')
const PLAYERS = sheet('players')
const MOBS = sheet('mobs')

function blit(img: HTMLImageElement, size: number, col: number, row: number, x: number, y: number, flipX = false, flipY = false, g = ctx) {
  if (!flipX && !flipY) return g.drawImage(img, col * size, row * size, size, size, x, y, size, size)
  g.save()
  g.translate(x + (flipX ? size : 0), y + (flipY ? size : 0))
  g.scale(flipX ? -1 : 1, flipY ? -1 : 1)
  g.drawImage(img, col * size, row * size, size, size, 0, 0, size, size)
  g.restore()
}
const tile = (id: number, x: number, y: number, g = ctx) => blit(TILES, TILE, id % 16, id >> 4, x, y, false, false, g)
const mob = (i: number, x: number, y: number, flipX = false, flipY = false) => blit(MOBS, TILE, i % 8, i >> 3, x, y, flipX, flipY)
const hero = (big: boolean, x: number, y: number, col = STAND, glow = false, mirror = false) =>
  blit(PLAYERS, 16, col, (big ? 1 : 0) + (glow ? 2 : 0), x, y, mirror)
const int = Math.trunc
const pad = (n: number, width = 6) => String(int(n)).padStart(width, '0')
const font = (size: number) => `700 ${size}px "Pixel Game HUD", ui-monospace, monospace`

function text(msg: string, x: number, y: number, pen = WHITE, size = HUD) {
  ctx.font = font(size)
  ctx.fillStyle = BLACK
  ctx.fillText(msg, x + 1, y + 1)
  ctx.fillStyle = pen
  ctx.fillText(msg, x, y)
}

function centre(msg: string, y: number, pen = WHITE, size = HUD) {
  ctx.font = font(size)
  const w = ctx.measureText(msg).width
  if (w > VIEW_W - 12) size *= (VIEW_W - 12) / w
  ctx.font = font(size)
  text(msg, (VIEW_W - ctx.measureText(msg).width) / 2, y, pen, size)
}

function panel(y: number, h: number) {
  ctx.fillStyle = PANEL
  ctx.fillRect(8, y, 144, h)
}

/** The whole stage is pre-rendered once; each frame blits a 160x120 window of it. */
class View {
  stage = document.createElement('canvas')
  g: CanvasRenderingContext2D
  sky: string

  constructor(public level: Level) {
    this.sky = SKY[level.theme]
    this.stage.width = level.width * TILE
    this.stage.height = VIEW_H
    this.g = this.stage.getContext('2d')!
    this.g.fillStyle = this.sky
    this.g.fillRect(0, 0, this.stage.width, VIEW_H)
    for (let i = 0; i < level.width * ROWS; i++) this.cell(i, false)
    level.dirty.length = 0
  }

  cell(i: number, clear = true) {
    const { level, g } = this
    const x = (i % level.width) * TILE
    const y = Math.floor(i / level.width) * TILE
    if (clear) { g.fillStyle = this.sky; g.fillRect(x, y, TILE, TILE) }
    const decor = level.decor.get(i)
    if (decor !== undefined) tile(decor, x, y, g)
    if (level.tiles[i] !== EMPTY) tile(level.tiles[i], x, y, g)
  }

  draw(world: World, t: number) {
    const level = this.level
    if (level.dirty.length) {
      for (const i of level.dirty) this.cell(i)
      level.dirty.length = 0
    }
    const cam = int(world.camX)
    ctx.drawImage(this.stage, cam, 0, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H)

    for (const b of world.bumps) {
      const x = b.tx * TILE - cam
      if (x < -TILE || x > VIEW_W) continue
      ctx.fillStyle = this.sky
      ctx.fillRect(x, b.ty * TILE, TILE, TILE)
      tile(b.tile, x, b.ty * TILE - int(4 * Math.sin(Math.PI * Math.min(b.age / 0.16, 1))))
    }

    const star = 8 + (int(t * 6) % 3)
    const left = Math.floor(cam / TILE) - 1
    for (const i of level.stars) {
      const tx = i % level.width
      if (tx >= left && tx <= left + VIEW_W / TILE + 2) mob(star, tx * TILE - cam, Math.floor(i / level.width) * TILE)
    }

    for (const item of world.items) {
      const x = int(item.x) - cam
      if (x < -TILE || x > VIEW_W) continue
      mob(ITEM_SPRITES[item.kind], x, int(item.y))
      if (item.emerge > 0) {
        // Keep the item behind its block while it rises out.
        const by = int(item.targetY) + TILE
        tile(level.get(Math.floor(int(item.x) / TILE), Math.floor(by / TILE)), x, by)
      }
    }

    if (level.flagX !== null && world.flagY !== null) {
      const x = level.flagX * TILE - 4 - cam
      if (x > -TILE && x < VIEW_W) mob(14, x, int(world.flagY))
    }

    const step = int(t * 6) % 2
    for (const e of world.enemies) {
      if (!e.active) continue
      const x = int(e.x) - 1 - cam
      if (x < -TILE || x > VIEW_W) continue
      let index = 5
      let flip = false
      if (e.kind === 'bug') index = e.state === 'squashed' ? 2 : step
      else if (e.state === 'walk') { index = 3 + step; flip = e.vx > 0 }
      else if (e.state === 'shell' && e.timer > 4) index = 5 + step
      mob(index, x, int(e.y + e.h) - TILE, flip && e.state !== 'dead', e.state === 'dead')
    }

    this.drawPlayer(world, cam, t)

    for (const q of world.particles) {
      const x = int(q.x) - cam
      if (q.kind === 'score') text(String(q.data), x, int(q.y))
      else mob(q.kind === 'debris' ? 13 : q.kind === 'star' ? 8 + (int(t * 12) % 3) : 12, x, int(q.y))
    }
  }

  drawPlayer(world: World, cam: number, t: number) {
    const p = world.player
    const state = world.state
    const door = world.level.castleDoor
    if ((state === 'tally' || state === 'clear') && door && p.x >= door - 4) return
    if (p.invulnerable > 0 && int(t * 20) % 2) return
    const col = p.dead ? DEAD
      : state === 'flag' ? CLIMB
      : p.crouch ? CROUCH
      : !p.onGround && state === 'play' ? JUMP
      : p.skidding ? SKID
      : Math.abs(p.vx) > 1 || state === 'castle' ? (int(p.walkPhase / 6) % 2 ? WALK1 : WALK2)
      : STAND
    const glow = p.sparkle > 0 && int(t * 12) % 2 === 1
    hero(p.big, int(p.x) - 5 - cam, int(p.y + p.h) - 16, col, glow, p.facing < 0)
  }

  hud(world: World) {
    const s = world.session
    text(`PLAYER 1 x${s.lives}`, 2, 0)
    mob(8, 52, 2)
    text(`x${pad(s.stars, 2)}`, 61, 0, GOLD)
    text(pad(s.score), 84, 0)
    text(String(int(world.timeLeft + 0.99)).padStart(3), 138, 0)
  }

}

// Synthesized effects follow game events and a few app screens.
type Sound = GameEvent | 'pause' | 'over' | 'win' | 'tick'
const SOUND_KEY = 'platformer-sound'
const soundButton = document.getElementById('sound-toggle')
let audio: AudioContext | undefined
let out: GainNode
let soundOn = true
try { soundOn = localStorage.getItem(SOUND_KEY) !== 'off' } catch {}

function unlockAudio() {
  if (!soundOn || audio?.state === 'running') return
  if (!audio) {
    audio = new AudioContext()
    audio.addEventListener('statechange', paintSound)
    out = new GainNode(audio, { gain: 0.25 })
    out.connect(audio.destination)
  }
  audio.resume().catch((error: unknown) => console.error('Unable to enable game audio', error))
}

function setSound(on: boolean) {
  soundOn = on
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off') } catch {}
  if (on) unlockAudio()
  // Closing drops notes already scheduled; a suspended context would play them on unmute.
  else { audio?.close(); audio = undefined }
  paintSound()
}

function paintSound() {
  if (!soundButton) return
  const active = soundOn && audio?.state === 'running'
  const label = !soundOn ? 'Unmute' : active ? 'Mute' : 'Enable'
  soundButton.textContent = `${label.toUpperCase()}${label === 'Enable' ? ' SOUND' : ''}`
  soundButton.title = `${label} sound (M)${label === 'Enable' ? ' — click or press M to activate audio' : ''}`
  soundButton.hidden = false
}

function voice(source: AudioScheduledSourceNode, at: number, length: number, volume: number) {
  const gain = new GainNode(audio!)
  gain.gain.setValueAtTime(volume, at)
  gain.gain.exponentialRampToValueAtTime(0.001, at + length)
  source.connect(gain).connect(out)
  source.start(at)
  source.stop(at + length)
}

function note(from: number, to: number, length: number, delay = 0, type: OscillatorType = 'square', volume = 0.5) {
  const at = audio!.currentTime + delay
  const osc = new OscillatorNode(audio!, { type })
  osc.frequency.setValueAtTime(from, at)
  osc.frequency.exponentialRampToValueAtTime(to, at + length)
  voice(osc, at, length, volume)
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
const tune = (notes: number[], step: number, type?: OscillatorType, volume?: number) =>
  notes.forEach((m, i) => note(hz(m), hz(m), step * 2, i * step, type, volume))

function noise(length: number, volume = 0.5) {
  const a = audio!
  const buffer = a.createBuffer(1, Math.ceil(a.sampleRate * length), a.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  voice(new AudioBufferSourceNode(a, { buffer }), a.currentTime, length, volume)
}

const SOUNDS: Record<Sound, () => void> = {
  jump: () => note(260, 620, 0.14, 0, 'square', 0.35),
  star: () => tune([84, 91], 0.06),
  '1up': () => tune([79, 84, 88, 91, 96], 0.07),
  kick: () => note(330, 140, 0.09, 0, 'square', 0.4),
  shrink: () => tune([79, 75, 72, 67, 63], 0.07, 'square', 0.35),
  die: () => tune([72, 67, 64, 60, 55, 48], 0.15, 'triangle', 0.8),
  grow: () => tune([60, 64, 67, 72, 76, 79, 84], 0.045),
  sparkle: () => tune([84, 88, 91, 96, 100, 103, 108], 0.035, 'triangle', 0.7),
  item: () => note(200, 800, 0.3, 0, 'triangle', 0.8),
  break: () => { noise(0.2); note(180, 50, 0.18, 0, 'square', 0.3) },
  bump: () => note(150, 90, 0.08, 0, 'triangle', 0.9),
  pickup: () => tune([69, 76], 0.04, 'square', 0.35),
  stomp: () => note(520, 140, 0.1, 0, 'square', 0.45),
  defeat: () => note(700, 110, 0.22, 0, 'square', 0.4),
  flag: () => tune([67, 72, 76, 79, 84, 88], 0.08),
  pause: () => tune([81, 76], 0.06, 'square', 0.35),
  over: () => tune([67, 64, 60, 55], 0.25, 'triangle', 0.8),
  win: () => tune([72, 76, 79, 84, 79, 84, 88, 91, 96], 0.1),
  tick: () => note(1500, 1500, 0.03, 0, 'square', 0.15),
}
const sfx = (name: Sound) => { if (soundOn && audio?.state === 'running') SOUNDS[name]() }

paintSound()
const toggleSound = () => setSound(!soundOn || audio?.state !== 'running')
soundButton?.addEventListener('click', toggleSound)
for (const type of ['keydown', 'pointerdown', 'pointerup', 'touchend']) window.addEventListener(type, (e) => {
  if ((e.target instanceof Element && e.target.closest('#sound-toggle')) || (e instanceof KeyboardEvent && e.code === 'KeyM')) return
  unlockAudio()
})
// A clicked header button would keep focus and take Space and Enter away from the game.
document.querySelector('.app-actions')?.addEventListener('mousedown', (e) => e.preventDefault())

// A jumps/confirms, B runs/goes back, menu starts/pauses, and home returns to title.
type Button = 'left' | 'right' | 'up' | 'down' | 'a' | 'b' | 'menu' | 'home'
const KEYS: Record<string, Button> = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  KeyZ: 'a', Space: 'a', KeyK: 'a', KeyX: 'b', ShiftLeft: 'b', ShiftRight: 'b', KeyJ: 'b', Enter: 'menu', Escape: 'menu', KeyP: 'menu',
  Home: 'home',
}
// Standard-mapping gamepads: d-pad or left stick, A jump, B or X run, Start, Back or Guide for home.
const PAD_BUTTONS: [number, Button][] = [[12, 'up'], [13, 'down'], [14, 'left'], [15, 'right'], [0, 'a'], [1, 'b'], [2, 'b'], [9, 'menu'], [8, 'home'], [16, 'home']]
// Holds are kept per key or pointer, so letting go of one of two keys for a button keeps it down.
const held = new Map<string, Button>()
const pressed = new Set<Button>()
let padHeld = new Set<Button>()
let padSeen = false
const hit = (b: Button) => pressed.has(b)
const down = (b: Button) => pressed.has(b) || padHeld.has(b) || [...held.values()].includes(b)
const press = (source: string, b: Button) => { if (!down(b)) pressed.add(b); held.set(source, b) }

// Browsers expose a pad only after one of its buttons is pressed on this page.
window.addEventListener('gamepadconnected', () => { padSeen = true })
function pollPads() {
  // Pads keep reporting while another window has focus, so only read them while this page has it.
  if (!padSeen || document.hidden || !document.hasFocus()) return
  const now = new Set<Button>()
  for (const gp of navigator.getGamepads()) {
    // Other layouts number their buttons differently, so a face button could quit the level.
    if (gp?.mapping !== 'standard') continue
    for (const [i, b] of PAD_BUTTONS) if (gp.buttons[i]?.pressed) now.add(b)
    const [x = 0, y = 0] = gp.axes
    if (x < -0.5) now.add('left')
    if (x > 0.5) now.add('right')
    if (y < -0.5) now.add('up')
    if (y > 0.5) now.add('down')
  }
  for (const b of now) if (!down(b)) pressed.add(b)
  padHeld = now
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.code === 'KeyM' && !e.repeat) return toggleSound()
  const el = e.target as HTMLElement
  let b = KEYS[e.code]
  // Space/Enter press a focused on-screen button, and still activate any other link or button.
  if (e.code === 'Space' || e.code === 'Enter') {
    if (el.dataset?.btn) b = el.dataset.btn as Button
    else if (el.closest?.('a, button, input, select, textarea')) return
  }
  if (!b) return
  e.preventDefault()
  if (!e.repeat) press(e.code, b)
})
window.addEventListener('keyup', (e) => held.delete(e.code))
// Keys let go while the page is in the background never report it, so drop everything.
const release = () => { held.clear(); pressed.clear(); padHeld.clear() }
window.addEventListener('blur', release)
document.addEventListener('visibilitychange', release)
for (const el of document.querySelectorAll<HTMLElement>('[data-btn]')) {
  const b = el.dataset.btn as Button
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); press(`pointer${e.pointerId}`, b) })
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) el.addEventListener(type, (e) => held.delete(`pointer${e.pointerId}`))
}

const controls = new Controls()
function readControls() {
  controls.left = down('left')
  controls.right = down('right')
  controls.up = down('up')
  controls.down = down('down')
  controls.jumpPressed = hit('a')
  controls.jump = down('a')
  controls.run = down('b')
  return controls
}

type Mode = 'title' | 'intro' | 'play' | 'pause' | 'over' | 'win'
let mode: Mode = 'title'
let modeTime = 0
let session = new Session()
let world: World
let view: View
let titleWorld: World
let titleView: View

function setMode(next: Mode) {
  if (next === 'pause' || next === 'over' || next === 'win') sfx(next)
  mode = next
  modeTime = 0
}

function newGame() {
  session = new Session()
  startLevel()
}

function startLevel() {
  const level = LEVELS[session.level]()
  view = new View(level)
  world = new World(level, session)
  setMode('intro')
}

const start = () => hit('a') || hit('menu')

function drawTitle(t: number) {
  titleView.draw(titleWorld, t)
  centre('PIXEL PLATFORMER', 22, GOLD, BIG)
  if (int(t * 2) % 2) centre('PRESS START', 84)
  if (start()) newGame()
}

function drawIntro(t: number) {
  view.draw(world, t)
  panel(26, 56)
  centre(world.level.name, 34, WHITE, BIG)
  hero(session.big, 62, 58)
  text(`x ${session.lives}`, 84, 62)
  if (t > 2 || (t > 0.4 && hit('a'))) setMode('play')
}

function play(dt: number, t: number) {
  if (hit('menu') && world.state === 'play') {
    setMode('pause')
    return drawPaused(t)
  }
  world.step(dt, readControls())
  view.draw(world, t)
  view.hud(world)
  // The time bonus counts down with a tick, about 15 a second at any frame rate.
  if (world.state === 'tally' && world.timeLeft > 0 && int(t * 15) !== int((t - dt) * 15)) sfx('tick')
  if (world.state === 'dead') {
    session.lives -= 1
    if (session.lives > 0) startLevel()
    else setMode('over')
  } else if (world.state === 'clear') {
    session.level += 1
    if (session.level >= LEVELS.length) setMode('win')
    else startLevel()
  }
}

function drawPaused(t: number) {
  view.draw(world, t)
  view.hud(world)
  ctx.fillStyle = DIM
  ctx.fillRect(0, 10, VIEW_W, VIEW_H - 10)
  centre('PAUSED', 14, GOLD)
  panel(30, 70)
  centre(world.level.name, 36)
  centre(`SCORE ${pad(session.score)}`, 50)
  centre('HOME TO TITLE', 80, GOLD)
  centre('START/B RESUME', 108, GOLD)
  // modeTime is 0 on the frame Start opened the pause screen; ignore that press.
  if (modeTime > 0 && (hit('menu') || hit('b'))) setMode('play')
}

function drawEnd(t: number, title: string) {
  ctx.fillStyle = BLACK
  ctx.fillRect(0, 0, VIEW_W, VIEW_H)
  centre(title, 30, GOLD, BIG)
  centre(`SCORE ${pad(session.score)}`, 56)
  if (t > 1 && int(t * 2) % 2) centre('PRESS START', 92)
  if (t > 1 && start()) setMode('title')
}

let last = 0
function frame(now: number) {
  const dt = last ? Math.min(now - last, 50) / 1000 : 0
  last = now
  modeTime += dt
  const t = now / 1000
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  pollPads()
  if (hit('home') && mode !== 'title') {
    setMode('title')
  }
  if (mode === 'title') drawTitle(t)
  else if (mode === 'intro') drawIntro(modeTime)
  else if (mode === 'play') play(dt, t)
  else if (mode === 'pause') drawPaused(t)
  else drawEnd(modeTime, mode === 'over' ? 'GAME OVER' : 'YOU WIN!')
  const events = world?.session.events
  if (events?.length) {
    events.forEach(sfx)
    events.length = 0
  }
  pressed.clear()
  requestAnimationFrame(frame)
}

// Draw at a whole multiple of 160x120 near the displayed size so pixels and text stay crisp.
new ResizeObserver(() => {
  scale = Math.max(2, Math.round((canvas.clientWidth * devicePixelRatio) / VIEW_W))
  canvas.width = VIEW_W * scale
  canvas.height = VIEW_H * scale
  ctx.imageSmoothingEnabled = false
  ctx.textBaseline = 'top'
}).observe(canvas)

// The site face uses font-display: optional, which a cold canvas load can miss for the whole page.
const hudFont = new FontFace('Pixel Game HUD', 'url(/fonts/jetbrains-mono/JetBrainsMono-Bold.woff2)', { weight: '700' })
document.fonts.add(hudFont)
Promise.all([hudFont.load().catch(() => null), ...[TILES, PLAYERS, MOBS].map((img) => img.decode())]).then(() => {
  const level = LEVELS[0]()
  titleView = new View(level)
  titleWorld = new World(level, new Session())
  requestAnimationFrame(frame)
})
