import { FileDiff } from '../../../types'
import {
  detectStructuralLanguage,
  parseStructuralLine,
  summarizeTsStructuralDiff,
} from './tsStructuralDiff'

function fileDiff(file: string, diff: string): FileDiff {
  return {
    file,
    diff,
    tokenCount: diff.length,
    summary: '',
  } as FileDiff
}

describe('detectStructuralLanguage', () => {
  it('returns "ts" for TypeScript-ish extensions', () => {
    expect(detectStructuralLanguage('src/foo.ts')).toBe('ts')
    expect(detectStructuralLanguage('src/foo.tsx')).toBe('ts')
    expect(detectStructuralLanguage('src/foo.mts')).toBe('ts')
    expect(detectStructuralLanguage('src/foo.cts')).toBe('ts')
  })

  it('returns "js" for JavaScript-ish extensions', () => {
    expect(detectStructuralLanguage('src/foo.js')).toBe('js')
    expect(detectStructuralLanguage('src/foo.jsx')).toBe('js')
    expect(detectStructuralLanguage('src/foo.mjs')).toBe('js')
    expect(detectStructuralLanguage('src/foo.cjs')).toBe('js')
  })

  it('returns undefined for unrelated files', () => {
    expect(detectStructuralLanguage('README.md')).toBeUndefined()
    expect(detectStructuralLanguage('src/foo.rs')).toBeUndefined()
  })
})

describe('parseStructuralLine', () => {
  it('recognizes plain function declarations', () => {
    expect(parseStructuralLine('function foo() {}')).toEqual({
      name: 'foo', kind: 'function', exported: false,
    })
  })

  it('recognizes exported / async functions', () => {
    expect(parseStructuralLine('export async function fetchUser(id: string) {')).toEqual({
      name: 'fetchUser', kind: 'function', exported: true,
    })
  })

  it('recognizes class / abstract class declarations', () => {
    expect(parseStructuralLine('export class Widget extends Base {')).toEqual({
      name: 'Widget', kind: 'class', exported: true,
    })
    expect(parseStructuralLine('abstract class Frame {')).toEqual({
      name: 'Frame', kind: 'class', exported: false,
    })
  })

  it('recognizes interface / type / enum declarations', () => {
    expect(parseStructuralLine('export interface RequestOptions {')).toEqual({
      name: 'RequestOptions', kind: 'interface', exported: true,
    })
    expect(parseStructuralLine('type Handler = (req: Req) => Res')).toEqual({
      name: 'Handler', kind: 'type', exported: false,
    })
    expect(parseStructuralLine('export const enum Color { Red, Blue }')).toEqual({
      name: 'Color', kind: 'enum', exported: true,
    })
  })

  it('recognizes top-level const / let / var with an assignment', () => {
    expect(parseStructuralLine('export const TIMEOUT = 5000')).toEqual({
      name: 'TIMEOUT', kind: 'const', exported: true,
    })
    expect(parseStructuralLine('const config: Config = {')).toEqual({
      name: 'config', kind: 'const', exported: false,
    })
  })

  it('recognizes export default forms', () => {
    expect(parseStructuralLine('export default function Page() {')).toEqual({
      name: 'Page', kind: 'default', exported: true,
    })
    expect(parseStructuralLine('export default class App {')).toEqual({
      name: 'App', kind: 'default', exported: true,
    })
    expect(parseStructuralLine('export default {')).toEqual({
      name: 'default', kind: 'default', exported: true,
    })
  })

  it('ignores indented lines (likely inside a block)', () => {
    expect(parseStructuralLine('    function inner() {')).toBeUndefined()
    expect(parseStructuralLine('        const x = 1')).toBeUndefined()
  })

  it('returns undefined for non-declaration lines', () => {
    expect(parseStructuralLine('  if (x > 0) return')).toBeUndefined()
    expect(parseStructuralLine('console.log("hi")')).toBeUndefined()
    expect(parseStructuralLine('// a comment')).toBeUndefined()
    expect(parseStructuralLine('')).toBeUndefined()
  })
})

