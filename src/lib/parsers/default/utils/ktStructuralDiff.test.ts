import { FileDiff } from '../../../types'
import {
  isKotlinFile,
  parseKotlinStructuralLine,
  summarizeKotlinStructuralDiff,
} from './ktStructuralDiff'

function fileDiff(file: string, diff: string): FileDiff {
  return { file, diff, tokenCount: diff.length, summary: '' } as FileDiff
}

describe('isKotlinFile', () => {
  it('matches .kt and .kts files only', () => {
    expect(isKotlinFile('src/Widget.kt')).toBe(true)
    expect(isKotlinFile('build.gradle.kts')).toBe(true)
    expect(isKotlinFile('src/widget.java')).toBe(false)
    expect(isKotlinFile('src/widget.swift')).toBe(false)
  })
})

describe('parseKotlinStructuralLine', () => {
  it('recognizes functions, generics, and extension functions', () => {
    expect(parseKotlinStructuralLine('fun render() {')).toEqual({
      name: 'render', kind: 'function', exported: true,
    })
    expect(parseKotlinStructuralLine('fun <T> map(x: T): T {')).toEqual({
      name: 'map', kind: 'function', exported: true,
    })
    expect(parseKotlinStructuralLine('fun String.shout(): String {')).toEqual({
      name: 'shout', kind: 'function', exported: true,
    })
  })

  it('recognizes class / data class / sealed class', () => {
    expect(parseKotlinStructuralLine('class Widget {')).toEqual({
      name: 'Widget', kind: 'class', exported: true,
    })
    expect(parseKotlinStructuralLine('data class Point(val x: Int)')).toEqual({
      name: 'Point', kind: 'class', exported: true,
    })
    expect(parseKotlinStructuralLine('sealed class Result')).toEqual({
      name: 'Result', kind: 'class', exported: true,
    })
  })

  it('recognizes interface, fun interface, enum class, and object', () => {
    expect(parseKotlinStructuralLine('interface Drawable {')).toEqual({
      name: 'Drawable', kind: 'interface', exported: true,
    })
    expect(parseKotlinStructuralLine('fun interface Handler {')).toEqual({
      name: 'Handler', kind: 'interface', exported: true,
    })
    expect(parseKotlinStructuralLine('enum class Color {')).toEqual({
      name: 'Color', kind: 'enum', exported: true,
    })
    expect(parseKotlinStructuralLine('object Registry {')).toEqual({
      name: 'Registry', kind: 'class', exported: true,
    })
  })

  it('tracks private/internal visibility (exported: false)', () => {
    expect(parseKotlinStructuralLine('private fun helper() {}')).toEqual({
      name: 'helper', kind: 'function', exported: false,
    })
    expect(parseKotlinStructuralLine('internal class Impl {')).toEqual({
      name: 'Impl', kind: 'class', exported: false,
    })
  })

  it('accepts modest indentation, rejects deeply nested lines', () => {
    expect(parseKotlinStructuralLine('    fun inner() {')).toEqual({
      name: 'inner', kind: 'function', exported: true,
    })
    expect(parseKotlinStructuralLine('            fun deep() {}')).toBeUndefined()
  })

  it('returns undefined for control-flow, calls, properties, and blanks', () => {
    expect(parseKotlinStructuralLine('if (x > 0) {')).toBeUndefined()
    expect(parseKotlinStructuralLine('return render()')).toBeUndefined()
    expect(parseKotlinStructuralLine('val total = 1')).toBeUndefined()
    expect(parseKotlinStructuralLine('')).toBeUndefined()
  })
})

describe('summarizeKotlinStructuralDiff', () => {
  it('returns undefined for non-Kotlin files', () => {
    expect(summarizeKotlinStructuralDiff(fileDiff('README.md', '+x'))).toBeUndefined()
  })

  it('names added classes and functions', () => {
    const diff = [
      '@@ -0,0 +1,3 @@',
      '+class Widget {',
      '+  fun render() {}',
      '+}',
    ].join('\n')
    const out = summarizeKotlinStructuralDiff(fileDiff('src/Widget.kt', diff)) || ''
    expect(out).toContain('Updated Kotlin `src/Widget.kt`')
    expect(out).toMatch(/class Widget/)
    expect(out).toMatch(/render\(\)/)
  })

  it('returns undefined for body-only edits', () => {
    const diff = [
      '@@ -1,3 +1,3 @@',
      ' fun compute(): Int {',
      '-    return 1',
      '+    return 2',
      ' }',
    ].join('\n')
    expect(summarizeKotlinStructuralDiff(fileDiff('src/w.kt', diff))).toBeUndefined()
  })
})
