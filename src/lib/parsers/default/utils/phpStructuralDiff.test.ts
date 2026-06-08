import { FileDiff } from '../../../types'
import {
  isPhpFile,
  parsePhpStructuralLine,
  summarizePhpStructuralDiff,
} from './phpStructuralDiff'

function fileDiff(file: string, diff: string): FileDiff {
  return { file, diff, tokenCount: diff.length, summary: '' } as FileDiff
}

describe('isPhpFile', () => {
  it('matches .php files only', () => {
    expect(isPhpFile('src/Widget.php')).toBe(true)
    expect(isPhpFile('src/widget.rb')).toBe(false)
    expect(isPhpFile('src/widget.ts')).toBe(false)
  })
})

describe('parsePhpStructuralLine', () => {
  it('recognizes free functions', () => {
    expect(parsePhpStructuralLine('function parse($input) {')).toEqual({
      name: 'parse', kind: 'function', exported: true,
    })
  })

  it('recognizes methods and tracks visibility', () => {
    expect(parsePhpStructuralLine('public function render() {')).toEqual({
      name: 'render', kind: 'method', exported: true,
    })
    expect(parsePhpStructuralLine('protected function tick() {')).toEqual({
      name: 'tick', kind: 'method', exported: true,
    })
    expect(parsePhpStructuralLine('private function helper() {')).toEqual({
      name: 'helper', kind: 'method', exported: false,
    })
  })

  it('recognizes class / interface / trait / enum', () => {
    expect(parsePhpStructuralLine('class Widget {')).toEqual({
      name: 'Widget', kind: 'class', exported: true,
    })
    expect(parsePhpStructuralLine('interface Renderable {')).toEqual({
      name: 'Renderable', kind: 'interface', exported: true,
    })
    expect(parsePhpStructuralLine('trait Loggable {')).toEqual({
      name: 'Loggable', kind: 'trait', exported: true,
    })
    expect(parsePhpStructuralLine('enum Color {')).toEqual({
      name: 'Color', kind: 'enum', exported: true,
    })
  })

  it('accepts modest indentation (nested methods)', () => {
    expect(parsePhpStructuralLine('    public function inner() {')).toEqual({
      name: 'inner', kind: 'method', exported: true,
    })
  })

  it('ignores deeply indented lines', () => {
    expect(parsePhpStructuralLine('            function deep() {}')).toBeUndefined()
  })

  it('returns undefined for control-flow, calls, attributes and the php tag', () => {
    expect(parsePhpStructuralLine('if ($x > 0) {')).toBeUndefined()
    expect(parsePhpStructuralLine('return parse($x);')).toBeUndefined()
    expect(parsePhpStructuralLine('$widget->render();')).toBeUndefined()
    expect(parsePhpStructuralLine('#[Attribute]')).toBeUndefined()
    expect(parsePhpStructuralLine('<?php')).toBeUndefined()
    expect(parsePhpStructuralLine('// comment')).toBeUndefined()
    expect(parsePhpStructuralLine('')).toBeUndefined()
  })
})

describe('summarizePhpStructuralDiff', () => {
  it('returns undefined for non-PHP files', () => {
    expect(summarizePhpStructuralDiff(fileDiff('README.md', '+x'))).toBeUndefined()
  })

  it('names added classes and methods', () => {
    const diff = [
      '@@ -0,0 +1,3 @@',
      '+class Widget {',
      '+  public function render() {}',
      '+}',
    ].join('\n')
    const out = summarizePhpStructuralDiff(fileDiff('src/Widget.php', diff)) || ''
    expect(out).toContain('Updated PHP `src/Widget.php`')
    expect(out).toMatch(/class Widget/)
    expect(out).toMatch(/render\(\)/)
  })

  it('returns undefined for body-only edits', () => {
    const diff = [
      '@@ -1,3 +1,3 @@',
      ' function compute() {',
      '-    return 1;',
      '+    return 2;',
      ' }',
    ].join('\n')
    expect(summarizePhpStructuralDiff(fileDiff('src/w.php', diff))).toBeUndefined()
  })
})
