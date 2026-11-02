// Canvas front end for the Super Mona port: render.py and __init__.py from
// martinwoodward/super-mona (MIT), with keyboard and touch in place of badge buttons.
import {
  CHARACTER_ORDER, CHARACTERS, Controls, EMPTY, ITEM_NAMES, LEVELS, POLE, ROWS, Session, TILE, VIEW_H, VIEW_W, World, autopilot,
  type Hero, type Level,
} from '../lib/super-mona'

const SKY = { day: '#5c94fc', cave: '#000000', dusk: '#342c6e', cloud: '#96c8ff', castle: '#280814' }
const BLACK = '#000000'
const WHITE = '#ffffff'
const GOLD = '#ffd64a'
const DIM = 'rgba(0, 0, 0, 0.67)'
const PANEL = 'rgba(16, 12, 40, 0.88)'
const MAP_SOLID = '#c8783c'
const MAP_PLAYER = '#ff50c8'
const MAP_FLAG = '#50ff78'
const HUD = 7
const BIG = 13
const ITEM_SPRITES = { chip: 7, sparkle: 12, '1up': 11 }
const [STAND, WALK1, WALK2, JUMP, SKID, CROUCH, DEAD, CLIMB] = [0, 1, 2, 3, 4, 5, 6, 7]
const PAGES = ['PAUSED', 'MAP', 'ITEMS', 'HERO']
const DEMO_IDLE = 10
const DEMO_STAGES = 2
const HIGH_KEY = 'super-mona-high'

const canvas = document.getElementById('mona-screen') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
let scale = 4

const sheet = (name: string) => Object.assign(new Image(), { src: `/super-mona/${name}.png` })
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
const hero = (who: Hero, big: boolean, x: number, y: number, col = STAND, glow = false, mirror = false) =>
  blit(PLAYERS, 16, col, (who === 'ducky' ? 2 : 0) + (big ? 1 : 0) + (glow ? 4 : 0), x, y, mirror)
const int = Math.trunc
const pad = (n: number, width = 6) => String(int(n)).padStart(width, '0')
const font = (size: number) => `700 ${size}px "Super Mona HUD", ui-monospace, monospace`

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
  minimap: HTMLCanvasElement | null = null

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
      this.minimap = null
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
    hero(p.character, p.big, int(p.x) - 5 - cam, int(p.y + p.h) - 16, col, glow, p.facing < 0)
  }

  hud(world: World) {
    const s = world.session
    text(`${CHARACTERS[world.player.character].name} x${s.lives}`, 2, 0)
    mob(8, 52, 2)
    text(`x${pad(s.stars, 2)}`, 61, 0, GOLD)
    text(pad(s.score), 84, 0)
    text(String(int(world.timeLeft + 0.99)).padStart(3), 138, 0)
  }

  map(world: World, x: number, y: number, w: number, h: number) {
    const level = this.level
    if (!this.minimap) {
      const m = Object.assign(document.createElement('canvas'), { width: level.width, height: ROWS })
      const g = m.getContext('2d')!
      g.fillStyle = this.sky
      g.fillRect(0, 0, level.width, ROWS)
      g.fillStyle = MAP_SOLID
      level.tiles.forEach((id, i) => { if (id !== EMPTY && id !== POLE) g.fillRect(i % level.width, Math.floor(i / level.width), 1, 1) })
      this.minimap = m
    }
    ctx.drawImage(this.minimap, x, y, w, h)
    const sx = w / level.width
    const sy = h / ROWS
    ctx.fillStyle = WHITE
    ctx.fillRect(x + int((world.camX / TILE) * sx), y, 1, h)
    ctx.fillRect(x + int(((world.camX + VIEW_W) / TILE) * sx), y, 1, h)
    if (level.flagX !== null) {
      ctx.fillStyle = MAP_FLAG
      ctx.fillRect(x + int(level.flagX * sx), y + int(3 * sy), 2, int(9 * sy))
    }
    const p = world.player
    ctx.fillStyle = MAP_PLAYER
    ctx.fillRect(x + int((p.x / TILE) * sx) - 1, y + int((p.y / TILE) * sy) - 1, 3, 3)
  }
}

