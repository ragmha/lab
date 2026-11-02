// Super Mona rules and stages, ported from martinwoodward/super-mona
// (super_mona/game.py and levels.py, MIT). Pure logic: no DOM, so tests run it headless.

export const TILE = 8
export const ROWS = 15
export const VIEW_W = 160
export const VIEW_H = 120

export const EMPTY = 0
const GROUND_TOP = 1
const GROUND = 2
export const BRICK = 3
const QUESTION = 4
export const USED = 5
const HARD = 6
const PIPE_TL = 7
const PIPE_TR = 8
const PIPE_L = 9
const PIPE_R = 10
export const POLE = 11
const POLE_TOP = 12
const GIRDER = 13
const CAVE_GROUND = 14
const CAVE_BRICK = 15
const HILL = 16
const BUSH = 22
const CLOUD = 25
const CASTLE = 31

const SOLID = new Set([GROUND_TOP, GROUND, BRICK, QUESTION, USED, HARD, PIPE_TL, PIPE_TR, PIPE_L, PIPE_R, GIRDER, CAVE_GROUND, CAVE_BRICK])
const BREAKABLE = new Set([BRICK, CAVE_BRICK])

export type Theme = 'day' | 'cave' | 'dusk' | 'cloud' | 'castle'
export type Hero = 'mona' | 'ducky'
export type ItemKind = 'chip' | 'sparkle' | '1up'

export const CHARACTERS = {
  mona: { name: 'MONA', walk: 50, run: 82, accel: 190, decel: 170, skid: 420, jump: 152, runJump: 168, gravHold: 300, grav: 900, about: 'Balanced grip' },
  ducky: { name: 'DUCKY', walk: 50, run: 78, accel: 150, decel: 100, skid: 300, jump: 166, runJump: 180, gravHold: 280, grav: 820, about: 'Floaty jumps, slippery' },
}
export const CHARACTER_ORDER: Hero[] = ['mona', 'ducky']
const MAX_FALL = 210
const SMALL_H = 11
const BIG_H = 15
const STOMP_BOUNCE = 120
const SHELL_SPEED = 135
const INVENTORY_SIZE = 3
export const ITEM_NAMES: Record<ItemKind, string> = { chip: 'POWER CHIP', sparkle: 'SPARKLE', '1up': '1-UP' }

const tileOf = (value: number) => Math.floor(value / TILE)
const overlap = (ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) =>
  ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah
const range = (a: number, b: number, step = 1) => { const out = []; for (let i = a; i < b; i += step) out.push(i); return out }

export class Controls {
  left = false; right = false; up = false; down = false
  jump = false; jumpPressed = false; run = false
}

export class Level {
  tiles: Uint8Array
  decor = new Map<number, number>()
  contents = new Map<number, string>()
  stars = new Set<number>()
  spawns: [number, number, 'bug' | 'shellbot'][] = []
  start: [number, number] = [2, 12]
  flagX: number | null = null
  castleDoor: number | null = null
  dirty: number[] = []

  constructor(public name: string, public width: number, public theme: Theme = 'day', public time = 300, public canSwitch = false) {
    this.tiles = new Uint8Array(width * ROWS)
  }

  get dark() { return this.theme === 'cave' || this.theme === 'castle' }
  index(tx: number, ty: number) { return ty * this.width + tx }
  get(tx: number, ty: number) {
    if (tx < 0 || tx >= this.width) return HARD
    if (ty < 0 || ty >= ROWS) return EMPTY
    return this.tiles[ty * this.width + tx]
  }
  set(tx: number, ty: number, tile: number) {
    if (tx < 0 || tx >= this.width || ty < 0 || ty >= ROWS) return
    const i = ty * this.width + tx
    if (this.tiles[i] !== tile) { this.tiles[i] = tile; this.dirty.push(i) }
  }
  solid(tx: number, ty: number) { return SOLID.has(this.get(tx, ty)) }

  ground(x0: number, x1: number, top = 13) {
    for (let x = x0; x <= x1; x++) for (let y = top; y < ROWS; y++) this.set(x, y, this.dark ? CAVE_GROUND : y === top ? GROUND_TOP : GROUND)
  }
  ceiling(x0: number, x1: number, rows = [2]) {
    for (let x = x0; x <= x1; x++) for (const y of rows) this.set(x, y, CAVE_BRICK)
  }
  /** B brick, Q question, H hard, = girder, o floating star, - nothing. */
  row(x: number, y: number, text: string, content?: string) {
    ;[...text].forEach((ch, i) => {
      const tx = x + i
      if (ch === 'B') this.set(tx, y, this.dark ? CAVE_BRICK : BRICK)
      else if (ch === 'Q') { this.set(tx, y, QUESTION); this.contents.set(this.index(tx, y), content ?? 'star') }
      else if (ch === 'H') this.set(tx, y, HARD)
      else if (ch === '=') this.set(tx, y, GIRDER)
      else if (ch === 'o') this.stars.add(this.index(tx, y))
    })
  }
  block(x: number, y: number, content: string, brick = false) {
    this.set(x, y, brick ? (this.dark ? CAVE_BRICK : BRICK) : QUESTION)
    this.contents.set(this.index(x, y), content)
  }
  starLine(x: number, y: number, count: number) { for (let i = 0; i < count; i++) this.stars.add(this.index(x + i, y)) }
  pipe(x: number, height: number, base = 13) {
    const top = base - height
    this.set(x, top, PIPE_TL); this.set(x + 1, top, PIPE_TR)
    for (let y = top + 1; y < base; y++) { this.set(x, y, PIPE_L); this.set(x + 1, y, PIPE_R) }
  }
  stairs(x: number, height: number, up = true, base = 13) {
    for (let i = 0; i < height; i++) {
      const column = up ? i + 1 : height - i
      for (let j = 0; j < column; j++) this.set(x + i, base - 1 - j, HARD)
    }
  }
  enemy(x: number, kind: 'bug' | 'shellbot' = 'bug', y = 12) { this.spawns.push([x, y, kind]) }
  hill(x: number, base = 13) { for (let i = 0; i < 6; i++) this.decor.set(this.index(x + i % 3, base - 2 + Math.floor(i / 3)), HILL + i) }
  bush(x: number, base = 13) { for (let i = 0; i < 3; i++) this.decor.set(this.index(x + i, base - 1), BUSH + i) }
  cloud(x: number, y: number) { for (let i = 0; i < 6; i++) this.decor.set(this.index(x + i % 3, y + Math.floor(i / 3)), CLOUD + i) }
  flag(x: number, base = 13) {
    this.set(x, base - 1, HARD)
    this.set(x, base - 10, POLE_TOP)
    for (let y = base - 9; y < base - 1; y++) this.set(x, y, POLE)
    this.flagX = x
    const castleX = x + 5
    for (let i = 0; i < 25; i++) {
      const tx = castleX + i % 5
      if (tx >= 0 && tx < this.width) this.decor.set(this.index(tx, base - 5 + Math.floor(i / 5)), CASTLE + i)
    }
    this.castleDoor = castleX * TILE + 18
  }
}

