import { FileDiff } from '../../../types'
import {
  isRubyFile,
  parseRubyStructuralLine,
  summarizeRubyStructuralDiff,
} from './rbStructuralDiff'

function fileDiff(file: string, diff: string): FileDiff {
  return { file, diff, tokenCount: diff.length, summary: '' } as FileDiff
}

describe('isRubyFile', () => {
  it('matches .rb files only', () => {
    expect(isRubyFile('app/widget.rb')).toBe(true)
    expect(isRubyFile('app/widget.py')).toBe(false)
    expect(isRubyFile('app/widget.ts')).toBe(false)
  })
})

describe('parseRubyStructuralLine', () => {
  it('recognizes def (instance and self methods)', () => {
    expect(parseRubyStructuralLine('def parse(input)')).toEqual({
      name: 'parse', kind: 'method', exported: true,
    })
    expect(parseRubyStructuralLine('def self.build')).toEqual({
      name: 'build', kind: 'method', exported: true,
    })
    expect(parseRubyStructuralLine('def valid?')).toEqual({
      name: 'valid?', kind: 'method', exported: true,
    })
  })

  it('recognizes class and module', () => {
    expect(parseRubyStructuralLine('class Widget')).toEqual({
      name: 'Widget', kind: 'class', exported: true,
    })
    expect(parseRubyStructuralLine('module Renderable')).toEqual({
      name: 'Renderable', kind: 'type', exported: true,
    })
  })

  it('accepts modest indentation (nested methods)', () => {
    expect(parseRubyStructuralLine('    def inner')).toEqual({
      name: 'inner', kind: 'method', exported: true,
    })
  })

  it('ignores deeply indented lines', () => {
    expect(parseRubyStructuralLine('            def deep')).toBeUndefined()
  })

  it('returns undefined for control-flow, calls, and singleton-class openers', () => {
    expect(parseRubyStructuralLine('if x > 0')).toBeUndefined()
    expect(parseRubyStructuralLine('parse(input)')).toBeUndefined()
    expect(parseRubyStructuralLine('class << self')).toBeUndefined()
    expect(parseRubyStructuralLine('# comment')).toBeUndefined()
    expect(parseRubyStructuralLine('')).toBeUndefined()
  })
})

describe('summarizeRubyStructuralDiff', () => {
  it('returns undefined for non-Ruby files', () => {
    expect(summarizeRubyStructuralDiff(fileDiff('README.md', '+x'))).toBeUndefined()
  })

  it('names added classes and methods', () => {
    const diff = [
      '@@ -0,0 +1,3 @@',
      '+class Widget',
      '+  def render',
      '+  end',
    ].join('\n')
    const out = summarizeRubyStructuralDiff(fileDiff('app/widget.rb', diff)) || ''
    expect(out).toContain('Updated Ruby `app/widget.rb`')
    expect(out).toMatch(/class Widget/)
    expect(out).toMatch(/render\(\)/)
  })

  it('returns undefined for body-only edits', () => {
    const diff = [
      '@@ -1,3 +1,3 @@',
      ' def compute',
      '-    1',
      '+    2',
      ' end',
    ].join('\n')
    expect(summarizeRubyStructuralDiff(fileDiff('app/w.rb', diff))).toBeUndefined()
  })
})