describe('summarizeTsStructuralDiff', () => {
  it('returns undefined for non-TS/JS files', () => {
    expect(summarizeTsStructuralDiff(fileDiff('README.md', '+ new line'))).toBeUndefined()
  })

  it('returns undefined when the diff has no body changes', () => {
    expect(summarizeTsStructuralDiff(fileDiff('src/foo.ts', ''))).toBeUndefined()
  })

  it('returns undefined when changed lines have no structural signal (paragraph-only edit)', () => {
    // Only comment / body edits → no top-level signal → fall through
    // to LLM so we don't lose fidelity on cosmetic diffs.
    const diff = [
      '@@ -1,3 +1,3 @@',
      ' export function foo() {',
      '-  return 1',
      '+  return 2',
      ' }',
    ].join('\n')
    expect(summarizeTsStructuralDiff(fileDiff('src/foo.ts', diff))).toBeUndefined()
  })

  it('names added top-level symbols and the +/- line totals', () => {
    const diff = [
      '@@ -1,1 +1,5 @@',
      ' import { Logger } from "./logger"',
      '+export function parseRequest(input: string) {',
      '+  return JSON.parse(input)',
      '+}',
      '+export const PARSE_VERSION = 2',
    ].join('\n')
    const out = summarizeTsStructuralDiff(fileDiff('src/parser.ts', diff))
    expect(out).toContain('Updated TypeScript `src/parser.ts`')
    expect(out).toContain('added: parseRequest()')
    expect(out).toContain('const PARSE_VERSION')
    expect(out).toContain('+4/-0 lines')
  })

  it('names removed top-level symbols separately', () => {
    const diff = [
      '@@ -1,3 +1,1 @@',
      '-export function legacyParse() {',
      '-  return {}',
      '-}',
      ' export const KEEP = 1',
    ].join('\n')
    const out = summarizeTsStructuralDiff(fileDiff('src/parser.ts', diff))
    expect(out).toContain('removed: legacyParse()')
    expect(out).toContain('+0/-3 lines')
  })

  it('groups symbols present in both buckets under "signature change"', () => {
    // A renamed / re-signatured export — the declaration line itself
    // changes, so the parser sees the symbol on both sides. Surface
    // it as updated rather than as a separate add + remove.
    const diff = [
      '@@ -1,1 +1,1 @@',
      '-export function parseRequest(input: string) {',
      '+export function parseRequest(input: string, schema: Schema) {',
    ].join('\n')
    const out = summarizeTsStructuralDiff(fileDiff('src/parser.ts', diff))
    expect(out).toContain('signature change: parseRequest()')
    expect(out).not.toContain('added:')
    expect(out).not.toContain('removed:')
  })

  it('renders class / interface / type / const kinds with their kind label', () => {
    const diff = [
      '@@ -0,0 +1,4 @@',
      '+export class Widget extends Base {}',
      '+export interface WidgetOptions {}',
      '+export type WidgetHandler = () => void',
      '+export const DEFAULT_WIDGETS = []',
    ].join('\n')
    const out = summarizeTsStructuralDiff(fileDiff('src/widget.ts', diff)) || ''
    expect(out).toMatch(/class Widget/)
    expect(out).toMatch(/interface WidgetOptions/)
    expect(out).toMatch(/type WidgetHandler/)
    expect(out).toMatch(/const DEFAULT_WIDGETS/)
  })

  it('handles JavaScript files with the "JavaScript" label', () => {
    const diff = [
      '@@ -0,0 +1,1 @@',
      '+export function hello() {}',
    ].join('\n')
    const out = summarizeTsStructuralDiff(fileDiff('src/foo.js', diff))
    expect(out).toContain('Updated JavaScript `src/foo.js`')
  })

  it('caps the symbol list and adds a "+N more" overflow', () => {
    const additions = Array.from({ length: 12 }, (_, i) => `+export function fn${i}() {}`).join('\n')
    const diff = ['@@ -0,0 +1,12 @@', additions].join('\n')
    const out = summarizeTsStructuralDiff(fileDiff('src/many.ts', diff)) || ''
    expect(out).toMatch(/\(\+\d+ more\)/)
  })
})
