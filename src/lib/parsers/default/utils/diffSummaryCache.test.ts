import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  __testInternals,
  clearDiffSummaryCache,
  diffSummaryKey,
  getDiffSummaryCachePath,
  readDiffSummary,
  touchDiffSummary,
  writeDiffSummary,
} from './diffSummaryCache'

describe('diffSummaryCache (#845, PR 5)', () => {
  let tmpRoot: string
  let originalXdgCacheHome: string | undefined

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-diff-cache-'))
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

  describe('diffSummaryKey', () => {
    it('produces identical keys for the same (diff, model, promptHash)', () => {
      const a = diffSummaryKey('diff body', 'gpt-4.1-nano', 'p1')
      const b = diffSummaryKey('diff body', 'gpt-4.1-nano', 'p1')
      expect(a).toBe(b)
    })

    it('different diff text → different key', () => {
      const a = diffSummaryKey('one', 'gpt-4.1-nano', 'p1')
      const b = diffSummaryKey('two', 'gpt-4.1-nano', 'p1')
      expect(a).not.toBe(b)
    })

    it('different model → different key (so model swaps invalidate cache)', () => {
      const a = diffSummaryKey('diff', 'gpt-4.1-nano', 'p1')
      const b = diffSummaryKey('diff', 'claude-haiku-4-5', 'p1')
      expect(a).not.toBe(b)
    })

    it('different promptHash → different key (so prompt edits invalidate cache)', () => {
      const a = diffSummaryKey('diff', 'gpt-4.1-nano', 'p1')
      const b = diffSummaryKey('diff', 'gpt-4.1-nano', 'p2')
      expect(a).not.toBe(b)
    })
  })

  describe('getDiffSummaryCachePath', () => {
    it('lives under $XDG_CACHE_HOME/coco/diff-summaries', () => {
      const cachePath = getDiffSummaryCachePath('/repo/foo')
      expect(cachePath.startsWith(path.join(tmpRoot, 'coco', 'diff-summaries'))).toBe(true)
      expect(cachePath).toMatch(/summaries\.[a-f0-9]{16}\.json$/)
    })

    it('different repo paths → different cache files', () => {
      expect(getDiffSummaryCachePath('/repo/a')).not.toBe(getDiffSummaryCachePath('/repo/b'))
    })

    it('falls back to ~/.cache/coco when XDG_CACHE_HOME is unset', () => {
      delete process.env.XDG_CACHE_HOME
      expect(getDiffSummaryCachePath('/repo/x'))
        .toMatch(new RegExp(`^${os.homedir()}/.cache/coco/diff-summaries/`))
    })
  })

  describe('write + read round-trip', () => {
    it('returns undefined on a cold cache', () => {
      const key = diffSummaryKey('diff', 'gpt', 'p')
      expect(readDiffSummary('/repo/foo', key)).toBeUndefined()
    })

    it('round-trips an entry with model + tokens preserved', () => {
      const key = diffSummaryKey('diff body', 'gpt-4.1-nano', 'p')
      writeDiffSummary('/repo/foo', key, {
        summary: 'Added foo function',
        model: 'gpt-4.1-nano',
        tokens: 12,
      })
      const read = readDiffSummary('/repo/foo', key)
      expect(read?.summary).toBe('Added foo function')
      expect(read?.model).toBe('gpt-4.1-nano')
      expect(read?.tokens).toBe(12)
      expect(read?.lastAccessedAt).toBeDefined()
    })

    it('different repos do not pollute each other', () => {
      const key = diffSummaryKey('diff', 'gpt', 'p')
      writeDiffSummary('/repo/foo', key, { summary: 'foo summary', model: 'gpt', tokens: 5 })
      writeDiffSummary('/repo/bar', key, { summary: 'bar summary', model: 'gpt', tokens: 5 })
      expect(readDiffSummary('/repo/foo', key)?.summary).toBe('foo summary')
      expect(readDiffSummary('/repo/bar', key)?.summary).toBe('bar summary')
    })

    it('overwrites a prior entry on subsequent writes', () => {
      const key = diffSummaryKey('diff', 'gpt', 'p')
      writeDiffSummary('/repo/x', key, { summary: 'first', model: 'gpt', tokens: 1 })
      writeDiffSummary('/repo/x', key, { summary: 'second', model: 'gpt', tokens: 2 })
      expect(readDiffSummary('/repo/x', key)?.summary).toBe('second')
    })
  })

  describe('LRU eviction at hard cap', () => {
    it('evicts the oldest entries when count exceeds the hard cap', () => {
      const cap = __testInternals.CACHE_ENTRY_HARD_CAP
      // Write cap + 5 entries with stale lastAccessedAt timestamps so the
      // ordering is deterministic. Use the helper directly to avoid the
      // wall-clock timestamp updates.
      const entries: Record<string, ReturnType<typeof readDiffSummary> & { lastAccessedAt: string }> = {}
      for (let i = 0; i < cap + 5; i++) {
        entries[`key-${i}`] = {
          summary: `s${i}`,
          model: 'gpt',
          tokens: 1,
          lastAccessedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
        } as never
      }
      const evicted = __testInternals.enforceHardCap(entries as never)
      expect(evicted).toHaveLength(5)
      // Oldest 5 should be the first 5 we created.
      expect(evicted).toEqual([
        'key-0',
        'key-1',
        'key-2',
        'key-3',
        'key-4',
      ])
    })

    it('returns empty array when under the cap', () => {
      const entries: Record<string, ReturnType<typeof readDiffSummary> & { lastAccessedAt: string }> = {}
      for (let i = 0; i < 10; i++) {
        entries[`key-${i}`] = {
          summary: `s${i}`,
          model: 'gpt',
          tokens: 1,
          lastAccessedAt: new Date().toISOString(),
        } as never
      }
      expect(__testInternals.enforceHardCap(entries as never)).toEqual([])
    })
  })

  describe('touchDiffSummary', () => {
    it('updates lastAccessedAt on an existing entry', async () => {
      const key = diffSummaryKey('diff', 'gpt', 'p')
      writeDiffSummary('/repo/x', key, { summary: 's', model: 'gpt', tokens: 1 })
      const before = readDiffSummary('/repo/x', key)?.lastAccessedAt
      await new Promise((resolve) => setTimeout(resolve, 10))
      touchDiffSummary('/repo/x', key)
      const after = readDiffSummary('/repo/x', key)?.lastAccessedAt
      expect(after).not.toBe(before)
      expect(Date.parse(after as string)).toBeGreaterThan(Date.parse(before as string))
    })

    it('is a no-op for missing entries', () => {
      expect(() => touchDiffSummary('/repo/foo', 'unknown-key')).not.toThrow()
    })
  })

  describe('clearDiffSummaryCache', () => {
    it('removes the cache file for the repo', () => {
      const key = diffSummaryKey('diff', 'gpt', 'p')
      writeDiffSummary('/repo/foo', key, { summary: 's', model: 'gpt', tokens: 1 })
      expect(fs.existsSync(getDiffSummaryCachePath('/repo/foo'))).toBe(true)
      const result = clearDiffSummaryCache('/repo/foo')
      expect(result).toEqual({ ok: true, removed: true })
      expect(fs.existsSync(getDiffSummaryCachePath('/repo/foo'))).toBe(false)
    })

    it('returns removed=false when the cache file did not exist', () => {
      expect(clearDiffSummaryCache('/repo/never-cached')).toEqual({ ok: true, removed: false })
    })
  })

  describe('robustness', () => {
    it('returns undefined on a corrupt cache file', () => {
      const cachePath = getDiffSummaryCachePath('/repo/corrupt')
      fs.mkdirSync(path.dirname(cachePath), { recursive: true })
      fs.writeFileSync(cachePath, 'not valid json')
      const key = diffSummaryKey('diff', 'gpt', 'p')
      expect(readDiffSummary('/repo/corrupt', key)).toBeUndefined()
    })

    it('returns undefined on a schema-version mismatch', () => {
      const cachePath = getDiffSummaryCachePath('/repo/oldschema')
      fs.mkdirSync(path.dirname(cachePath), { recursive: true })
      fs.writeFileSync(cachePath, JSON.stringify({
        version: 999,
        savedAt: new Date().toISOString(),
        entries: { 'some-key': { summary: 's', model: 'gpt', tokens: 1, lastAccessedAt: '' } },
      }))
      expect(readDiffSummary('/repo/oldschema', 'some-key')).toBeUndefined()
    })
  })
})