class Body {
  vx = 0
  vy = 0
  onGround = false
  constructor(public x: number, public y: number) {}
  get w() { return 6 }
  get h() { return 7 }

  moveX(level: Level, dt: number) {
    this.x += this.vx * dt
    const top = tileOf(this.y), bottom = tileOf(this.y + this.h - 0.01)
    if (this.vx > 0) {
      const tx = tileOf(this.x + this.w - 0.01)
      for (let ty = top; ty <= bottom; ty++) if (level.solid(tx, ty)) { this.x = tx * TILE - this.w; return true }
    } else if (this.vx < 0) {
      const tx = tileOf(this.x)
      for (let ty = top; ty <= bottom; ty++) if (level.solid(tx, ty)) { this.x = (tx + 1) * TILE; return true }
    }
    return false
  }

  /** Returns the tiles hit by the head, if any. */
  moveY(level: Level, dt: number): [number[], number] | null {
    this.y += this.vy * dt
    this.onGround = false
    const left = tileOf(this.x), right = tileOf(this.x + this.w - 0.01)
    if (this.vy >= 0) {
      const ty = tileOf(this.y + this.h - 0.01)
      for (let tx = left; tx <= right; tx++) {
        if (level.solid(tx, ty) && this.y + this.h - this.vy * dt <= ty * TILE + 0.5 + Math.abs(this.vy * dt)) {
          this.y = ty * TILE - this.h
          this.vy = 0
          this.onGround = true
          return null
        }
      }
    } else {
      const ty = tileOf(this.y)
      const hits = range(left, right + 1).filter((tx) => level.solid(tx, ty))
      if (hits.length) { this.y = (ty + 1) * TILE; this.vy = 0; return [hits, ty] }
    }
    return null
  }
}

export class Player extends Body {
  facing = 1
  crouch = false
  jumpBuffer = 0
  coyote = 0
  invulnerable = 0
  sparkle = 0
  carrying: Enemy | null = null
  stompChain = 0
  walkPhase = 0
  skidding = false
  dead = false
  constructor(x: number, y: number, public character: Hero, public big = false) { super(x, y) }
  get h() { return this.big ? BIG_H : SMALL_H }
  stats() { return CHARACTERS[this.character] }
}

export type EnemyState = 'walk' | 'shell' | 'kicked' | 'carried' | 'squashed' | 'dead'
export class Enemy extends Body {
  state: EnemyState = 'walk'
  vx = -18
  timer = 0
  active = false
  grace = 0
  alive = true
  constructor(x: number, y: number, public kind: 'bug' | 'shellbot') { super(x, y) }
}

export class Item extends Body {
  emerge = 0.5
  targetY: number
  alive = true
  constructor(x: number, y: number, public kind: ItemKind) { super(x, y); this.targetY = y - TILE }
  get w() { return 8 }
  get h() { return 8 }
}

export type Particle = { kind: 'debris' | 'star' | 'score' | 'sparkle'; x: number; y: number; vx: number; vy: number; age: number; data?: number }
export type Bump = { tx: number; ty: number; tile: number; age: number }
export type WorldState = 'play' | 'dying' | 'dead' | 'flag' | 'castle' | 'tally' | 'clear'

export class Session {
  score = 0
  stars = 0
  lives = 3
  level = 0
  character: Hero = 'mona'
  big = false
  inventory: ItemKind[] = []
  constructor(public high = 0) {}

  addScore(points: number) {
    this.score += points
    if (this.score > this.high) this.high = this.score
  }
  addStar() {
    this.stars += 1
    this.addScore(200)
    if (this.stars >= 100) { this.stars -= 100; this.lives += 1 }
  }
  store(kind: ItemKind) {
    if (this.inventory.length >= INVENTORY_SIZE) return false
    this.inventory.push(kind)
    return true
  }
}

export class World {
  player: Player
  enemies: Enemy[]
  items: Item[] = []
  particles: Particle[] = []
  bumps: Bump[] = []
  camX = 0
  timeLeft: number
  elapsed = 0
  state: WorldState = 'play'
  stateTime = 0
  flagY: number | null
  flagBonus = 0
  maxCam: number
  demo = false
  controlsRun = false
  controlsJump = false

  constructor(public level: Level, public session: Session) {
    const [sx, sy] = level.start
    this.player = new Player(sx * TILE + 1, 0, session.character, session.big)
    this.player.y = (sy + 1) * TILE - this.player.h
    this.enemies = level.spawns.map(([x, y, kind]) => new Enemy(x * TILE + 1, (y + 1) * TILE - 7, kind))
    this.timeLeft = level.time
    this.flagY = level.flagX === null ? null : (ROWS - 12) * TILE
    this.maxCam = Math.max(0, level.width * TILE - VIEW_W)
  }

  step(dt: number, c: Controls) {
    this.controlsRun = c.run
    this.controlsJump = c.jump
    this.update(dt, c)
  }

