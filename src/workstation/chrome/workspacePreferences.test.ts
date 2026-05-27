import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  getWorkspacePreferencesPath,
  readWorkspacePreferences,
  workspacePreferencesKey,
  writeWorkspacePreferences,
} from './workspacePreferences'

describe('workspacePreferences', () => {
  let tmpHome: string
  let originalXdg: string | undefined

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-ws-prefs-'))
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

  it('round-trips sort mode, tab, and filter through the store', () => {
    expect(readWorkspacePreferences(['~/code'])).toEqual({})
    writeWorkspacePreferences(['~/code'], {
      sortMode: 'dirty',
      tab: 'behind',
      filter: 'api',
    })
    expect(readWorkspacePreferences(['~/code'])).toEqual({
      sortMode: 'dirty',
      tab: 'behind',
      filter: 'api',
    })
    expect(fs.existsSync(getWorkspacePreferencesPath(['~/code']))).toBe(true)
  })

  it('keys per root set so different configurations stay independent', () => {
    expect(workspacePreferencesKey(['~/code'])).not.toBe(
      workspacePreferencesKey(['~/work'])
    )
    expect(workspacePreferencesKey(['~/code', '~/work'])).toBe(
      workspacePreferencesKey(['~/work', '~/code'])
    )
  })

  it('drops unknown sort modes / tabs as if absent', () => {
    fs.mkdirSync(path.dirname(getWorkspacePreferencesPath(['~/code'])), { recursive: true })
    fs.writeFileSync(
      getWorkspacePreferencesPath(['~/code']),
      JSON.stringify({
        version: 1,
        savedAt: '2026-05-27',
        preferences: { sortMode: 'rainbow', tab: 'frogs', filter: 'ok' },
      })
    )
    expect(readWorkspacePreferences(['~/code'])).toEqual({ filter: 'ok' })
  })

  it('treats a schema mismatch as no preferences', () => {
    fs.mkdirSync(path.dirname(getWorkspacePreferencesPath(['~/code'])), { recursive: true })
    fs.writeFileSync(
      getWorkspacePreferencesPath(['~/code']),
      JSON.stringify({ version: 99, preferences: { sortMode: 'name' } })
    )
    expect(readWorkspacePreferences(['~/code'])).toEqual({})
  })

  it('swallows write failures silently', () => {
    const blocker = path.join(tmpHome, 'blocker')
    fs.writeFileSync(blocker, '')
    process.env.XDG_CACHE_HOME = blocker
    expect(() => writeWorkspacePreferences(['~/code'], { tab: 'all' })).not.toThrow()
  })
})
