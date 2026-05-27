import * as os from 'node:os'
import * as path from 'node:path'

import {
  applyTabCompletion,
  completePath,
  expandHomePrefix,
  splitInput,
} from './pathCompletion'

describe('pathCompletion helpers', () => {
  it('expands ~ into the home directory', () => {
    expect(expandHomePrefix('~')).toBe(os.homedir())
    expect(expandHomePrefix('~/code')).toBe(path.join(os.homedir(), 'code'))
    expect(expandHomePrefix('/tmp')).toBe('/tmp')
  })

  it('splits on the last slash; bare names treat home as the parent', () => {
    expect(splitInput('/tmp/foo/bar')).toEqual({ dir: '/tmp/foo/', prefix: 'bar' })
    expect(splitInput('/tmp/')).toEqual({ dir: '/tmp/', prefix: '' })
    expect(splitInput('foo')).toEqual({ dir: os.homedir(), prefix: 'foo' })
  })
})

describe('completePath', () => {
  it('lists directory entries that start with the prefix', () => {
    const result = completePath('/tmp/co', {
      readDirectory: () => ['coco', 'docs', 'coffee', 'README'],
      isDirectory: (entry) => !entry.endsWith('README'),
    })
    expect(result.baseDir).toBe('/tmp/')
    expect(result.prefix).toBe('co')
    // README filtered out (not a directory), docs filtered out (different prefix)
    expect(result.completions).toEqual(['coco/', 'coffee/'])
    expect(result.commonPrefix).toBe('cof'.startsWith('co') ? 'co' : 'co')
  })

  it('marks git working trees with a trailing star', () => {
    const result = completePath('/tmp/', {
      readDirectory: () => ['repo-a', 'repo-b', 'not-a-repo'],
      isDirectory: () => true,
      isGitWorkingTree: (entry) => entry.endsWith('repo-a') || entry.endsWith('repo-b'),
    })
    expect(result.completions).toEqual(['not-a-repo/', 'repo-a/*', 'repo-b/*'])
  })

  it('hides dotfiles unless the prefix opts in', () => {
    const readDirectory = () => ['.hidden', 'visible']
    const isDirectory = () => true
    const noDot = completePath('/tmp/', { readDirectory, isDirectory })
    expect(noDot.completions).toEqual(['visible/'])

    const withDot = completePath('/tmp/.', { readDirectory, isDirectory })
    expect(withDot.completions).toEqual(['.hidden/'])
  })

  it('returns no completions on a readdir failure', () => {
    const result = completePath('/missing/path/x', {
      readDirectory: () => {
        throw new Error('ENOENT')
      },
      isDirectory: () => false,
    })
    expect(result.completions).toEqual([])
  })
})

describe('applyTabCompletion', () => {
  function fakeResult(overrides: {
    baseDir?: string
    prefix?: string
    completions?: string[]
    commonPrefix?: string
  } = {}): ReturnType<typeof completePath> {
    return {
      baseDir: overrides.baseDir ?? '/tmp/',
      prefix: overrides.prefix ?? '',
      completions: overrides.completions ?? [],
      commonPrefix: overrides.commonPrefix ?? '',
      isDirectory: false,
    }
  }

  it('extends the prefix to the longest common match', () => {
    expect(
      applyTabCompletion('/tmp/re', fakeResult({
        baseDir: '/tmp/',
        prefix: 're',
        completions: ['repo-a/', 'repo-b/'],
        commonPrefix: 'repo-',
      }))
    ).toBe('/tmp/repo-')
  })

  it('commits the only completion when the prefix already equals the common match', () => {
    expect(
      applyTabCompletion('/tmp/repo-a', fakeResult({
        baseDir: '/tmp/',
        prefix: 'repo-a',
        completions: ['repo-a/*'],
        commonPrefix: 'repo-a',
      }))
    ).toBe('/tmp/repo-a/')
  })

  it('is a no-op when there are no completions', () => {
    expect(applyTabCompletion('/missing/x', fakeResult())).toBe('/missing/x')
  })
})
