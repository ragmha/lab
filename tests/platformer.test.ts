import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Controls, Level, LEVELS, Session, TILE, World, autopilot } from '../src/lib/platformer'

const DT = 1 / 30

test('every stage builds, starts on ground and can be finished by the demo autopilot', () => {
  const names = new Set<string>()
  for (const factory of LEVELS) {
    const level = factory()
    names.add(level.name)
    assert.ok(level.width <= 190, level.name)
    assert.ok(level.flagX !== null && level.castleDoor! / TILE < level.width, level.name)
    assert.ok(level.solid(level.start[0], level.start[1] + 1), level.name)
    const world = new World(level, new Session())
    world.demo = true
    const c = new Controls()
    for (let i = 0; i < 120 / DT && world.state !== 'clear'; i++) world.step(DT, autopilot(world, c))
    assert.equal(world.state, 'clear', level.name)
    assert.ok(world.session.score > 0, level.name)
  }
  assert.equal(names.size, 32)
})

test('holding jump goes higher, and stomping squashes a bug', () => {
  const blank = () => {
    const level = new Level('TEST', 60)
    level.ground(0, 59)
    level.start = [4, 12]
    return level
  }
  const heights = [false, true].map((hold) => {
    const world = new World(blank(), new Session())
    for (let i = 0; i < 10; i++) world.step(DT, new Controls())
    const ground = world.player.y
    const c = Object.assign(new Controls(), { jump: true, jumpPressed: true })
    world.step(DT, c)
    assert.ok(world.session.events.includes('jump'))
    Object.assign(c, { jump: hold, jumpPressed: false })
    let peak = ground
    for (let i = 0; i < 60; i++) { world.step(DT, c); peak = Math.min(peak, world.player.y) }
    return ground - peak
  })
  assert.ok(heights[1] > heights[0] + 8, `${heights}`)

  const level = blank()
  level.enemy(8)
  const world = new World(level, new Session())
  const bug = world.enemies[0]
  Object.assign(world.player, { x: bug.x, y: bug.y - 20, vy: 60 })
  for (let i = 0; i < 8; i++) world.step(DT, new Controls())
  assert.equal(bug.state, 'squashed')
  assert.ok(world.session.events.includes('stomp'))
})

test('slow frames neither fall through a one-tile girder nor sink too deep to stomp', () => {
  const level = new Level('TEST', 60)
  level.ground(0, 59)
  level.row(2, 8, '======')
  level.enemy(12)
  const world = new World(level, new Session())
  const p = world.player, bug = world.enemies[0]
  // A full-speed fall covers 10.5 px a frame at 20 fps, more than a tile, so from here one frame would carry the feet past the girder.
  Object.assign(p, { x: 4 * TILE, y: 8 * TILE - 22 - p.h, vy: 210 })
  for (let i = 0; i < 6; i++) world.step(0.05, new Controls())
  assert.equal(p.y + p.h, 8 * TILE)
  // At 30 fps it covers 7 px, so feet 8 px above a bug would land 6 px into it, past the 5 px stomp margin.
  Object.assign(p, { x: bug.x, y: bug.y - 8 - p.h, vy: 210 })
  for (let i = 0; i < 4; i++) world.step(1 / 30, new Controls())
  assert.equal(bug.state, 'squashed')
  assert.equal(world.state, 'play')
})
