import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  canonicalizeFilter,
  clearGitHubListCache,
  getCachePath,
  readCachedList,
  writeCachedList,
  DEFAULT_CACHE_TTL_MS,
} from './githubListCache'

const ORIGINAL_XDG = process.env.XDG_CACHE_HOME

describe('githubListCache', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-gh-cache-test-'))
    process.env.XDG_CACHE_HOME = tmpRoot
  })

  afterEach(() => {
    if (ORIGINAL_XDG === undefined) {
      delete process.env.XDG_CACHE_HOME
    } else {
      process.env.XDG_CACHE_HOME = ORIGINAL_XDG
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  describe('canonicalizeFilter', () => {
    it('produces the same string for equivalent filters with different key order', () => {
      const a = canonicalizeFilter({ state: 'open', assignee: '@me' })
      const b = canonicalizeFilter({ assignee: '@me', state: 'open' })
      expect(a).toBe(b)
    })

    it('drops undefined / null / empty-string values', () => {
      const a = canonicalizeFilter({ state: 'open' })
      const b = canonicalizeFilter({ state: 'open', assignee: undefined, label: '' })
      expect(a).toBe(b)
    })

    it('produces different strings for different filter values', () => {
      expect(canonicalizeFilter({ state: 'open' })).not.toBe(
        canonicalizeFilter({ state: 'closed' })
      )
    })
  })

  describe('getCachePath', () => {
    it('namespaces issues and prs cache files separately', () => {
      const issuesPath = getCachePath('issues', '/repo', { state: 'open' })
      const prsPath = getCachePath('prs', '/repo', { state: 'open' })
      expect(issuesPath).not.toBe(prsPath)
      expect(path.basename(issuesPath)).toMatch(/^issues\./)
      expect(path.basename(prsPath)).toMatch(/^prs\./)
    })

    it('respects XDG_CACHE_HOME', () => {
      const p = getCachePath('issues', '/repo', {})
      expect(p.startsWith(path.join(tmpRoot, 'coco', 'github'))).toBe(true)
    })

    it('produces different paths for different filters', () => {
      const open = getCachePath('issues', '/repo', { state: 'open' })
      const closed = getCachePath('issues', '/repo', { state: 'closed' })
      expect(open).not.toBe(closed)
    })

    it('produces different paths for different repos', () => {
      const a = getCachePath('issues', '/repo-a', { state: 'open' })
      const b = getCachePath('issues', '/repo-b', { state: 'open' })
      expect(a).not.toBe(b)
    })
  })

  describe('write/read roundtrip', () => {
    it('reads back what was written', () => {
      writeCachedList('/repo', { state: 'open' }, {
        kind: 'issues',
        items: [{
          number: 1,
          title: 't',
          url: 'u',
          state: 'OPEN',
          createdAt: '',
          updatedAt: '',
        }],
      })

      const result = readCachedList('issues', '/repo', { state: 'open' })

      expect(result).toBeDefined()
      expect(result?.payload.kind).toBe('issues')
      expect(result?.payload.items).toEqual([{
        number: 1,
        title: 't',
        url: 'u',
        state: 'OPEN',
        createdAt: '',
        updatedAt: '',
      }])
    })

    it('returns undefined when the cache file is missing', () => {
      expect(readCachedList('issues', '/repo', { state: 'open' })).toBeUndefined()
    })

    it('reports fresh: true when within the TTL', () => {
      writeCachedList('/repo', {}, { kind: 'issues', items: [] })
      const result = readCachedList('issues', '/repo', {})
      expect(result?.fresh).toBe(true)
      expect(result?.ageMs).toBeGreaterThanOrEqual(0)
      expect(result?.ageMs).toBeLessThan(DEFAULT_CACHE_TTL_MS)
    })

    it('reports fresh: false when older than the TTL', () => {
      writeCachedList('/repo', {}, { kind: 'issues', items: [] })
      // Read with a 0ms TTL — anything is stale.
      const result = readCachedList('issues', '/repo', {}, 0)
      expect(result?.fresh).toBe(false)
    })

    it('returns undefined for kind mismatch (issues file read as prs)', () => {
      writeCachedList('/repo', {}, { kind: 'issues', items: [] })
      // Force the wrong kind via path collision — write issues, read prs
      // at the same key. The cache paths differ, so this naturally
      // returns undefined; but assert it explicitly.
      expect(readCachedList('prs', '/repo', {})).toBeUndefined()
    })

    it('returns undefined when the envelope is malformed', () => {
      const file = getCachePath('issues', '/repo', {})
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, '{not-json')
      expect(readCachedList('issues', '/repo', {})).toBeUndefined()
    })

    it('returns undefined when the schema version doesn\'t match', () => {
      const file = getCachePath('issues', '/repo', {})
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(
        file,
        JSON.stringify({
          version: 999,
          savedAt: new Date().toISOString(),
          payload: { kind: 'issues', items: [] },
        })
      )
      expect(readCachedList('issues', '/repo', {})).toBeUndefined()
    })
  })

  describe('clearGitHubListCache', () => {
    it('removes every cached file under the github cache dir', () => {
      writeCachedList('/repo-a', { state: 'open' }, { kind: 'issues', items: [] })
      writeCachedList('/repo-b', { state: 'closed' }, { kind: 'prs', items: [] })

      const result = clearGitHubListCache()
      expect(result.removed).toBe(2)

      expect(readCachedList('issues', '/repo-a', { state: 'open' })).toBeUndefined()
      expect(readCachedList('prs', '/repo-b', { state: 'closed' })).toBeUndefined()
    })

    it('returns removed: 0 when the cache dir doesn\'t exist', () => {
      const result = clearGitHubListCache()
      expect(result.removed).toBe(0)
    })
  })
})