  update(dt: number, c: Controls) {
    dt = Math.min(dt, 0.05)
    if (dt <= 0) return
    this.elapsed += dt
    this.stateTime += dt
    this.updateParticles(dt)
    if (this.state === 'play') {
      this.timeLeft -= dt * 2.5
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.killPlayer() }
      this.updatePlayer(dt, c)
      this.updateItems(dt)
      this.updateEnemies(dt)
      if (this.state === 'play') {
        this.checkFlag()
        if (this.player.y > VIEW_H + 8) this.killPlayer(true)
      }
      this.updateCamera()
    } else if (this.state === 'dying') {
      const p = this.player
      if (this.stateTime > 0.5) {
        p.vy = Math.min(p.vy + 600 * dt, MAX_FALL * 1.5)
        p.y += p.vy * dt
      }
      if (this.stateTime > 2.6) this.state = 'dead'
    } else if (this.state === 'flag') this.updateFlag(dt)
    else if (this.state === 'castle') this.updateCastle(dt)
    else if (this.state === 'tally') this.updateTally(dt)
  }

  switchCharacter() {
    if (!this.level.canSwitch) return false
    const next = CHARACTER_ORDER[(CHARACTER_ORDER.indexOf(this.player.character) + 1) % CHARACTER_ORDER.length]
    this.player.character = this.session.character = next
    return true
  }

  useItem(slot: number) {
    const inv = this.session.inventory
    if (slot >= inv.length || this.state !== 'play') return false
    const kind = inv[slot]
    if (kind === 'chip' && this.player.big) return false
    inv.splice(slot, 1)
    this.applyItem(kind, true)
    return true
  }

  updatePlayer(dt: number, c: Controls) {
    const p = this.player
    const s = p.stats()
    if (p.invulnerable > 0) p.invulnerable -= dt
    if (p.sparkle > 0) p.sparkle -= dt

    let direction = (c.right ? 1 : 0) - (c.left ? 1 : 0)
    p.crouch = p.big && c.down && p.onGround
    if (p.crouch) direction = 0
    const topSpeed = c.run ? s.run : s.walk
    p.skidding = false
    if (direction) {
      if (p.vx * direction < 0) {
        p.vx += direction * s.skid * dt
        p.skidding = p.onGround
      } else if (Math.abs(p.vx) < topSpeed) {
        p.vx += direction * s.accel * dt
        if (Math.abs(p.vx) > topSpeed) p.vx = direction * topSpeed
      } else {
        p.vx -= direction * s.decel * dt
        if (Math.abs(p.vx) < topSpeed) p.vx = direction * topSpeed
      }
      if (p.onGround || p.carrying === null) p.facing = direction
    } else {
      const slow = s.decel * dt * (p.onGround ? 1 : 0.4)
      if (Math.abs(p.vx) <= slow) p.vx = 0
      else p.vx -= p.vx > 0 ? slow : -slow
    }

    if (c.jumpPressed) p.jumpBuffer = 0.12
    else if (p.jumpBuffer > 0) p.jumpBuffer -= dt
    if (p.onGround) { p.coyote = 0.08; p.stompChain = 0 }
    else if (p.coyote > 0) p.coyote -= dt
    if (p.jumpBuffer > 0 && p.coyote > 0) {
      p.vy = -(Math.abs(p.vx) > s.walk + 6 ? s.runJump : s.jump)
      p.jumpBuffer = p.coyote = 0
      p.onGround = false
    }

    const gravity = c.jump && p.vy < 0 ? s.gravHold : s.grav
    p.vy = Math.min(p.vy + gravity * dt, MAX_FALL)

    if (p.moveX(this.level, dt)) p.vx = 0
    if (p.x < this.camX) {
      p.x = this.camX
      if (p.vx < 0) p.vx = 0
    }
    const head = p.moveY(this.level, dt)
    if (head) {
      const [hits, ty] = head
      const centre = tileOf(p.x + p.w / 2)
      this.bump(hits.includes(centre) ? centre : hits[0], ty)
    }

    if (p.onGround && Math.abs(p.vx) > 1) p.walkPhase += Math.abs(p.vx) * dt
    this.collectStars()
    this.updateCarry(c)
  }

  collectStars() {
    const p = this.player, level = this.level
    if (!level.stars.size) return
    for (let tx = tileOf(p.x); tx <= tileOf(p.x + p.w - 0.01); tx++) {
      for (let ty = tileOf(p.y); ty <= tileOf(p.y + p.h - 0.01); ty++) {
        if (ty < 0 || ty >= ROWS || tx < 0 || tx >= level.width) continue
        if (level.stars.delete(level.index(tx, ty))) {
          this.session.addStar()
          this.spawnParticle('sparkle', tx * TILE, ty * TILE, 0, 0)
        }
      }
    }
  }

  updateCarry(c: Controls) {
    const p = this.player, shell = p.carrying
    if (!shell) return
    if (!shell.alive || shell.state !== 'carried') { p.carrying = null; return }
    shell.x = p.x + p.facing * 5
    shell.y = p.y + p.h - shell.h - (p.big ? 4 : 1)
    if (!c.run) this.throwShell()
  }

  throwShell() {
    const p = this.player, shell = p.carrying
    p.carrying = null
    if (!shell) return
    shell.state = 'kicked'
    shell.vx = p.facing * SHELL_SPEED
    shell.vy = 0
    shell.grace = 0.25
    shell.y = p.y + p.h - shell.h
    shell.x = p.x + (p.facing > 0 ? p.w : -shell.w)
    if (this.bodyInWall(shell)) {
      shell.x = p.x
      if (this.bodyInWall(shell)) this.defeatEnemy(shell, 200)
    }
  }

  bodyInWall(body: Body) {
    for (let tx = tileOf(body.x); tx <= tileOf(body.x + body.w - 0.01); tx++)
      for (let ty = tileOf(body.y); ty <= tileOf(body.y + body.h - 0.01); ty++)
        if (this.level.solid(tx, ty)) return true
    return false
  }

  hurtPlayer() {
    const p = this.player
    if (p.invulnerable > 0 || p.sparkle > 0 || this.demo || this.state !== 'play') return
    if (p.carrying) { p.carrying.state = 'shell'; p.carrying.timer = 0; p.carrying = null }
    if (p.big) {
      p.big = false
      p.y += BIG_H - SMALL_H
      p.invulnerable = 2
      this.session.big = false
    } else this.killPlayer()
  }

  killPlayer(fell = false) {
    if (this.state !== 'play') return
    const p = this.player
    p.dead = true
    p.big = false
    p.vx = 0
    p.vy = fell ? 0 : -170
    p.carrying = null
    this.session.big = false
    this.state = 'dying'
    this.stateTime = 0
  }

  grow() {
    const p = this.player
    if (p.big) return
    p.big = true
    p.y -= BIG_H - SMALL_H
    this.session.big = true
  }

  applyItem(kind: ItemKind, fromInventory = false) {
    if (kind === 'chip') {
      if (!this.player.big) { this.grow(); this.session.addScore(1000) }
      else if (fromInventory || !this.session.store('chip')) this.session.addScore(1000)
    } else if (kind === 'sparkle') {
      this.player.sparkle = 8
      this.session.addScore(1000)
    } else this.session.lives += 1
  }

  bump(tx: number, ty: number) {
    const level = this.level
    const tile = level.get(tx, ty)
    const index = level.index(tx, ty)
    const content = level.contents.get(index)
    if (content !== undefined) {
      if (content.startsWith('multi')) {
        const remaining = Number(content.slice(5) || '5') - 1
        this.popStar(tx, ty)
        if (remaining > 0) {
          level.contents.set(index, `multi${remaining}`)
          this.bumps.push({ tx, ty, tile, age: 0 })
        } else {
          level.contents.delete(index)
          level.set(tx, ty, USED)
          this.bumps.push({ tx, ty, tile: USED, age: 0 })
        }
      } else {
        level.contents.delete(index)
        level.set(tx, ty, USED)
        this.bumps.push({ tx, ty, tile: USED, age: 0 })
        if (content === 'star') this.popStar(tx, ty)
        else this.items.push(new Item(tx * TILE, ty * TILE, content as ItemKind))
      }
    } else if (BREAKABLE.has(tile)) {
      if (this.player.big) {
        level.set(tx, ty, EMPTY)
        for (const [vx, vy] of [[-40, -150], [40, -150], [-30, -90], [30, -90]]) this.spawnParticle('debris', tx * TILE + 2, ty * TILE + 2, vx, vy)
        this.session.addScore(50)
      } else this.bumps.push({ tx, ty, tile, age: 0 })
    } else return
    this.hitFromBelow(tx, ty)
  }

  popStar(tx: number, ty: number) {
    this.session.addStar()
    this.spawnParticle('star', tx * TILE, ty * TILE - TILE, 0, -160)
  }

  hitFromBelow(tx: number, ty: number) {
    const x0 = tx * TILE, top = ty * TILE
    for (const e of this.enemies) {
      if (e.alive && (e.state === 'walk' || e.state === 'shell') && Math.abs(e.y + e.h - top) < 2 && overlap(e.x, 0, e.w, 1, x0, 0, TILE, 1)) this.defeatEnemy(e, 100)
    }
    for (const item of this.items) {
      if (item.emerge <= 0 && Math.abs(item.y + item.h - top) < 2 && overlap(item.x, 0, item.w, 1, x0, 0, TILE, 1)) {
        item.vy = -110
        item.vx = Math.abs(item.vx || 40) * (item.x + 4 > x0 + 4 ? 1 : -1)
      }
    }
  }

  updateItems(dt: number) {
    const p = this.player
    for (const item of this.items) {
      if (item.emerge > 0) {
        item.emerge -= dt
        item.y = item.targetY + TILE * Math.max(0, item.emerge) / 0.5
        if (item.emerge <= 0) {
          item.y = item.targetY
          item.vx = item.kind === 'sparkle' ? 55 : 40
          if (item.kind === 'sparkle') item.vy = -120
        }
        continue
      }
      item.vy = Math.min(item.vy + 600 * dt, MAX_FALL)
      if (item.moveX(this.level, dt)) item.vx = -item.vx
      item.moveY(this.level, dt)
      if (item.onGround && item.kind === 'sparkle') item.vy = -130
      if (item.y > VIEW_H + 16 || item.x < this.camX - 32) item.alive = false
      if (overlap(p.x, p.y, p.w, p.h, item.x, item.y, item.w, item.h)) {
        item.alive = false
        this.applyItem(item.kind)
      }
    }
    this.items = this.items.filter((i) => i.alive)
  }

  updateEnemies(dt: number) {
    const p = this.player
    const activate = this.camX + VIEW_W + 16
    for (const e of this.enemies) {
      if (!e.alive) continue
      if (!e.active) {
        if (e.x < activate) e.active = true
        else continue
      }
      if (e.grace > 0) e.grace -= dt
      if (e.state === 'squashed') {
        e.timer += dt
        if (e.timer > 0.5) e.alive = false
        continue
      }
      if (e.state === 'dead') {
        e.vy = Math.min(e.vy + 600 * dt, MAX_FALL)
        e.x += e.vx * dt
        e.y += e.vy * dt
        if (e.y > VIEW_H + 16) e.alive = false
        continue
      }
      if (e.state === 'carried') { this.shellHits(e); continue }
      if (e.state === 'shell') {
        e.timer += dt
        e.vx = 0
        if (e.timer > 6) { e.state = 'walk'; e.vx = p.x < e.x ? -18 : 18 }
      }
      e.vy = Math.min(e.vy + 600 * dt, MAX_FALL)
      if (e.moveX(this.level, dt)) e.vx = -e.vx
      e.moveY(this.level, dt)
      if (e.y > VIEW_H + 16 || e.x < this.camX - 64) { e.alive = false; continue }
      if (e.state === 'kicked') this.shellHits(e)
      this.touchPlayer(e)
    }
    if (this.enemies.length > 1) this.walkersBounce()
    this.enemies = this.enemies.filter((e) => e.alive)
  }

  walkersBounce() {
    const walkers = this.enemies.filter((e) => e.alive && e.active && e.state === 'walk')
    for (let i = 0; i < walkers.length; i++) {
      const a = walkers[i]
      for (const b of walkers.slice(i + 1)) {
        if (!overlap(a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h)) continue
        const sign = a.x < b.x ? 1 : -1
        a.vx = -sign * Math.abs(a.vx)
        b.vx = sign * Math.abs(b.vx)
      }
    }
  }

  shellHits(shell: Enemy) {
    for (const other of this.enemies) {
      if (other === shell || !other.alive || !other.active || other.state === 'dead' || other.state === 'squashed') continue
      if (overlap(shell.x, shell.y, shell.w, shell.h, other.x, other.y, other.w, other.h)) {
        this.defeatEnemy(other, 200)
        if (shell.state === 'carried') {
          this.defeatEnemy(shell, 200)
          this.player.carrying = null
          return
        }
      }
    }
  }

  touchPlayer(e: Enemy) {
    const p = this.player
    if (this.state !== 'play' || e.state === 'dead' || e.state === 'squashed' || e.state === 'carried') return
    if (!overlap(p.x, p.y, p.w, p.h, e.x, e.y, e.w, e.h)) return
    if (p.sparkle > 0 || this.demo) { this.defeatEnemy(e, 200); return }
    const fallingOnto = p.vy > 0 && p.y + p.h - e.y <= 5
    if (e.state === 'shell') {
      if (!fallingOnto && !p.carrying && this.controlsRun) {
        e.state = 'carried'
        e.timer = 0
        p.carrying = e
        return
      }
      e.state = 'kicked'
      e.vx = e.x + e.w / 2 >= p.x + p.w / 2 ? SHELL_SPEED : -SHELL_SPEED
      e.grace = 0.25
      this.session.addScore(400)
      if (fallingOnto) p.vy = -STOMP_BOUNCE
      return
    }
    if (fallingOnto) {
      p.stompChain += 1
      const points = Math.min(100 * 2 ** (p.stompChain - 1), 8000)
      this.session.addScore(points)
      this.spawnParticle('score', e.x, e.y - 4, 0, -30, points)
      p.vy = -(this.controlsJump ? p.stats().jump : STOMP_BOUNCE)
      p.y = e.y - p.h
      e.state = e.kind === 'bug' ? 'squashed' : 'shell'
      e.timer = 0
      if (e.kind !== 'bug') e.vx = 0
      return
    }
    if (e.state === 'kicked' && e.grace > 0) return
    this.hurtPlayer()
  }

  defeatEnemy(e: Enemy, points: number) {
    e.state = 'dead'
    e.vy = -120
    e.vx = e.vx >= 0 ? 30 : -30
    this.session.addScore(points)
    this.spawnParticle('score', e.x, e.y - 4, 0, -30, points)
  }

  spawnParticle(kind: Particle['kind'], x: number, y: number, vx: number, vy: number, data?: number) {
    this.particles.push({ kind, x, y, vx, vy, age: 0, data })
  }

  updateParticles(dt: number) {
    const life = { star: 0.6, score: 0.8, sparkle: 0.35, debris: 1.2 }
    for (const part of this.particles) {
      part.age += dt
      if (part.kind === 'debris') part.vy += 500 * dt
      else if (part.kind === 'star') part.vy += 520 * dt
      part.x += part.vx * dt
      part.y += part.vy * dt
    }
    this.particles = this.particles.filter((part) => part.age < life[part.kind])
    for (const bump of this.bumps) bump.age += dt
    this.bumps = this.bumps.filter((bump) => bump.age < 0.16)
  }

  updateCamera() {
    const target = this.player.x - 64
    if (target > this.camX) this.camX = Math.min(target, this.maxCam)
  }

  checkFlag() {
    const fx = this.level.flagX
    if (fx === null) return
    const p = this.player
    if (p.x + p.w < fx * TILE + 3 || p.y >= (ROWS - 2) * TILE) return
    if (p.carrying) { p.carrying.state = 'shell'; p.carrying = null }
    this.state = 'flag'
    this.stateTime = 0
    p.x = fx * TILE + 3 - p.w
    p.vx = p.vy = 0
    const height = (ROWS - 3) * TILE - (p.y + p.h)
    const bonus = ([[64, 5000], [48, 2000], [32, 800], [16, 400]] as const).find(([limit]) => height >= limit)?.[1] ?? 100
    this.flagBonus = bonus
    this.session.addScore(bonus)
    this.spawnParticle('score', p.x + 8, p.y, 0, -20, bonus)
  }

  updateFlag(dt: number) {
    const p = this.player
    const base = (ROWS - 3) * TILE
    p.y = Math.min(p.y + 70 * dt, base - p.h)
    if (this.flagY !== null) this.flagY = Math.min(this.flagY + 70 * dt, base - TILE)
    if (p.y >= base - p.h && (this.flagY === null || this.flagY >= base - TILE) && this.stateTime > 0.4) {
      this.state = 'castle'
      this.stateTime = 0
      p.x += p.w + 2
      p.facing = 1
    }
  }

  updateCastle(dt: number) {
    const p = this.player
    p.vx = 40
    p.vy = Math.min(p.vy + 900 * dt, MAX_FALL)
    p.moveX(this.level, dt)
    p.moveY(this.level, dt)
    p.walkPhase += 40 * dt
    this.updateCamera()
    const door = this.level.castleDoor ?? p.x + 1
    if (p.x >= door - 3 || this.stateTime > 4) {
      this.state = 'tally'
      this.stateTime = 0
      p.vx = 0
    }
  }

  updateTally(dt: number) {
    if (this.timeLeft > 0) {
      const step = Math.min(this.timeLeft, Math.max(1, Math.trunc(dt * 120)))
      this.timeLeft -= step
      this.session.addScore(Math.trunc(step) * 50)
    } else if (this.stateTime > 1) this.state = 'clear'
  }
}

