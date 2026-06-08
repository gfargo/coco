import { FileDiff } from '../../../types'
import {
  isCsFile,
  parseCsStructuralLine,
  summarizeCsStructuralDiff,
} from './csStructuralDiff'

function fileDiff(file: string, diff: string): FileDiff {
  return { file, diff, tokenCount: diff.length, summary: '' } as FileDiff
}

describe('isCsFile', () => {
  it('matches .cs files only', () => {
    expect(isCsFile('src/Widget.cs')).toBe(true)
    expect(isCsFile('src/widget.cpp')).toBe(false)
    expect(isCsFile('src/widget.ts')).toBe(false)
  })
})

describe('parseCsStructuralLine', () => {
  it('recognizes class / interface / struct / record / enum', () => {
    expect(parseCsStructuralLine('public class Widget {')).toEqual({
      name: 'Widget', kind: 'class', exported: true,
    })
    expect(parseCsStructuralLine('internal interface IRenderable {')).toEqual({
      name: 'IRenderable', kind: 'interface', exported: true,
    })
    expect(parseCsStructuralLine('public struct Point {')).toEqual({
      name: 'Point', kind: 'class', exported: true,
    })
    expect(parseCsStructuralLine('public record Money(decimal Amount);')).toEqual({
      name: 'Money', kind: 'class', exported: true,
    })
    expect(parseCsStructuralLine('enum Color {')).toEqual({
      name: 'Color', kind: 'enum', exported: false,
    })
  })

  it('recognizes methods and tracks public/protected/internal visibility', () => {
    expect(parseCsStructuralLine('public int Compute(int x) {')).toEqual({
      name: 'Compute', kind: 'method', exported: true,
    })
    expect(parseCsStructuralLine('protected void Render() {')).toEqual({
      name: 'Render', kind: 'method', exported: true,
    })
    expect(parseCsStructuralLine('internal void Tick() {')).toEqual({
      name: 'Tick', kind: 'method', exported: true,
    })
    expect(parseCsStructuralLine('private void Helper() {')).toEqual({
      name: 'Helper', kind: 'method', exported: false,
    })
  })

  it('accepts modest indentation (nested members)', () => {
    expect(parseCsStructuralLine('    public void Inner() {')).toEqual({
      name: 'Inner', kind: 'method', exported: true,
    })
  })

  it('ignores deeply indented lines', () => {
    expect(parseCsStructuralLine('            void Deep() {}')).toBeUndefined()
  })

  it('returns undefined for control-flow, calls, and attributes', () => {
    expect(parseCsStructuralLine('if (x > 0) {')).toBeUndefined()
    expect(parseCsStructuralLine('foreach (var x in xs) {')).toBeUndefined()
    expect(parseCsStructuralLine('return Compute(x);')).toBeUndefined()
    expect(parseCsStructuralLine('Foo();')).toBeUndefined()
    expect(parseCsStructuralLine('[Serializable]')).toBeUndefined()
    expect(parseCsStructuralLine('// comment')).toBeUndefined()
    expect(parseCsStructuralLine('')).toBeUndefined()
  })
})

describe('summarizeCsStructuralDiff', () => {
  it('returns undefined for non-C# files', () => {
    expect(summarizeCsStructuralDiff(fileDiff('README.md', '+x'))).toBeUndefined()
  })

  it('names added classes and methods', () => {
    const diff = [
      '@@ -0,0 +1,3 @@',
      '+public class Widget {',
      '+  public void Render() {}',
      '+}',
    ].join('\n')
    const out = summarizeCsStructuralDiff(fileDiff('src/Widget.cs', diff)) || ''
    expect(out).toContain('Updated C# `src/Widget.cs`')
    expect(out).toMatch(/class Widget/)
    expect(out).toMatch(/Render\(\)/)
  })

  it('returns undefined for body-only edits', () => {
    const diff = [
      '@@ -1,3 +1,3 @@',
      ' public int Compute() {',
      '-    return 1;',
      '+    return 2;',
      ' }',
    ].join('\n')
    expect(summarizeCsStructuralDiff(fileDiff('src/W.cs', diff))).toBeUndefined()
  })
})
