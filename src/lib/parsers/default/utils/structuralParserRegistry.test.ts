import type { FileDiff } from '../../../types'
import {
  _registrySnapshotForTesting,
  dispatchStructuralParser,
} from './structuralParserRegistry'

function fileDiff(file: string, diff: string): FileDiff {
  return { file, diff, summary: '', tokenCount: Math.ceil(diff.length / 4) }
}

describe('structuralParserRegistry', () => {
  describe('registry shape', () => {
    it('registers a regex parser for every supported language', () => {
      const snapshot = _registrySnapshotForTesting()
      expect(snapshot.ts).toContain('regex')
      expect(snapshot.js).toContain('regex')
      expect(snapshot.py).toContain('regex')
      expect(snapshot.rs).toContain('regex')
      expect(snapshot.go).toContain('regex')
    })

    it('keeps each chain non-empty (no language is unreachable)', () => {
      const snapshot = _registrySnapshotForTesting()
      for (const [lang, chain] of Object.entries(snapshot)) {
        expect(chain.length).toBeGreaterThan(0)
        // Sanity: identifiers are valid kinds.
        for (const id of chain) {
          expect(['regex', 'tree-sitter']).toContain(id)
        }
        // Linter satisfaction.
        expect(typeof lang).toBe('string')
      }
    })
  })

  describe('dispatchStructuralParser', () => {
    it('returns the regex parser\'s summary for a TS diff with structural signal', async () => {
      const diff = [
        '@@ -1,1 +1,1 @@',
        '-export function legacyParse() {}',
        '+export function parseRequest(input: string) {}',
      ].join('\n')
      const result = await dispatchStructuralParser('ts', fileDiff('src/p.ts', diff))
      expect(result).toBeDefined()
      expect(result).toContain('Updated TypeScript `src/p.ts`')
    })

    it('returns the regex parser\'s summary for a Python diff with structural signal', async () => {
      const diff = [
        '@@ -1,1 +1,1 @@',
        '-def parse(input):',
        '+def parse(input, schema):',
      ].join('\n')
      const result = await dispatchStructuralParser('py', fileDiff('src/p.py', diff))
      expect(result).toBeDefined()
      expect(result).toContain('Updated Python `src/p.py`')
      expect(result).toContain('signature change: parse()')
    })

    it('returns undefined for a body-only TS diff (no parser in the chain handles it)', async () => {
      const diff = [
        '@@ -1,3 +1,3 @@',
        ' export function parse() {',
        '-  return 1',
        '+  return 2',
        ' }',
      ].join('\n')
      const result = await dispatchStructuralParser('ts', fileDiff('src/p.ts', diff))
      expect(result).toBeUndefined()
    })

    it('returns undefined for a language with no registered chain', async () => {
      // Languages outside the StructuralLanguageId union won't compile,
      // so we test the runtime fallthrough via a typed cast through unknown.
      const language = 'lua' as unknown as 'ts'
      const result = await dispatchStructuralParser(language, fileDiff('a.lua', '+x'))
      expect(result).toBeUndefined()
    })
  })
})
