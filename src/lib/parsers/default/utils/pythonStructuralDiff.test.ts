import { FileDiff } from '../../../types'
import {
  isPythonFile,
  parsePythonStructuralLine,
  summarizePythonStructuralDiff,
} from './pythonStructuralDiff'

function fileDiff(file: string, diff: string): FileDiff {
  return { file, diff, tokenCount: diff.length, summary: '' } as FileDiff
}

describe('isPythonFile', () => {
  it('matches .py and .pyi', () => {
    expect(isPythonFile('src/foo.py')).toBe(true)
    expect(isPythonFile('types/bar.pyi')).toBe(true)
  })
  it('rejects unrelated extensions', () => {
    expect(isPythonFile('src/foo.ts')).toBe(false)
    expect(isPythonFile('README.md')).toBe(false)
  })
})

describe('parsePythonStructuralLine', () => {
  it('recognizes module-level def / async def', () => {
    expect(parsePythonStructuralLine('def parse(input):')).toEqual({
      name: 'parse', kind: 'function', exported: true,
    })
    expect(parsePythonStructuralLine('async def fetch(url):')).toEqual({
      name: 'fetch', kind: 'function', exported: true,
    })
  })

  it('marks underscore-prefixed names as not exported', () => {
    expect(parsePythonStructuralLine('def _internal_helper():')).toEqual({
      name: '_internal_helper', kind: 'function', exported: false,
    })
  })

  it('recognizes class declarations', () => {
    expect(parsePythonStructuralLine('class Widget(Base):')).toEqual({
      name: 'Widget', kind: 'class', exported: true,
    })
  })

  it('recognizes PEP 695 type aliases', () => {
    expect(parsePythonStructuralLine('type Handler = Callable[[str], int]')).toEqual({
      name: 'Handler', kind: 'type', exported: true,
    })
  })

  it('recognizes ALL_CAPS module constants but not lowercase assignments', () => {
    expect(parsePythonStructuralLine('TIMEOUT = 5000')).toEqual({
      name: 'TIMEOUT', kind: 'const', exported: true,
    })
    expect(parsePythonStructuralLine('MAX_RETRIES: int = 3')).toEqual({
      name: 'MAX_RETRIES', kind: 'const', exported: true,
    })
    // Lowercase module-level assignments are too noisy to flag.
    expect(parsePythonStructuralLine('config = {}')).toBeUndefined()
  })

  it('ignores indented lines (inside a block)', () => {
    expect(parsePythonStructuralLine('    def inner():')).toBeUndefined()
    expect(parsePythonStructuralLine('\tdef inner():')).toBeUndefined()
    expect(parsePythonStructuralLine('  TIMEOUT = 5')).toBeUndefined()
  })

  it('ignores decorator lines (the next def carries the signal)', () => {
    expect(parsePythonStructuralLine('@dataclass')).toBeUndefined()
    expect(parsePythonStructuralLine('@app.route("/")')).toBeUndefined()
  })

  it('returns undefined for non-declaration lines', () => {
    expect(parsePythonStructuralLine('import os')).toBeUndefined()
    expect(parsePythonStructuralLine('# a comment')).toBeUndefined()
    expect(parsePythonStructuralLine('')).toBeUndefined()
    // `==` comparison must not be misread as a constant assignment
    expect(parsePythonStructuralLine('IF FOO == BAR:')).toBeUndefined()
  })
})

describe('summarizePythonStructuralDiff', () => {
  it('returns undefined for non-Python files', () => {
    expect(summarizePythonStructuralDiff(fileDiff('README.md', '+x'))).toBeUndefined()
  })

  it('names added top-level defs', () => {
    const diff = [
      '@@ -1,1 +1,4 @@',
      ' import json',
      '+def parse_request(input):',
      '+    return json.loads(input)',
      '+TIMEOUT = 30',
    ].join('\n')
    const out = summarizePythonStructuralDiff(fileDiff('src/parser.py', diff)) || ''
    expect(out).toContain('Updated Python `src/parser.py`')
    expect(out).toContain('parse_request()')
    expect(out).toContain('const TIMEOUT')
    expect(out).toContain('+3/-0 lines')
  })

  it('returns undefined for paragraph-only / body-only edits', () => {
    const diff = [
      '@@ -1,3 +1,3 @@',
      ' def parse(x):',
      '-    return x',
      '+    return x * 2',
    ].join('\n')
    expect(summarizePythonStructuralDiff(fileDiff('src/p.py', diff))).toBeUndefined()
  })

  it('groups signature changes', () => {
    const diff = [
      '@@ -1,1 +1,1 @@',
      '-def parse(input):',
      '+def parse(input, schema):',
    ].join('\n')
    const out = summarizePythonStructuralDiff(fileDiff('src/p.py', diff)) || ''
    expect(out).toContain('signature change: parse()')
  })
})
