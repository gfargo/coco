import { FileDiff } from '../../../types'
import {
  isGoFile,
  parseGoStructuralLine,
  summarizeGoStructuralDiff,
} from './goStructuralDiff'

function fileDiff(file: string, diff: string): FileDiff {
  return { file, diff, tokenCount: diff.length, summary: '' } as FileDiff
}

describe('isGoFile', () => {
  it('matches .go files only', () => {
    expect(isGoFile('cmd/main.go')).toBe(true)
    expect(isGoFile('cmd/main.gomod')).toBe(false)
    expect(isGoFile('cmd/main.ts')).toBe(false)
  })
})

describe('parseGoStructuralLine', () => {
  it('recognizes top-level funcs and exports based on capitalization', () => {
    expect(parseGoStructuralLine('func ParseRequest(input string) error {')).toEqual({
      name: 'ParseRequest', kind: 'function', exported: true,
    })
    expect(parseGoStructuralLine('func helper() {}')).toEqual({
      name: 'helper', kind: 'function', exported: false,
    })
  })

  it('recognizes method receivers and renders Receiver.method', () => {
    const method = parseGoStructuralLine('func (w *Widget) Render(ctx Context) error {')
    expect(method?.kind).toBe('method')
    expect(method?.name).toBe('Widget.Render')
    expect(method?.exported).toBe(true)

    const valueMethod = parseGoStructuralLine('func (w Widget) String() string {')
    expect(valueMethod?.name).toBe('Widget.String')
  })

  it('recognizes type struct / interface declarations', () => {
    expect(parseGoStructuralLine('type Widget struct {')).toEqual({
      name: 'Widget', kind: 'class', exported: true,
    })
    expect(parseGoStructuralLine('type Renderer interface {')).toEqual({
      name: 'Renderer', kind: 'interface', exported: true,
    })
  })

  it('recognizes type aliases', () => {
    expect(parseGoStructuralLine('type Handler func(Context) error')).toEqual({
      name: 'Handler', kind: 'type', exported: true,
    })
  })

  it('recognizes single-line var / const declarations', () => {
    expect(parseGoStructuralLine('var DefaultTimeout = 30 * time.Second')).toEqual({
      name: 'DefaultTimeout', kind: 'const', exported: true,
    })
    expect(parseGoStructuralLine('const maxRetries = 3')).toEqual({
      name: 'maxRetries', kind: 'const', exported: false,
    })
    expect(parseGoStructuralLine('const MaxRetries int = 3')).toEqual({
      name: 'MaxRetries', kind: 'const', exported: true,
    })
  })

  it('ignores indented lines', () => {
    expect(parseGoStructuralLine('    func inner() {')).toBeUndefined()
    expect(parseGoStructuralLine('\tfunc inner() {')).toBeUndefined()
  })

  it('returns undefined for non-declaration lines', () => {
    expect(parseGoStructuralLine('package main')).toBeUndefined()
    expect(parseGoStructuralLine('import "fmt"')).toBeUndefined()
    expect(parseGoStructuralLine('// comment')).toBeUndefined()
    expect(parseGoStructuralLine('')).toBeUndefined()
  })
})

describe('summarizeGoStructuralDiff', () => {
  it('returns undefined for non-Go files', () => {
    expect(summarizeGoStructuralDiff(fileDiff('README.md', '+x'))).toBeUndefined()
  })

  it('names added top-level funcs + methods', () => {
    const diff = [
      '@@ -0,0 +1,3 @@',
      '+type Widget struct {}',
      '+func NewWidget() *Widget { return &Widget{} }',
      '+func (w *Widget) Render() error { return nil }',
    ].join('\n')
    const out = summarizeGoStructuralDiff(fileDiff('widget.go', diff)) || ''
    expect(out).toContain('Updated Go `widget.go`')
    expect(out).toMatch(/NewWidget\(\)/)
    expect(out).toMatch(/Widget\.Render\(\)/)
    expect(out).toMatch(/class Widget/)
  })

  it('returns undefined for body-only edits', () => {
    const diff = [
      '@@ -1,3 +1,3 @@',
      ' func Compute(x int) int {',
      '-    return x',
      '+    return x * 2',
      ' }',
    ].join('\n')
    expect(summarizeGoStructuralDiff(fileDiff('lib.go', diff))).toBeUndefined()
  })
})
