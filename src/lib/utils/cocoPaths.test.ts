import * as os from 'node:os'
import * as path from 'node:path'

import { cacheKeyHash, getCocoCacheDir } from './cocoPaths'

describe('getCocoCacheDir', () => {
  let originalXdgCacheHome: string | undefined

  beforeEach(() => {
    originalXdgCacheHome = process.env.XDG_CACHE_HOME
  })

  afterEach(() => {
    if (originalXdgCacheHome === undefined) {
      delete process.env.XDG_CACHE_HOME
    } else {
      process.env.XDG_CACHE_HOME = originalXdgCacheHome
    }
  })

  it('uses XDG_CACHE_HOME when set', () => {
    process.env.XDG_CACHE_HOME = '/xdg-cache'
    expect(getCocoCacheDir()).toBe(path.join('/xdg-cache', 'coco'))
  })

  it('appends the subdir when provided', () => {
    process.env.XDG_CACHE_HOME = '/xdg-cache'
    expect(getCocoCacheDir('overview')).toBe(path.join('/xdg-cache', 'coco', 'overview'))
  })

  it('falls back to ~/.cache when XDG_CACHE_HOME is unset', () => {
    delete process.env.XDG_CACHE_HOME
    expect(getCocoCacheDir()).toBe(path.join(os.homedir(), '.cache', 'coco'))
  })

  it('falls back to ~/.cache when XDG_CACHE_HOME is whitespace-only', () => {
    process.env.XDG_CACHE_HOME = '   '
    expect(getCocoCacheDir()).toBe(path.join(os.homedir(), '.cache', 'coco'))
  })
})

describe('cacheKeyHash', () => {
  it('is deterministic', () => {
    expect(cacheKeyHash('/some/repo')).toBe(cacheKeyHash('/some/repo'))
  })

  it('returns a 16-char hex string', () => {
    expect(cacheKeyHash('/some/repo')).toMatch(/^[a-f0-9]{16}$/)
  })

  it('differs for distinct input', () => {
    expect(cacheKeyHash('/repo-a')).not.toBe(cacheKeyHash('/repo-b'))
  })
})
