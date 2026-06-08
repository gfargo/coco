import { FileDiff } from '../../../types'
import {
  isJavaFile,
  parseJavaStructuralLine,
  summarizeJavaStructuralDiff,
} from './javaStructuralDiff'

function fileDiff(file: string, diff: string): FileDiff {
  return { file, diff, tokenCount: diff.length, summary: '' } as FileDiff
}

describe('isJavaFile', () => {
  it('matches .java files only', () => {
    expect(isJavaFile('src/Main.java')).toBe(true)
    expect(isJavaFile('src/Main.kt')).toBe(false)
    expect(isJavaFile('src/Main.ts')).toBe(false)
  })
})

describe('parseJavaStructuralLine', () => {
  it('recognizes class / interface / enum / record', () => {
    expect(parseJavaStructuralLine('public class Widget {')).toEqual({
      name: 'Widget', kind: 'class', exported: true,
    })
    expect(parseJavaStructuralLine('public interface Renderable {')).toEqual({
      name: 'Renderable', kind: 'interface', exported: true,
    })
    expect(parseJavaStructuralLine('enum Color {')).toEqual({
      name: 'Color', kind: 'enum', exported: false,
    })
    expect(parseJavaStructuralLine('public record Point(int x, int y) {')).toEqual({
      name: 'Point', kind: 'class', exported: true,
    })
  })

  it('recognizes methods and tracks public/protected visibility', () => {
    expect(parseJavaStructuralLine('public int compute(int x) {')).toEqual({
      name: 'compute', kind: 'method', exported: true,
    })
    expect(parseJavaStructuralLine('protected void render() {')).toEqual({
      name: 'render', kind: 'method', exported: true,
    })
    expect(parseJavaStructuralLine('private void helper() {')).toEqual({
      name: 'helper', kind: 'method', exported: false,
    })
  })

  it('handles generic / array return types', () => {
    expect(parseJavaStructuralLine('public List<String> names() {')).toEqual({
      name: 'names', kind: 'method', exported: true,
    })
    expect(parseJavaStructuralLine('public int[] values() {')).toEqual({
      name: 'values', kind: 'method', exported: true,
    })
  })

  it('accepts modest indentation (nested members)', () => {
    expect(parseJavaStructuralLine('    public void inner() {')).toEqual({
      name: 'inner', kind: 'method', exported: true,
    })
  })

  it('ignores deeply indented lines', () => {
    expect(parseJavaStructuralLine('            void deep() {}')).toBeUndefined()
  })

  it('returns undefined for control-flow and calls', () => {
    expect(parseJavaStructuralLine('if (x > 0) {')).toBeUndefined()
    expect(parseJavaStructuralLine('for (int i = 0; i < n; i++) {')).toBeUndefined()
    expect(parseJavaStructuralLine('return compute(x);')).toBeUndefined()
    expect(parseJavaStructuralLine('foo.bar();')).toBeUndefined()
    expect(parseJavaStructuralLine('@Override')).toBeUndefined()
    expect(parseJavaStructuralLine('// comment')).toBeUndefined()
    expect(parseJavaStructuralLine('')).toBeUndefined()
  })
})

describe('summarizeJavaStructuralDiff', () => {
  it('returns undefined for non-Java files', () => {
    expect(summarizeJavaStructuralDiff(fileDiff('README.md', '+x'))).toBeUndefined()
  })

  it('names added classes and methods', () => {
    const diff = [
      '@@ -0,0 +1,3 @@',
      '+public class Widget {',
      '+  public void render() {}',
      '+}',
    ].join('\n')
    const out = summarizeJavaStructuralDiff(fileDiff('src/Widget.java', diff)) || ''
    expect(out).toContain('Updated Java `src/Widget.java`')
    expect(out).toMatch(/class Widget/)
    expect(out).toMatch(/render\(\)/)
  })

  it('returns undefined for body-only edits', () => {
    const diff = [
      '@@ -1,3 +1,3 @@',
      ' public int compute() {',
      '-    return 1;',
      '+    return 2;',
      ' }',
    ].join('\n')
    expect(summarizeJavaStructuralDiff(fileDiff('src/W.java', diff))).toBeUndefined()
  })
})