/** Cheap attract-mode driver: run right, hop walls and gaps. */
export function autopilot(world: World, c: Controls) {
  const p = world.player, lv = world.level
  c.left = c.up = c.down = false
  c.right = c.run = true
  const rows = range(tileOf(p.y), tileOf(p.y + p.h - 0.01) + 1)
  const wall = [1, 10].some((d) => rows.some((ty) => lv.solid(tileOf(p.x + p.w + d), ty)))
  const front = tileOf(p.x + p.w + 10)
  const feet = tileOf(p.y + p.h + 1)
  const gap = ![0, 1].some((k) => range(feet, ROWS).some((y) => lv.solid(front + k, y)))
  const want = (wall || gap) && p.onGround
  c.jumpPressed = want && !c.jump
  c.jump = want || (c.jump && p.vy < 0)
  return c
}

// Stages ---------------------------------------------------------------------
// Rows run 0 (top) to 14; ground tops sit on row 13.

function scenery(lv: Level, hills: number[], bushes: number[], clouds: [number, number][]) {
  hills.forEach((x) => lv.hill(x))
  bushes.forEach((x) => lv.bush(x))
  clouds.forEach(([x, y]) => lv.cloud(x, y))
}

function helloWorld() {
  const lv = new Level('1-1 HELLO WORLD', 190, 'day', 300, false)
  lv.ground(0, 68); lv.ground(71, 85); lv.ground(89, 150); lv.ground(153, 189)
  scenery(lv, [0, 40, 92, 140, 178], [9, 33, 60, 104, 130, 157],
    [[6, 3], [24, 2], [47, 4], [70, 3], [96, 2], [118, 4], [146, 3], [166, 2]])
  lv.row(12, 9, 'Q')
  lv.row(18, 9, 'B-B'); lv.block(19, 9, 'chip'); lv.starLine(18, 5, 3)
  lv.enemy(24); lv.pipe(28, 2); lv.enemy(33); lv.pipe(38, 3); lv.enemy(44); lv.enemy(46)
  lv.pipe(52, 4); lv.starLine(57, 10, 4); lv.enemy(63, 'shellbot')
  lv.starLine(68, 9, 4)
  lv.row(74, 9, 'BB-BB'); lv.block(76, 9, 'multi6', true); lv.block(78, 5, '1up', true); lv.enemy(81, 'shellbot')
  lv.starLine(86, 8, 3)
  lv.row(92, 9, 'QQQ'); lv.enemy(96); lv.enemy(98)
  lv.row(100, 9, 'BBBBBB'); lv.block(103, 5, 'sparkle'); lv.starLine(100, 4, 3)
  lv.enemy(108, 'shellbot'); lv.enemy(112); lv.enemy(114)
  lv.stairs(120, 4); lv.stairs(124, 4, false); lv.enemy(132); lv.pipe(138, 2)
  lv.row(144, 9, 'Q', 'chip'); lv.starLine(150, 8, 4); lv.enemy(157); lv.enemy(159)
  lv.stairs(161, 7); lv.flag(176)
  return lv
}