// Input: A = jump/confirm, B = run/back, menu = start/pause, like the badge.
type Button = 'left' | 'right' | 'up' | 'down' | 'a' | 'b' | 'menu'
const KEYS: Record<string, Button> = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  KeyZ: 'a', Space: 'a', KeyK: 'a', KeyX: 'b', ShiftLeft: 'b', ShiftRight: 'b', KeyJ: 'b', Enter: 'menu', Escape: 'menu', KeyP: 'menu',
}
const held = new Set<Button>()
const pressed = new Set<Button>()
const hit = (b: Button) => pressed.has(b)
const down = (b: Button) => held.has(b) || pressed.has(b)
const press = (b: Button) => { pressed.add(b); held.add(b) }

window.addEventListener('keydown', (e) => {
  const b = KEYS[e.code]
  if (!b || e.metaKey || e.ctrlKey || e.altKey) return
  // Let Space/Enter still activate a focused link or button.
  if ((e.code === 'Space' || e.code === 'Enter') && (e.target as Element).closest?.('a, button, input, select, textarea')) return
  e.preventDefault()
  if (!e.repeat) press(b)
})
window.addEventListener('keyup', (e) => { const b = KEYS[e.code]; if (b) held.delete(b) })
window.addEventListener('blur', () => held.clear())
for (const el of document.querySelectorAll<HTMLElement>('[data-btn]')) {
  const b = el.dataset.btn as Button
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); press(b) })
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(type, () => held.delete(b))
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

// App states, as in __init__.py.
type Mode = 'title' | 'intro' | 'play' | 'pause' | 'over' | 'win' | 'demo'
let mode: Mode = 'title'
let modeTime = 0
let high = 0
try { high = Number(localStorage.getItem(HIGH_KEY)) || 0 } catch {}
let session = new Session(high)
let world: World
let view: View
let titleWorld: World
let titleView: View
let demoControls = new Controls()
let demoNext = 0
let demoPlayed = 0
let page = 0
let cursor = 0

function setMode(next: Mode) { mode = next; modeTime = 0 }

function saveHigh() {
  if (session.high <= high) return
  high = session.high
  try { localStorage.setItem(HIGH_KEY, String(high)) } catch {}
}

function newGame() {
  session = new Session(high)
  startLevel()
}

function startLevel() {
  const level = LEVELS[session.level]()
  view = new View(level)
  world = new World(level, session)
  setMode('intro')
}

function startDemo() {
  const level = LEVELS[demoNext++ % LEVELS.length]()
  view = new View(level)
  world = new World(level, new Session())
  world.demo = true
  demoControls = new Controls()
  setMode('demo')
}

const start = () => hit('a') || hit('menu')

function drawTitle(t: number) {
  titleView.draw(titleWorld, t)
  centre('SUPER MONA', 22, GOLD, BIG)
  centre(`HIGH ${pad(high)}`, 44)
  if (int(t * 2) % 2) centre('PRESS START', 84)
  if (start()) newGame()
  else if (pressed.size) setMode('title')
  else if (modeTime > DEMO_IDLE) { demoPlayed = 0; startDemo() }
}

function drawDemo(dt: number, t: number) {
  if (pressed.size) {
    if (start()) newGame()
    else { setMode('title'); drawTitle(t) }
    return
  }
  world.step(dt, autopilot(world, demoControls))
  view.draw(world, t)
  view.hud(world)
  if (modeTime < 2) centre(world.level.name, 30, WHITE, BIG)
  if (int(t * 2) % 2) centre('PRESS START', 84)
  if (world.state === 'clear' || world.state === 'dead' || modeTime > 60) {
    if (++demoPlayed < DEMO_STAGES) startDemo()
    else setMode('title')
  }
}

function drawIntro(t: number) {
  view.draw(world, t)
  panel(26, world.level.canSwitch ? 76 : 56)
  centre(world.level.name, 34, WHITE, BIG)
  hero(session.character, session.big, 62, 58)
  text(`x ${session.lives}`, 84, 62)
  if (world.level.canSwitch) centre('SWAP HERO IN PAUSE MENU', 92, GOLD)
  if (t > 2 || (t > 0.4 && hit('a'))) setMode('play')
}

