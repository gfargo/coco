import { FileDiff } from '../../../types'
import {
  isRustFile,
  parseRustStructuralLine,
  summarizeRustStructuralDiff,
} from './rustStructuralDiff'

function fileDiff(file: string, diff: string): FileDiff {
  return { file, diff, tokenCount: diff.length, summary: '' } as FileDiff
}

describe('isRustFile', () => {
  it('matches .rs files only', () => {
    expect(isRustFile('src/main.rs')).toBe(true)
    expect(isRustFile('src/main.ts')).toBe(false)
  })
})

describe('parseRustStructuralLine', () => {
  it('recognizes pub fn / pub async fn / pub const fn', () => {
    expect(parseRustStructuralLine('pub fn parse(input: &str) -> Result<(), Error> {')).toEqual({
      name: 'parse', kind: 'function', exported: true,
    })
    expect(parseRustStructuralLine('pub async fn fetch(url: &str) -> Bytes {')).toEqual({
      name: 'fetch', kind: 'function', exported: true,
    })
    expect(parseRustStructuralLine('pub const fn compute() -> usize {')).toEqual({
      name: 'compute', kind: 'function', exported: true,
    })
  })

  it('marks non-pub fns as not exported', () => {
    expect(parseRustStructuralLine('fn helper() {}')).toEqual({
      name: 'helper', kind: 'function', exported: false,
    })
  })

  it('handles visibility modifiers (pub(crate), pub(super))', () => {
    expect(parseRustStructuralLine('pub(crate) fn helper() {}')?.exported).toBe(true)
    expect(parseRustStructuralLine('pub(super) struct Inner;')?.exported).toBe(true)
  })

  it('recognizes struct / enum / trait declarations', () => {
    expect(parseRustStructuralLine('pub struct Widget {')).toEqual({
      name: 'Widget', kind: 'class', exported: true,
    })
    expect(parseRustStructuralLine('pub enum Color {')).toEqual({
      name: 'Color', kind: 'enum', exported: true,
    })
    expect(parseRustStructuralLine('pub trait Renderable {')).toEqual({
      name: 'Renderable', kind: 'trait', exported: true,
    })
  })

  it('recognizes impl blocks (both Trait-for-Type and plain Type)', () => {
    const plain = parseRustStructuralLine('impl Widget {')
    expect(plain?.kind).toBe('impl')
    expect(plain?.name).toBe('Widget')

    const traitImpl = parseRustStructuralLine('impl Renderable for Widget {')
    expect(traitImpl?.kind).toBe('impl')
    expect(traitImpl?.name).toBe('Renderable for Widget')
  })

  it('recognizes type aliases', () => {
    expect(parseRustStructuralLine('pub type Handler = fn(Request) -> Response')).toEqual({
      name: 'Handler', kind: 'type', exported: true,
    })
  })

  it('recognizes ALL_CAPS const / static', () => {
    expect(parseRustStructuralLine('pub const TIMEOUT: u32 = 30')).toEqual({
      name: 'TIMEOUT', kind: 'const', exported: true,
    })
    expect(parseRustStructuralLine('static MAX_BUFFER: usize = 4096')).toEqual({
      name: 'MAX_BUFFER', kind: 'const', exported: false,
    })
  })

  it('recognizes mod declarations', () => {
    expect(parseRustStructuralLine('pub mod parser;')).toEqual({
      name: 'parser', kind: 'module', exported: true,
    })
    expect(parseRustStructuralLine('mod internal {')).toEqual({
      name: 'internal', kind: 'module', exported: false,
    })
  })

  it('ignores deeply indented lines', () => {
    expect(parseRustStructuralLine('        fn deep() {}')).toBeUndefined()
  })

  it('returns undefined for non-declaration lines', () => {
    expect(parseRustStructuralLine('use std::io;')).toBeUndefined()
    expect(parseRustStructuralLine('// a comment')).toBeUndefined()
    expect(parseRustStructuralLine('let x = 1;')).toBeUndefined()
    expect(parseRustStructuralLine('')).toBeUndefined()
  })
})

describe('summarizeRustStructuralDiff', () => {
  it('returns undefined for non-Rust files', () => {
    expect(summarizeRustStructuralDiff(fileDiff('README.md', '+x'))).toBeUndefined()
  })

  it('names added top-level fns and the impl block they appear in', () => {
    const diff = [
      '@@ -0,0 +1,4 @@',
      '+pub fn parse_request(input: &str) {}',
      '+pub struct Widget;',
      '+impl Renderable for Widget {}',
    ].join('\n')
    const out = summarizeRustStructuralDiff(fileDiff('src/lib.rs', diff)) || ''
    expect(out).toContain('Updated Rust `src/lib.rs`')
    expect(out).toMatch(/parse_request\(\)/)
    expect(out).toMatch(/class Widget/)
    expect(out).toMatch(/impl Renderable for Widget/)
  })

  it('returns undefined for body-only edits', () => {
    const diff = [
      '@@ -1,3 +1,3 @@',
      ' pub fn parse() -> u32 {',
      '-    1',
      '+    2',
      ' }',
    ].join('\n')
    expect(summarizeRustStructuralDiff(fileDiff('src/lib.rs', diff))).toBeUndefined()
  })
})