function serverRoom() {
  const lv = new Level('1-2 SERVER ROOM', 165, 'cave', 300, true)
  lv.ground(0, 39); lv.ground(43, 77); lv.ground(81, 103); lv.ground(107, 164); lv.ceiling(0, 150)
  lv.row(10, 9, 'QQQ'); lv.block(13, 9, 'chip'); lv.enemy(18); lv.enemy(20)
  for (const y of [10, 11, 12]) lv.row(26, y, 'BB')
  lv.row(32, 8, 'BBBBBB'); lv.starLine(33, 7, 4); lv.starLine(40, 9, 3)
  lv.enemy(46, 'shellbot'); lv.enemy(50); lv.enemy(52)
  lv.row(56, 9, 'BB-BB'); lv.block(58, 9, 'sparkle'); lv.row(56, 5, 'BBBBB')
  lv.pipe(66, 3); lv.enemy(70); lv.pipe(72, 2); lv.starLine(78, 9, 3)
  lv.row(84, 9, 'BBBBBBBB'); lv.row(84, 5, 'BBBBBBBB'); lv.block(88, 9, 'multi8', true); lv.starLine(85, 7, 6)
  lv.enemy(94); lv.enemy(96); lv.enemy(99, 'shellbot'); lv.starLine(104, 9, 3)
  lv.stairs(112, 4); lv.row(122, 9, 'Q', '1up'); lv.enemy(128); lv.enemy(130)
  lv.row(134, 9, 'Q', 'chip'); lv.stairs(140, 6); lv.flag(152)
  return lv
}

