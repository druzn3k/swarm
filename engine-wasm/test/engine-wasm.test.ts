// The wasm boundary end to end. Needs pkg/ (`pnpm --filter
// @swarmsim/engine-wasm build`, which needs Rust, the wasm32 target and
// wasm-bindgen-cli); skipped with a message when it is missing.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  GameHandle,
  Num,
  convertSave,
  detectSaveFormat,
  formatLong,
  formatShort,
  initEngine,
} from '../src/index'

const wasmPath = fileURLToPath(new URL('../pkg/swarm_wasm_bg.wasm', import.meta.url))
const built = existsSync(wasmPath)
if (!built) {
  console.warn(
    '@swarmsim/engine-wasm: pkg/ not built, skipping the wasm tests ' +
      '(run `pnpm --filter @swarmsim/engine-wasm build`; needs cargo, the ' +
      'wasm32-unknown-unknown target and wasm-bindgen-cli)',
  )
}

const fixtures = JSON.parse(
  readFileSync(new URL('../../engine/test/fixtures/session-saves.json', import.meta.url), 'utf8'),
) as Record<string, string>

const T0 = 1_700_000_000_000

describe.skipIf(!built)('engine-wasm', () => {
  beforeAll(async () => {
    await initEngine(readFileSync(wasmPath))
  })

  it('plays a new game: buy, advance, view, export', () => {
    const game = GameHandle.newGame(T0)
    expect(game.loadReport()).toEqual({ format: 'new', warnings: [], offline: null })
    const statics = game.staticView()
    const units = statics.units!
    const drone = units.findIndex((u) => u.name === 'drone')
    const meat = units.findIndex((u) => u.name === 'meat')
    expect(drone).toBeGreaterThanOrEqual(0)

    const out = game.apply({ do: 'buy_unit', unit: 'drone', amount: { num: '1' }, ui: 'test' })
    expect(out.bought).toEqual({ num: '1', twinnum: '1' })
    expect(out.commands[0]).toMatchObject({ name: 'buyUnit', unit: drone, unitname: 'drone' })

    const before = game.view()
    expect(before.events).toContainEqual({ buy_first: { unit: drone } })
    game.advance(60_000)
    const after = game.view({ focus: [drone] })
    expect(after.now_ms - before.now_ms).toBe(60_000)
    expect(after.units![drone].count).toBe('1')
    expect(after.units![drone].detail).toBeDefined()
    expect(Num.gt(after.units![meat].count, before.units![meat].count)).toBe(true)

    expect(() =>
      game.apply({ do: 'buy_unit', unit: 'nexus', amount: { num: '1' } }),
    ).toThrow('Cannot buy that unit')

    const save = game.exportV2(T0 + 60_000)
    expect(save.startsWith('SW2|')).toBe(true)
    expect(detectSaveFormat(save)).toBe('v2')
    const back = GameHandle.load(save, T0 + 60_000)
    expect(back.loadReport().format).toBe('v2')
    expect(back.view().units![drone].count).toBe('1')
    back.free()
    game.free()
  })

  it('loads and converts a v1 save', () => {
    const v1 = fixtures.v1
    expect(detectSaveFormat(v1)).toBe('v1')
    const v2 = convertSave(v1, 'v2')
    expect(detectSaveFormat(v2)).toBe('v2')
    expect(detectSaveFormat(convertSave(v2, 'v1'))).toBe('v1')

    const now = 2_000_000_000_000
    const a = GameHandle.load(v1, now)
    const b = GameHandle.load(v2, now)
    const report = a.loadReport()
    expect(report.format).toBe('v1')
    expect(report.offline?.resumed_ms).toBe(now)
    // identical counts whichever format it came from
    expect(b.view().units!.map((u) => u.count)).toEqual(a.view().units!.map((u) => u.count))
    // the welcome-back report stays until dismissed
    expect(a.view().offline?.resumed_ms).toBe(now)
    a.apply({ do: 'dismiss_welcome_back' })
    expect(a.view().offline).toBeUndefined()
    expect(detectSaveFormat(a.exportLegacy(now))).toBe('v1')
    a.free()
    b.free()
  })

  it('parses and formats numbers', () => {
    const game = GameHandle.newGame(T0)
    expect(game.parseNumber('1.5k')).toBe('1500')
    expect(game.parseNumber('nope')).toBeNull()
    expect(game.parseNumber('50%')).toBeNull()
    expect(game.parseNumber('100%', 'drone')).not.toBeNull()
    expect(formatShort('1234567')).toBe('1.23M')
    expect(formatLong('1234567')).toBe('1.23456 million')
    expect(() => formatShort('x')).toThrow(/not a number/)
    expect(() => GameHandle.load('junk', T0)).toThrow('not a Swarm Simulator save')
  })
})
