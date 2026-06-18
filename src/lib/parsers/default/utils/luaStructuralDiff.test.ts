import { FileDiff } from '../../../types'
import {
  isLuaFile,
  parseLuaStructuralLine,
  summarizeLuaStructuralDiff,
} from './luaStructuralDiff'

function fileDiff(file: string, diff: string): FileDiff {
  return { file, diff, tokenCount: diff.length, summary: '' } as FileDiff
}

describe('isLuaFile', () => {
  it('matches .lua files only', () => {
    expect(isLuaFile('init.lua')).toBe(true)
    expect(isLuaFile('src/widget.rb')).toBe(false)
    expect(isLuaFile('src/widget.ts')).toBe(false)
  })
})

describe('parseLuaStructuralLine', () => {
  it('recognizes global and local function declarations', () => {
    expect(parseLuaStructuralLine('function render(x)')).toEqual({
      name: 'render', kind: 'function', exported: true,
    })
    expect(parseLuaStructuralLine('local function helper()')).toEqual({
      name: 'helper', kind: 'function', exported: false,
    })
  })

  it('keeps qualified table-function names (dot and colon)', () => {
    expect(parseLuaStructuralLine('function M.setup(opts)')).toEqual({
      name: 'M.setup', kind: 'function', exported: true,
    })
    expect(parseLuaStructuralLine('function Widget:render()')).toEqual({
      name: 'Widget:render', kind: 'function', exported: true,
    })
  })

  it('recognizes assigned function expressions', () => {
    expect(parseLuaStructuralLine('callback = function(err)')).toEqual({
      name: 'callback', kind: 'function', exported: true,
    })
    expect(parseLuaStructuralLine('local cb = function()')).toEqual({
      name: 'cb', kind: 'function', exported: false,
    })
  })

  it('accepts modest indentation, rejects deeply nested lines', () => {
    expect(parseLuaStructuralLine('    function inner()')).toEqual({
      name: 'inner', kind: 'function', exported: true,
    })
    expect(parseLuaStructuralLine('            function deep() end')).toBeUndefined()
  })

  it('returns undefined for control-flow, calls, assignments, and blanks', () => {
    expect(parseLuaStructuralLine('if x then')).toBeUndefined()
    expect(parseLuaStructuralLine('return render()')).toBeUndefined()
    expect(parseLuaStructuralLine('local total = 1')).toBeUndefined()
    expect(parseLuaStructuralLine('t = {}')).toBeUndefined()
    expect(parseLuaStructuralLine('')).toBeUndefined()
  })
})

describe('summarizeLuaStructuralDiff', () => {
  it('returns undefined for non-Lua files', () => {
    expect(summarizeLuaStructuralDiff(fileDiff('README.md', '+x'))).toBeUndefined()
  })

  it('names added functions', () => {
    const diff = [
      '@@ -0,0 +1,3 @@',
      '+function M.setup(opts)',
      '+  return opts',
      '+end',
    ].join('\n')
    const out = summarizeLuaStructuralDiff(fileDiff('lua/plugin.lua', diff)) || ''
    expect(out).toContain('Updated Lua `lua/plugin.lua`')
    expect(out).toMatch(/M\.setup\(\)/)
  })

  it('returns undefined for body-only edits', () => {
    const diff = [
      '@@ -1,3 +1,3 @@',
      ' function compute()',
      '-  return 1',
      '+  return 2',
      ' end',
    ].join('\n')
    expect(summarizeLuaStructuralDiff(fileDiff('m.lua', diff))).toBeUndefined()
  })
})