function skyBridge() {
  const lv = new Level('1-3 SKY BRIDGE', 175, 'dusk', 300, true)
  lv.ground(0, 20); lv.ground(33, 50); lv.ground(72, 95); lv.ground(100, 120); lv.ground(127, 174)
  scenery(lv, [2, 36, 76, 130, 165], [12, 45, 88, 110, 140],
    [[8, 3], [28, 2], [52, 4], [80, 2], [108, 3], [136, 2], [156, 4]])
  lv.row(10, 9, 'QBQ'); lv.enemy(15); lv.row(24, 10, '======'); lv.starLine(24, 9, 6)
  lv.pipe(38, 3); lv.enemy(42, 'shellbot'); lv.row(44, 9, 'BQB', 'chip'); lv.enemy(47)
  lv.row(54, 10, '===='); lv.row(60, 8, '===='); lv.row(66, 10, '===='); lv.starLine(60, 7, 4); lv.enemy(62, 'bug', 7)
  lv.enemy(78); lv.enemy(80); lv.enemy(83, 'shellbot'); lv.row(86, 9, 'Q', 'sparkle'); lv.stairs(90, 3); lv.row(97, 11, '==')
  lv.row(104, 9, 'BB-BB'); lv.block(106, 9, 'multi6', true); lv.enemy(108); lv.enemy(110)
  lv.pipe(114, 4); lv.row(122, 9, '===='); lv.starLine(122, 8, 4)
  lv.enemy(132, 'shellbot'); lv.enemy(134); lv.enemy(136); lv.block(140, 9, '1up'); lv.enemy(146)
  lv.stairs(150, 6); lv.flag(162)
  return lv
}

/** World 1 castle: low ceiling, pits bridged by girders, dense blocks. */
function firewall() {
  const lv = new Level('1-4 FIREWALL', 150, 'castle', 300, true)
  lv.ground(0, 14, 10); lv.ground(15, 30); lv.ground(34, 52); lv.ground(57, 80); lv.ground(84, 110); lv.ground(114, 149)
  lv.ceiling(0, 134, [1, 2])
  lv.start = [2, 9]
  lv.row(17, 9, 'Q', 'chip'); lv.enemy(22); lv.row(24, 6, 'HHHHHH'); lv.starLine(31, 10, 3)
  lv.enemy(38); lv.enemy(40); lv.row(42, 9, 'BQB', 'sparkle'); lv.stairs(48, 3); lv.row(53, 11, '===')
  lv.row(60, 6, 'HHHHHHHHHHHH'); lv.row(62, 9, 'BBBB'); lv.block(64, 9, 'multi8', true)
  lv.enemy(68, 'shellbot'); lv.enemy(74); lv.enemy(76); lv.starLine(81, 10, 3)
  lv.pipe(88, 2); lv.enemy(93); lv.enemy(95); lv.row(98, 9, 'Q', '1up'); lv.stairs(104, 4); lv.row(111, 11, '==')
  lv.enemy(118, 'shellbot'); lv.enemy(122); lv.stairs(126, 5); lv.flag(138)
  return lv
}

