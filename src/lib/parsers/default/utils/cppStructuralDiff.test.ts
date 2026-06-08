import { FileDiff } from '../../../types'
import {
  isCppFile,
  parseCppStructuralLine,
  summarizeCppStructuralDiff,
} from './cppStructuralDiff'

function fileDiff(file: string, diff: string): FileDiff {
  return { file, diff, tokenCount: diff.length, summary: '' } as FileDiff
}

describe('isCppFile', () => {
  it('matches C/C++ extensions', () => {
    for (const ext of ['.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx']) {
      expect(isCppFile(`src/file${ext}`)).toBe(true)
    }
    expect(isCppFile('src/file.ts')).toBe(false)
    expect(isCppFile('src/file.cs')).toBe(false)
  })
})

describe('parseCppStructuralLine', () => {
  it('recognizes free functions (exported by default)', () => {
    expect(parseCppStructuralLine('int compute(int x) {')).toEqual({
      name: 'compute', kind: 'function', exported: true,
    })
    expect(parseCppStructuralLine('void render() {')).toEqual({
      name: 'render', kind: 'function', exported: true,
    })
  })

  it('marks static functions as not exported', () => {
    expect(parseCppStructuralLine('static int helper() {')).toEqual({
      name: 'helper', kind: 'function', exported: false,
    })
  })

  it('recognizes out-of-line member methods (Type::method)', () => {
    expect(parseCppStructuralLine('void Widget::render() {')).toEqual({
      name: 'Widget::render', kind: 'method', exported: true,
    })
  })

  it('recognizes class / struct / enum / namespace', () => {
    expect(parseCppStructuralLine('class Widget {')).toEqual({
      name: 'Widget', kind: 'class', exported: true,
    })
    expect(parseCppStructuralLine('struct Point {')).toEqual({
      name: 'Point', kind: 'class', exported: true,
    })
    expect(parseCppStructuralLine('enum class Color {')).toEqual({
      name: 'Color', kind: 'enum', exported: true,
    })
    expect(parseCppStructuralLine('namespace detail {')).toEqual({
      name: 'detail', kind: 'type', exported: true,
    })
  })

  it('recognizes #define as const', () => {
    expect(parseCppStructuralLine('#define MAX_SIZE 4096')).toEqual({
      name: 'MAX_SIZE', kind: 'const', exported: true,
    })
    expect(parseCppStructuralLine('#  define BUFFER 256')).toEqual({
      name: 'BUFFER', kind: 'const', exported: true,
    })
  })

  it('ignores deeply indented lines', () => {
    expect(parseCppStructuralLine('            int deep() {}')).toBeUndefined()
  })

  it('returns undefined for control-flow, calls, and other preprocessor', () => {
    expect(parseCppStructuralLine('if (x > 0) {')).toBeUndefined()
    expect(parseCppStructuralLine('for (int i = 0; i < n; i++) {')).toBeUndefined()
    expect(parseCppStructuralLine('return compute(x);')).toBeUndefined()
    expect(parseCppStructuralLine('foo();')).toBeUndefined()
    expect(parseCppStructuralLine('#include <vector>')).toBeUndefined()
    expect(parseCppStructuralLine('// comment')).toBeUndefined()
    expect(parseCppStructuralLine('')).toBeUndefined()
  })
})

describe('summarizeCppStructuralDiff', () => {
  it('returns undefined for non-C/C++ files', () => {
    expect(summarizeCppStructuralDiff(fileDiff('README.md', '+x'))).toBeUndefined()
  })

  it('names added functions and classes', () => {
    const diff = [
      '@@ -0,0 +1,3 @@',
      '+class Widget {',
      '+int compute(int x) {',
      '+}',
    ].join('\n')
    const out = summarizeCppStructuralDiff(fileDiff('src/widget.cpp', diff)) || ''
    expect(out).toContain('Updated C/C++ `src/widget.cpp`')
    expect(out).toMatch(/class Widget/)
    expect(out).toMatch(/compute\(\)/)
  })

  it('returns undefined for body-only edits', () => {
    const diff = [
      '@@ -1,3 +1,3 @@',
      ' int compute() {',
      '-    return 1;',
      '+    return 2;',
      ' }',
    ].join('\n')
    expect(summarizeCppStructuralDiff(fileDiff('src/w.cpp', diff))).toBeUndefined()
  })
})
