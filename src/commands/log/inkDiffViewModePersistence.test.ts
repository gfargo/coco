import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  getDiffViewModeMarkerPath,
  getSavedDiffViewMode,
  saveDiffViewMode,
} from './inkDiffViewModePersistence'

describe('log Ink diff view mode persistence', () => {
  let tmpRoot: string
  let originalXdgCacheHome: string | undefined

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-diff-mode-'))
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
    expect(getSavedDiffViewMode('/some/repo')).toBeUndefined()
  })

  it('round-trips a saved mode through the marker file', () => {
    saveDiffViewMode('/some/repo', 'split')
    expect(getSavedDiffViewMode('/some/repo')).toBe('split')

    saveDiffViewMode('/some/repo', 'unified')
    expect(getSavedDiffViewMode('/some/repo')).toBe('unified')
  })

  it('keeps marker files distinct per repo path', () => {
    saveDiffViewMode('/repo-a', 'split')
    saveDiffViewMode('/repo-b', 'unified')

    expect(getSavedDiffViewMode('/repo-a')).toBe('split')
    expect(getSavedDiffViewMode('/repo-b')).toBe('unified')
  })

  it('uses XDG_CACHE_HOME when set', () => {
    const expected = path.join(tmpRoot, 'coco')
    expect(getDiffViewModeMarkerPath('/some/repo').startsWith(expected)).toBe(true)
  })

  it('falls back to ~/.cache/coco when XDG_CACHE_HOME is unset', () => {
    delete process.env.XDG_CACHE_HOME
    const expected = path.join(os.homedir(), '.cache', 'coco')
    expect(getDiffViewModeMarkerPath('/some/repo').startsWith(expected)).toBe(true)
  })

  it('returns undefined for marker files containing an invalid mode', () => {
    const markerPath = getDiffViewModeMarkerPath('/some/repo')
    fs.mkdirSync(path.dirname(markerPath), { recursive: true })
    fs.writeFileSync(markerPath, 'not-a-mode')

    expect(getSavedDiffViewMode('/some/repo')).toBeUndefined()
  })

  it('trims whitespace before validating saved markers', () => {
    const markerPath = getDiffViewModeMarkerPath('/some/repo')
    fs.mkdirSync(path.dirname(markerPath), { recursive: true })
    fs.writeFileSync(markerPath, '  split\n')

    expect(getSavedDiffViewMode('/some/repo')).toBe('split')
  })

  it('does not throw when the marker directory cannot be created', () => {
    process.env.XDG_CACHE_HOME = '/dev/null/forbidden'
    expect(() => saveDiffViewMode('/some/repo', 'split')).not.toThrow()
  })
})