/** World 2 overworld: pipes in pairs, long block rows and stair pits. */
function pullRequest() {
  const lv = new Level('2-1 PULL REQUEST', 185, 'day', 300, true)
  lv.ground(0, 45); lv.ground(48, 98); lv.ground(102, 132); lv.ground(135, 184)
  scenery(lv, [0, 50, 104, 150], [14, 38, 66, 90, 120, 168],
    [[8, 2], [30, 4], [58, 2], [84, 3], [112, 2], [140, 4], [164, 3]])
  lv.row(8, 9, 'BQB', 'chip'); lv.row(14, 9, 'QQ'); lv.enemy(18); lv.enemy(20)
  lv.pipe(24, 2); lv.pipe(30, 3); lv.enemy(34, 'shellbot')
  lv.row(38, 5, 'BBQBB', 'sparkle'); lv.starLine(38, 4, 5); lv.starLine(45, 9, 3)
  lv.stairs(52, 3); lv.stairs(55, 3, false); lv.enemy(60); lv.enemy(62); lv.enemy(64)
  lv.row(68, 9, 'BBBBBBBB'); lv.block(71, 9, 'multi6', true); lv.row(70, 5, 'Q', '1up')
  lv.pipe(80, 4); lv.enemy(85, 'shellbot'); lv.pipe(90, 2); lv.starLine(98, 9, 4)
  lv.row(104, 9, 'QBQBQ'); lv.enemy(108); lv.enemy(110); lv.stairs(116, 4); lv.row(124, 9, 'Q', 'chip'); lv.starLine(131, 8, 4)
  lv.enemy(140, 'shellbot'); lv.enemy(144); lv.enemy(146); lv.pipe(150, 3); lv.stairs(158, 8); lv.flag(172)
  return lv
}

/** World 2 underground: brick towers, tight corridors and a pipe maze. */
function stackOverflow() {
  const lv = new Level('2-2 OVERFLOW', 160, 'cave', 300, true)
  lv.ground(0, 34); lv.ground(38, 70); lv.ground(74, 112); lv.ground(116, 159); lv.ceiling(0, 145)
  lv.row(8, 9, 'QQQQ'); lv.block(9, 9, 'chip'); lv.enemy(14)
  ;[1, 2, 3, 4].forEach((h, i) => { for (let y = 13 - h; y < 13; y++) lv.row(18 + i * 3, y, 'B') })
  lv.starLine(18, 7, 10); lv.enemy(30); lv.starLine(35, 9, 3)
  lv.row(42, 6, 'BBBBBBBBBB'); lv.row(42, 9, 'B-B-BQB', 'sparkle'); lv.enemy(46); lv.enemy(48); lv.enemy(52, 'shellbot')
  lv.pipe(58, 2); lv.pipe(62, 3); lv.pipe(66, 4); lv.starLine(71, 8, 3)
  lv.row(78, 9, 'BBBBBB'); lv.row(78, 5, 'BBBBBB'); lv.block(80, 5, '1up', true); lv.starLine(78, 7, 6)
  lv.enemy(88); lv.enemy(90); lv.enemy(92); lv.stairs(98, 4); lv.stairs(102, 4, false); lv.starLine(113, 9, 3)
  lv.row(120, 9, 'Q', 'chip'); lv.enemy(124, 'shellbot'); lv.enemy(128); lv.stairs(134, 6); lv.flag(148)
  return lv
}

/** World 2 athletic stage: girder hops high above the clouds. */
function cloudDeploy() {
  const lv = new Level('2-3 CLOUD DEPLOY', 175, 'cloud', 300, true)
  lv.ground(0, 14); lv.ground(46, 56); lv.ground(98, 108); lv.ground(135, 174)
  scenery(lv, [2, 144], [8, 50, 102, 156],
    [[10, 8], [22, 3], [36, 10], [60, 2], [76, 9], [92, 3], [116, 10], [130, 4]])
  lv.row(8, 9, 'Q', 'chip'); lv.row(17, 11, '========='); lv.row(29, 10, '========'); lv.starLine(30, 9, 6)
  lv.enemy(33, 'bug', 9); lv.row(40, 11, '======')
  lv.row(48, 9, 'BQB', 'sparkle'); lv.enemy(52); lv.row(59, 11, '========='); lv.row(71, 10, '========')
  lv.starLine(72, 9, 6); lv.enemy(75, 'bug', 9); lv.row(82, 8, 'Q', '1up'); lv.row(83, 11, '============')
  lv.enemy(102, 'shellbot'); lv.row(111, 11, '========='); lv.row(123, 10, '======='); lv.starLine(124, 9, 5)
  lv.enemy(127, 'bug', 9); lv.starLine(133, 7, 3)
  lv.row(144, 9, 'QBQ', 'chip'); lv.enemy(148); lv.enemy(150); lv.stairs(152, 6); lv.flag(164)
  return lv
}

/** World 2 castle: longer pits and more shellbots. */
function mergeConflict() {
  const lv = new Level('2-4 CONFLICT', 165, 'castle', 300, true)
  lv.ground(0, 14, 10); lv.ground(15, 28); lv.ground(32, 46); lv.ground(51, 66); lv.ground(71, 92); lv.ground(96, 120); lv.ground(125, 164)
  lv.ceiling(0, 150, [1, 2])
  lv.start = [2, 9]
  lv.row(18, 9, 'Q', 'chip'); lv.enemy(22, 'shellbot'); lv.row(24, 6, 'HHHH'); lv.starLine(29, 10, 3)
  lv.enemy(35); lv.enemy(37); lv.row(38, 9, 'BQB', 'sparkle'); lv.stairs(42, 3); lv.row(47, 11, '===')
  lv.row(54, 6, 'HHHHHHHHHH'); lv.row(56, 9, 'BBBB'); lv.block(57, 9, 'multi8', true); lv.enemy(60, 'shellbot'); lv.enemy(63); lv.row(67, 11, '===')
  lv.pipe(74, 3); lv.enemy(79); lv.enemy(81); lv.enemy(83, 'shellbot'); lv.row(86, 9, 'Q', '1up'); lv.stairs(88, 4); lv.starLine(93, 9, 3)
  lv.enemy(100); lv.enemy(102); lv.row(104, 6, 'HHHHHHHH'); lv.enemy(110, 'shellbot'); lv.stairs(114, 4); lv.row(121, 11, '===')
  lv.enemy(130); lv.enemy(132); lv.enemy(134, 'shellbot'); lv.stairs(138, 6); lv.flag(152)
  return lv
}

// Worlds 3-8 are assembled from small segments. k (0-5) raises the difficulty.
const ITEMS = ['chip', 'sparkle', 'chip', '1up', 'multi6']

type Rand = (n: number) => number
function makeRand(seed: number): Rand {
  let s = seed
  return (n) => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff
    return (s >> 16) % n
  }
}

