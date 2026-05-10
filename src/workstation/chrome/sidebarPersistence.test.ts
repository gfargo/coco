import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  getSavedSidebarTab,
  getSidebarTabMarkerPath,
  saveSidebarTab,
} from './sidebarPersistence'

describe('log Ink sidebar persistence', () => {
  let tmpRoot: string
  let originalXdgCacheHome: string | undefined

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-sidebar-'))
    originalXdgCacheHome = process.env.XDG_CACHE_HOME
    process.env.XDG_CACHE_HOME = tmpRoot
  })

  afterEach(() => {
    if (originalXdgCacheHome === undefined) {
      delete process.env.XDG_CACHE_HOME
    } else {
      process.env.XDG_CACHE_HOME = originalXdgCacheHome
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('returns undefined when no marker file has been written yet', () => {
    expect(getSavedSidebarTab('/some/repo')).toBeUndefined()
  })

  it('round-trips a saved tab through the marker file', () => {
    saveSidebarTab('/some/repo', 'stashes')
    expect(getSavedSidebarTab('/some/repo')).toBe('stashes')
  })

  it('keeps marker files distinct per repo path', () => {
    saveSidebarTab('/repo-a', 'branches')
    saveSidebarTab('/repo-b', 'tags')

    expect(getSavedSidebarTab('/repo-a')).toBe('branches')
    expect(getSavedSidebarTab('/repo-b')).toBe('tags')
  })

  it('uses XDG_CACHE_HOME when set', () => {
    const expected = path.join(tmpRoot, 'coco')
    expect(getSidebarTabMarkerPath('/some/repo').startsWith(expected)).toBe(true)
  })

  it('falls back to ~/.cache/coco when XDG_CACHE_HOME is unset', () => {
    delete process.env.XDG_CACHE_HOME
    const expected = path.join(os.homedir(), '.cache', 'coco')
    expect(getSidebarTabMarkerPath('/some/repo').startsWith(expected)).toBe(true)
  })

  it('returns undefined for marker files containing an invalid tab', () => {
    const markerPath = getSidebarTabMarkerPath('/some/repo')
    fs.mkdirSync(path.dirname(markerPath), { recursive: true })
    fs.writeFileSync(markerPath, 'definitely-not-a-tab')

    expect(getSavedSidebarTab('/some/repo')).toBeUndefined()
  })

  it('trims whitespace before validating saved markers', () => {
    const markerPath = getSidebarTabMarkerPath('/some/repo')
    fs.mkdirSync(path.dirname(markerPath), { recursive: true })
    fs.writeFileSync(markerPath, '  worktrees\n')

    expect(getSavedSidebarTab('/some/repo')).toBe('worktrees')
  })

  it('does not throw when the marker directory cannot be created', () => {
    // Point XDG at an unwritable path so the save fails silently.
    process.env.XDG_CACHE_HOME = '/dev/null/forbidden'
    expect(() => saveSidebarTab('/some/repo', 'branches')).not.toThrow()
  })
})