function play(dt: number, t: number) {
  if (hit('menu') && world.state === 'play') {
    page = cursor = 0
    setMode('pause')
    return drawPaused(t)
  }
  world.step(dt, readControls())
  view.draw(world, t)
  view.hud(world)
  if (world.state === 'dead') {
    session.lives -= 1
    saveHigh()
    if (session.lives > 0) startLevel()
    else setMode('over')
  } else if (world.state === 'clear') {
    saveHigh()
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
  if (hit('left')) page = (page + PAGES.length - 1) % PAGES.length
  if (hit('right')) page = (page + 1) % PAGES.length
  let x = 6
  PAGES.forEach((name, i) => {
    text(name, x, 14, i === page ? GOLD : WHITE)
    x += ctx.measureText(name).width + 10
  })
  panel(30, 70)
  const name = PAGES[page]
  if (name === 'PAUSED') {
    centre(world.level.name, 36)
    centre(`SCORE ${pad(session.score)}`, 50)
    centre(`HIGH  ${pad(Math.max(session.high, high))}`, 62)
  } else if (name === 'MAP') {
    centre(world.level.name, 34)
    view.map(world, 12, 50, 136, 45)
  } else if (name === 'ITEMS') {
    const inv = session.inventory
    if (!inv.length) {
      centre('NO ITEMS YET', 50)
      centre('SPARE CHIPS GO HERE', 66)
    } else {
      if (hit('up')) cursor = (cursor + inv.length - 1) % inv.length
      if (hit('down')) cursor = (cursor + 1) % inv.length
      cursor = Math.min(cursor, inv.length - 1)
      inv.forEach((kind, i) => {
        const y = 36 + i * 16
        mob(ITEM_SPRITES[kind], 30, y + 2)
        text(ITEM_NAMES[kind], 44, y, i === cursor ? GOLD : WHITE)
        if (i === cursor) text('>', 20, y, GOLD)
      })
      if (hit('a') && world.useItem(cursor)) return setMode('play')
    }
  } else {
    CHARACTER_ORDER.forEach((who, i) => {
      const hx = 34 + i * 60
      hero(who, session.big, hx + 8, 38)
      text(CHARACTERS[who].name, hx + 4, 56, who === world.player.character ? GOLD : WHITE)
    })
    centre(CHARACTERS[world.player.character].about, 70)
    if (world.level.canSwitch) {
      centre('A: SWAP HERO', 84, GOLD)
      if (hit('a')) world.switchCharacter()
    } else centre('NO SWAP ON THIS STAGE', 84)
  }
  centre('< > PAGE   START/B RESUME', 108, GOLD)
  // modeTime is 0 on the frame Start opened the pause screen; ignore that press.
  if (modeTime > 0 && (hit('menu') || hit('b'))) setMode('play')
}

function drawEnd(t: number, title: string) {
  ctx.fillStyle = BLACK
  ctx.fillRect(0, 0, VIEW_W, VIEW_H)
  centre(title, 30, GOLD, BIG)
  centre(`SCORE ${pad(session.score)}`, 56)
  centre(`HIGH  ${pad(high)}`, 68)
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
  if (mode === 'title') drawTitle(t)
  else if (mode === 'intro') drawIntro(modeTime)
  else if (mode === 'play') play(dt, t)
  else if (mode === 'pause') drawPaused(t)
  else if (mode === 'demo') drawDemo(dt, t)
  else drawEnd(modeTime, mode === 'over' ? 'GAME OVER' : 'YOU WIN!')
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
const hudFont = new FontFace('Super Mona HUD', 'url(/fonts/jetbrains-mono/JetBrainsMono-Bold.woff2)', { weight: '700' })
document.fonts.add(hudFont)
Promise.all([hudFont.load().catch(() => null), ...[TILES, PLAYERS, MOBS].map((img) => img.decode())]).then(() => {
  const level = LEVELS[0]()
  titleView = new View(level)
  titleWorld = new World(level, new Session())
  requestAnimationFrame(frame)
})