type Segment = (lv: Level, x: number, k: number, r: Rand) => number
const SEGMENTS: Record<string, Segment> = {
  f(lv, x, k, r) {
    lv.ground(x, x + 9); lv.starLine(x + 2, 9, 3); lv.enemy(x + 4 + r(3))
    if (k > 2) lv.enemy(x + 8)
    return x + 10
  },
  p(lv, x, k, r) {
    lv.ground(x, x + 15); lv.pipe(x + 2, 2 + r(2)); lv.enemy(x + 6); lv.pipe(x + 9, 3 + r(2))
    if (k > 1) lv.enemy(x + 13, 'shellbot')
    return x + 16
  },
  b(lv, x, _k, r) {
    lv.ground(x, x + 13); lv.row(x + 2, 9, 'BQBBB'); lv.block(x + 5, 9, ITEMS[r(ITEMS.length)])
    if (r(2)) lv.block(x + 4, 5, 'multi6', true)
    else lv.starLine(x + 3, 5, 3)
    lv.enemy(x + 9); lv.enemy(x + 11)
    return x + 14
  },
  g(lv, x, k, r) {
    const w = 2 + Math.min(2, Math.floor((k + r(2)) / 2))
    lv.starLine(x, 9, w); lv.ground(x + w, x + w + 3)
    return x + w + 4
  },
  s(lv, x, k) {
    const h = 3 + Math.min(1, Math.floor(k / 2))
    lv.ground(x, x + h); lv.stairs(x + 1, h)
    const x2 = x + h + 1 + (k >= 2 ? 2 : 0)
    lv.ground(x2, x2 + h + 2); lv.stairs(x2, h, false); lv.enemy(x2 + h + 1)
    return x2 + h + 3
  },
  w(lv, x, k, r) {
    lv.ground(x, x + 13); lv.row(x + 4, 8, 'Q', r(4) === 0 ? '1up' : 'chip')
    lv.enemy(x + 3); lv.enemy(x + 5); lv.enemy(x + 8, 'shellbot')
    if (k >= 2) lv.enemy(x + 11)
    return x + 14
  },
  t(lv, x) {
    lv.ground(x, x + 15)
    for (let i = 0; i < 4; i++) for (let y = 12 - i; y < 13; y++) lv.row(x + 1 + i * 3, y, 'B')
    lv.starLine(x + 1, 7, 10); lv.enemy(x + 14)
    return x + 16
  },
  c(lv, x, _k, r) {
    lv.ground(x, x + 11); lv.row(x + 1, 9, 'BBBBBBBB'); lv.row(x + 1, 5, 'BBBBBBBB')
    lv.block(x + 3 + r(4), 9, ITEMS[r(ITEMS.length)], true)
    lv.starLine(x + 2, 7, 6); lv.enemy(x + 10)
    return x + 12
  },
  h(lv, x) {
    lv.row(x + 2, 11, '='.repeat(9)); lv.row(x + 14, 10, '='.repeat(8)); lv.starLine(x + 15, 9, 6)
    lv.enemy(x + 18, 'bug', 9); lv.row(x + 25, 11, '='.repeat(6))
    return x + 34
  },
  x(lv, x) {
    lv.row(x + 1, 11, '==='); lv.starLine(x + 1, 8, 3); lv.ground(x + 5, x + 10); lv.enemy(x + 8)
    return x + 11
  },
  r(lv, x, _k, r) {
    lv.ground(x, x + 15); lv.row(x + 2, 6, 'H'.repeat(10)); lv.row(x + 4, 9, 'BBBB')
    lv.block(x + 5, 9, r(2) ? 'multi8' : 'sparkle', true); lv.enemy(x + 8, 'shellbot'); lv.enemy(x + 12)
    return x + 16
  },
}

function build(name: string, theme: Theme, plan: string, k: number, seed: number, width: number): [Level, number] {
  const lv = new Level(name, width, theme, 300, true)
  const r = makeRand(seed)
  lv.ground(0, 9)
  lv.row(5, 9, 'Q', 'chip')
  let x = 10
  for (const code of plan) x = SEGMENTS[code](lv, x, k, r)
  lv.ground(x, x + 23); lv.stairs(x + 2, 6); lv.flag(x + 14)
  const end = x + 24
  if (theme === 'cave') lv.ceiling(0, x + 13)
  else if (theme === 'castle') lv.ceiling(0, x + 13, [1, 2])
  else {
    for (const hx of range(0, end - 3, 37)) if (lv.solid(hx, 13) && lv.solid(hx + 2, 13)) lv.hill(hx)
    for (const bx of range(9, end - 3, 23)) if (lv.solid(bx, 13) && lv.solid(bx + 2, 13) && !lv.solid(bx + 1, 12)) lv.bush(bx)
    range(6, end - 3, 21).forEach((cx, i) => lv.cloud(cx, 2 + i % 3))
  }
  return [lv, end]
}

const WORLDS: [string[], Theme[], string[]][] = [
  [['CLONE', 'FORK', 'PUSH', 'PULL'], ['day', 'cave', 'cloud', 'castle'], ['bpgwsbgp', 'cgtwcgs', 'bhwh', 'rxwrxs']],
  [['ACTION', 'TRIGGER', 'PRE-PROD', 'PROD'], ['day', 'cave', 'dusk', 'castle'], ['pgpbwgsp', 'tcgwtcs', 'fhbhw', 'xrwxrs']],
  [['BUG BASH', 'STACK TRACE', 'BREAKPOINT', 'SEGFAULT'], ['dusk', 'cave', 'cloud', 'castle'], ['wbgpswgb', 'ctgwcts', 'hwbh', 'rxwxrws']],
  [['CONTAINER', 'KERNEL PANIC', 'EDGE CACHE', 'DEADLOCK'], ['day', 'cave', 'dusk', 'castle'], ['pbgwpgsw', 'tcwgtcgs', 'bhwhf', 'xrxwrxs']],
  [['CLONE', 'STASH', 'PR', 'MERGE'], ['day', 'cave', 'cloud', 'castle'], ['bgpwgsbpg', 'cgtwcgts', 'hbhw', 'rxwrxws']],
  [['PLAN', 'BUILD', 'TEST', 'SHIP-IT'], ['dusk', 'cave', 'dusk', 'castle'], ['wpgbsgwpg', 'tcgwctgs', 'hwhbh', 'xrwxrwxs']],
]

const extra = WORLDS.flatMap(([names, themes, plans], w) => names.map((stage, s) => () => {
  const args = [`${w + 3}-${s + 1} ${stage}`, themes[s], plans[s], w, w * 4 + s + 7] as const
  return build(...args, build(...args, 200)[1])[0]
}))

export const LEVELS: (() => Level)[] = [helloWorld, serverRoom, skyBridge, firewall, pullRequest, stackOverflow, cloudDeploy, mergeConflict, ...extra]
