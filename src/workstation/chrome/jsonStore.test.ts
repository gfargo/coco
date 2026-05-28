import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { createJsonStore } from './jsonStore'

describe('createJsonStore', () => {
  let tmpHome: string
  let originalXdg: string | undefined

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-jsonstore-'))
    originalXdg = process.env.XDG_CACHE_HOME
    process.env.XDG_CACHE_HOME = tmpHome
  })

  afterEach(() => {
    if (originalXdg === undefined) {
      delete process.env.XDG_CACHE_HOME
    } else {
      process.env.XDG_CACHE_HOME = originalXdg
    }
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it('round-trips a payload via write + read', () => {
    const store = createJsonStore<{ value: number }>({
      subdir: 'test',
      basename: 'data.json',
      version: 1,
      validate: (raw) =>
        raw && typeof (raw as { value: number }).value === 'number'
          ? (raw as { value: number })
          : undefined,
    })
    expect(store.read()).toBeUndefined()
    store.write({ value: 42 })
    expect(store.read()).toEqual({ value: 42 })
  })

  it('returns undefined when schema version doesn\'t match', () => {
    const store = createJsonStore<{ ok: true }>({
      subdir: 'test',
      basename: 'data.json',
      version: 2,
      validate: () => ({ ok: true }),
    })
    // Write a v1 envelope by hand.
    fs.mkdirSync(path.dirname(store.path()), { recursive: true })
    fs.writeFileSync(store.path(), JSON.stringify({ version: 1, payload: { ok: true }, savedAt: '2026-01-01' }))
    expect(store.read()).toBeUndefined()
  })

  it('runs the validate predicate before returning', () => {
    const store = createJsonStore<{ ok: true }>({
      subdir: 'test',
      basename: 'data.json',
      version: 1,
      validate: (raw) => (raw && (raw as { ok?: unknown }).ok === true ? { ok: true } : undefined),
    })
    store.write({ ok: true })
    expect(store.read()).toEqual({ ok: true })
    // Corrupt the file with a wrong-shape payload.
    fs.writeFileSync(store.path(), JSON.stringify({ version: 1, payload: { ok: 'not-true' } }))
    expect(store.read()).toBeUndefined()
  })

  it('keys the file path via the basename function', () => {
    const store = createJsonStore<{ entries: string[] }>({
      subdir: 'test',
      basename: (key) => `data.${key}.json`,
      version: 1,
      validate: (raw) =>
        raw && Array.isArray((raw as { entries: unknown }).entries)
          ? (raw as { entries: string[] })
          : undefined,
    })
    store.write({ entries: ['a'] }, 'alpha')
    store.write({ entries: ['b'] }, 'beta')
    expect(store.read('alpha')).toEqual({ entries: ['a'] })
    expect(store.read('beta')).toEqual({ entries: ['b'] })
    expect(store.path('alpha')).toMatch(/data\.alpha\.json$/)
  })

  it('swallows write failures silently', () => {
    // Point XDG_CACHE_HOME at a non-directory so the mkdirSync fails.
    const blocker = path.join(tmpHome, 'blocker')
    fs.writeFileSync(blocker, '')
    process.env.XDG_CACHE_HOME = blocker
    const store = createJsonStore<{ ok: true }>({
      subdir: 'test',
      basename: 'data.json',
      version: 1,
      validate: () => ({ ok: true }),
    })
    expect(() => store.write({ ok: true })).not.toThrow()
  })

  it('honors XDG_CACHE_HOME', () => {
    const store = createJsonStore<{ ok: true }>({
      subdir: 'sub',
      basename: 'data.json',
      version: 1,
      validate: () => ({ ok: true }),
    })
    expect(store.path()).toBe(path.join(tmpHome, 'coco', 'sub', 'data.json'))
  })
})
