import { FileDiff } from '../../../types'
import {
  isSwiftFile,
  parseSwiftStructuralLine,
  summarizeSwiftStructuralDiff,
} from './swiftStructuralDiff'

function fileDiff(file: string, diff: string): FileDiff {
  return { file, diff, tokenCount: diff.length, summary: '' } as FileDiff
}

describe('isSwiftFile', () => {
  it('matches .swift files only', () => {
    expect(isSwiftFile('Sources/Widget.swift')).toBe(true)
    expect(isSwiftFile('src/widget.kt')).toBe(false)
    expect(isSwiftFile('src/widget.ts')).toBe(false)
  })
})

describe('parseSwiftStructuralLine', () => {
  it('recognizes functions, generics, and static/class methods', () => {
    expect(parseSwiftStructuralLine('func render() {')).toEqual({
      name: 'render', kind: 'function', exported: true,
    })
    expect(parseSwiftStructuralLine('func map<T>(_ x: T) -> T {')).toEqual({
      name: 'map', kind: 'function', exported: true,
    })
    expect(parseSwiftStructuralLine('static func make() {')).toEqual({
      name: 'make', kind: 'function', exported: true,
    })
    // `class func` is a type method — the `class` modifier must not be read
    // as a `class` declaration named "func".
    expect(parseSwiftStructuralLine('class func factory() {')).toEqual({
      name: 'factory', kind: 'function', exported: true,
    })
  })

  it('maps the type-like declarations to the nearest kind', () => {
    expect(parseSwiftStructuralLine('class Widget {')).toEqual({
      name: 'Widget', kind: 'class', exported: true,
    })
    expect(parseSwiftStructuralLine('struct Point {')).toEqual({
      name: 'Point', kind: 'type', exported: true,
    })
    expect(parseSwiftStructuralLine('enum Color {')).toEqual({
      name: 'Color', kind: 'enum', exported: true,
    })
    expect(parseSwiftStructuralLine('protocol Drawable {')).toEqual({
      name: 'Drawable', kind: 'interface', exported: true,
    })
    expect(parseSwiftStructuralLine('extension String {')).toEqual({
      name: 'String', kind: 'impl', exported: true,
    })
    expect(parseSwiftStructuralLine('actor Worker {')).toEqual({
      name: 'Worker', kind: 'class', exported: true,
    })
  })

  it('strips attributes + modifiers and tracks private visibility', () => {
    expect(parseSwiftStructuralLine('public final class Foo {')).toEqual({
      name: 'Foo', kind: 'class', exported: true,
    })
    expect(parseSwiftStructuralLine('@objc private func secret() {')).toEqual({
      name: 'secret', kind: 'function', exported: false,
    })
    expect(parseSwiftStructuralLine('fileprivate struct Hidden {')).toEqual({
      name: 'Hidden', kind: 'type', exported: false,
    })
  })

  it('accepts modest indentation, rejects deeply nested lines', () => {
    expect(parseSwiftStructuralLine('    func inner() {')).toEqual({
      name: 'inner', kind: 'function', exported: true,
    })
    expect(parseSwiftStructuralLine('            func deep() {}')).toBeUndefined()
  })

  it('returns undefined for control-flow, calls, properties, and blanks', () => {
    expect(parseSwiftStructuralLine('if x > 0 {')).toBeUndefined()
    expect(parseSwiftStructuralLine('return render()')).toBeUndefined()
    expect(parseSwiftStructuralLine('let total = 1')).toBeUndefined()
    expect(parseSwiftStructuralLine('@objc')).toBeUndefined()
    expect(parseSwiftStructuralLine('')).toBeUndefined()
  })
})

describe('summarizeSwiftStructuralDiff', () => {
  it('returns undefined for non-Swift files', () => {
    expect(summarizeSwiftStructuralDiff(fileDiff('README.md', '+x'))).toBeUndefined()
  })

  it('names added structs and functions', () => {
    const diff = [
      '@@ -0,0 +1,3 @@',
      '+struct Point {',
      '+  func distance() -> Double {}',
      '+}',
    ].join('\n')
    const out = summarizeSwiftStructuralDiff(fileDiff('Sources/Point.swift', diff)) || ''
    expect(out).toContain('Updated Swift `Sources/Point.swift`')
    expect(out).toMatch(/type Point/)
    expect(out).toMatch(/distance\(\)/)
  })

  it('returns undefined for body-only edits', () => {
    const diff = [
      '@@ -1,3 +1,3 @@',
      ' func compute() -> Int {',
      '-    return 1',
      '+    return 2',
      ' }',
    ].join('\n')
    expect(summarizeSwiftStructuralDiff(fileDiff('w.swift', diff))).toBeUndefined()
  })
})
