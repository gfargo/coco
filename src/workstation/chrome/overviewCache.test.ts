import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { GitLogRow } from '../../commands/log/data'
import {
  getOverviewCachePath,
  readCachedCommits,
  writeCachedCommits,
} from './overviewCache'

describe('inkOverviewCache (#808)', () => {
  let tmpRoot: string
  let originalXdgCacheHome: string | undefined

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-overview-cache-'))
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

  const sampleRows: GitLogRow[] = [
    {
      type: 'commit',
      graph: '*',
      shortHash: 'abc1234',
      hash: 'abc123456789',
      parents: ['def567890123'],
      date: '2026-05-03',
      author: 'Coco Test',
      refs: ['HEAD -> main'],
      message: 'feat: cache the commit log',
    },
    {
      type: 'commit',
      graph: '*',
      shortHash: 'def5678',
      hash: 'def567890123',
      parents: [],
      date: '2026-05-02',
      author: 'Coco Test',
      refs: [],
      message: 'docs: warm the boot path',
    },
  ]

  describe('getOverviewCachePath', () => {
    it('returns a coco/overview/commits.<key>.json path under XDG_CACHE_HOME', () => {
      const cachePath = getOverviewCachePath('/repo/path')
      expect(cachePath.startsWith(path.join(tmpRoot, 'coco', 'overview'))).toBe(true)
      expect(cachePath).toMatch(/commits\.[a-f0-9]{16}\.json$/)
    })

    it('two different repo paths produce two different cache files', () => {
      const a = getOverviewCachePath('/repo/a')
      const b = getOverviewCachePath('/repo/b')
      expect(a).not.toBe(b)
    })

    it('the same repo path is stable across calls', () => {
      expect(getOverviewCachePath('/repo/x')).toBe(getOverviewCachePath('/repo/x'))
    })
  })

  describe('writeCachedCommits / readCachedCommits round-trip', () => {
    it('returns undefined when nothing has been cached yet', () => {
      expect(readCachedCommits('/never/cached')).toBeUndefined()
    })

    it('writes rows under the correct key and reads them back intact', () => {
      writeCachedCommits('/repo/foo', sampleRows)
      const read = readCachedCommits('/repo/foo')
      expect(read).toEqual(sampleRows)
    })

    it('different repos do not pollute each other\'s cache', () => {
      writeCachedCommits('/repo/foo', sampleRows)
      writeCachedCommits('/repo/bar', sampleRows.slice(0, 1))
      expect(readCachedCommits('/repo/foo')).toHaveLength(2)
      expect(readCachedCommits('/repo/bar')).toHaveLength(1)
    })

    it('overwrites prior cached data on subsequent writes', () => {
      writeCachedCommits('/repo/x', sampleRows)
      const first = sampleRows[0]
      if (first.type !== 'commit') throw new Error('test fixture invariant violated')
      const newer: GitLogRow[] = [{ ...first, message: 'fix: overwrite' }]
      writeCachedCommits('/repo/x', newer)
      expect(readCachedCommits('/repo/x')).toEqual(newer)
    })

    it('caps the stored row count at 500 to bound disk size', () => {
      const first = sampleRows[0]
      if (first.type !== 'commit') throw new Error('test fixture invariant violated')
      const huge: GitLogRow[] = Array.from({ length: 750 }, (_, index) => ({
        ...first,
        hash: `hash-${index}`,
        message: `commit ${index}`,
      }))
      writeCachedCommits('/repo/big', huge)
      expect(readCachedCommits('/repo/big')).toHaveLength(500)
    })
  })

  describe('robustness', () => {
    it('returns undefined on a corrupt cache file (best-effort, never throws)', () => {
      const cachePath = getOverviewCachePath('/repo/corrupt')
      fs.mkdirSync(path.dirname(cachePath), { recursive: true })
      fs.writeFileSync(cachePath, 'not valid json {{{')
      expect(readCachedCommits('/repo/corrupt')).toBeUndefined()
    })

    it('returns undefined on a schema-version mismatch', () => {
      const cachePath = getOverviewCachePath('/repo/oldformat')
      fs.mkdirSync(path.dirname(cachePath), { recursive: true })
      fs.writeFileSync(cachePath, JSON.stringify({
        version: 999,
        savedAt: new Date().toISOString(),
        rows: sampleRows,
      }))
      expect(readCachedCommits('/repo/oldformat')).toBeUndefined()
    })

    it('returns undefined when rows is not an array', () => {
      const cachePath = getOverviewCachePath('/repo/badshape')
      fs.mkdirSync(path.dirname(cachePath), { recursive: true })
      fs.writeFileSync(cachePath, JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        rows: 'not an array',
      }))
      expect(readCachedCommits('/repo/badshape')).toBeUndefined()
    })

    it('falls back to ~/.cache/coco when XDG_CACHE_HOME is unset', () => {
      delete process.env.XDG_CACHE_HOME
      const cachePath = getOverviewCachePath('/repo/x')
      expect(cachePath.startsWith(path.join(os.homedir(), '.cache', 'coco', 'overview'))).toBe(true)
    })
  })
})
