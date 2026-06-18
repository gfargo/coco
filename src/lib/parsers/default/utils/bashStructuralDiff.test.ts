import { FileDiff } from '../../../types'
import {
  isBashFile,
  parseBashStructuralLine,
  summarizeBashStructuralDiff,
} from './bashStructuralDiff'

function fileDiff(file: string, diff: string): FileDiff {
  return { file, diff, tokenCount: diff.length, summary: '' } as FileDiff
}

describe('isBashFile', () => {
  it('matches .sh and .bash files only', () => {
    expect(isBashFile('scripts/deploy.sh')).toBe(true)
    expect(isBashFile('lib/utils.bash')).toBe(true)
    expect(isBashFile('src/widget.lua')).toBe(false)
    expect(isBashFile('src/widget.ts')).toBe(false)
  })
})

describe('parseBashStructuralLine', () => {
  it('recognizes the POSIX `name()` form', () => {
    expect(parseBashStructuralLine('deploy() {')).toEqual({
      name: 'deploy', kind: 'function', exported: true,
    })
    expect(parseBashStructuralLine('build_all () {')).toEqual({
      name: 'build_all', kind: 'function', exported: true,
    })
  })

  it('recognizes the `function` keyword form', () => {
    expect(parseBashStructuralLine('function setup {')).toEqual({
      name: 'setup', kind: 'function', exported: true,
    })
    expect(parseBashStructuralLine('function teardown() {')).toEqual({
      name: 'teardown', kind: 'function', exported: true,
    })
  })

  it('accepts modest indentation, rejects deeply nested lines', () => {
    expect(parseBashStructuralLine('    helper() {')).toEqual({
      name: 'helper', kind: 'function', exported: true,
    })
    expect(parseBashStructuralLine('            deep() {')).toBeUndefined()
  })

  it('returns undefined for control-flow, assignments, subshells, and calls', () => {
    expect(parseBashStructuralLine('if [ -n "$x" ]; then')).toBeUndefined()
    expect(parseBashStructuralLine('for i in 1 2 3; do')).toBeUndefined()
    expect(parseBashStructuralLine('arr=()')).toBeUndefined()
    expect(parseBashStructuralLine('( cd /tmp && ls )')).toBeUndefined()
    expect(parseBashStructuralLine('echo hello')).toBeUndefined()
    expect(parseBashStructuralLine('')).toBeUndefined()
  })
})

describe('summarizeBashStructuralDiff', () => {
  it('returns undefined for non-shell files', () => {
    expect(summarizeBashStructuralDiff(fileDiff('README.md', '+x'))).toBeUndefined()
  })

  it('names added functions', () => {
    const diff = [
      '@@ -0,0 +1,3 @@',
      '+deploy() {',
      '+  echo deploying',
      '+}',
    ].join('\n')
    const out = summarizeBashStructuralDiff(fileDiff('scripts/ci.sh', diff)) || ''
    expect(out).toContain('Updated Shell `scripts/ci.sh`')
    expect(out).toMatch(/deploy\(\)/)
  })

  it('returns undefined for body-only edits', () => {
    const diff = [
      '@@ -1,3 +1,3 @@',
      ' build() {',
      '-  make',
      '+  make -j4',
      ' }',
    ].join('\n')
    expect(summarizeBashStructuralDiff(fileDiff('b.sh', diff))).toBeUndefined()
  })
})
