import {
  findSubmoduleByPath,
  parseGitmodules,
  parseSubmoduleStatusOutput,
} from './submoduleData'

describe('parseGitmodules', () => {
  it('returns one block per [submodule "name"] section with its path / url / branch', () => {
    const body = [
      '[submodule "vendor/lib"]',
      '  path = vendor/lib',
      '  url = git@github.com:org/lib.git',
      '  branch = main',
      '',
      '[submodule "tools"]',
      '  path = tools',
      '  url = git@github.com:org/tools.git',
    ].join('\n')
    expect(parseGitmodules(body)).toEqual([
      { name: 'vendor/lib', path: 'vendor/lib', url: 'git@github.com:org/lib.git', branch: 'main' },
      { name: 'tools', path: 'tools', url: 'git@github.com:org/tools.git' },
    ])
  })

  it('tolerates comments / blank lines / mixed indentation', () => {
    const body = [
      '# leading comment',
      '[submodule "a"]',
      '\tpath = a',
      ';   url = ignored',
      '   url    =   ssh://example.com/a',
      '',
      '[submodule "b"]',
      'path=b',
    ].join('\n')
    expect(parseGitmodules(body)).toEqual([
      { name: 'a', path: 'a', url: 'ssh://example.com/a' },
      { name: 'b', path: 'b' },
    ])
  })

  it('returns an empty list when no submodule sections are present', () => {
    expect(parseGitmodules('')).toEqual([])
    expect(parseGitmodules('# just comments\n[other]\nfoo = bar')).toEqual([])
  })
})

describe('parseSubmoduleStatusOutput', () => {
  it('parses the leading status char into a structured flag', () => {
    const output = [
      ' 1111111111111111111111111111111111111111 sub-clean (heads/main)',
      '+2222222222222222222222222222222222222222 sub-modified (heads/main)',
      '-3333333333333333333333333333333333333333 sub-uninit',
      'U4444444444444444444444444444444444444444 sub-conflict',
    ].join('\n')

    expect(parseSubmoduleStatusOutput(output)).toEqual([
      { flag: 'clean', pinnedSha: '1111111111111111111111111111111111111111', path: 'sub-clean' },
      { flag: 'modified', pinnedSha: '2222222222222222222222222222222222222222', path: 'sub-modified' },
      { flag: 'uninitialized', pinnedSha: '3333333333333333333333333333333333333333', path: 'sub-uninit' },
      { flag: 'conflicted', pinnedSha: '4444444444444444444444444444444444444444', path: 'sub-conflict' },
    ])
  })

  it('skips blank lines and lines that are too short to parse', () => {
    // Three lines: empty (skipped), single-token (skipped — no path),
    // and a well-formed two-token row (parsed).
    const output = ['', ' shortrow', ' abcdef path'].join('\n')
    expect(parseSubmoduleStatusOutput(output)).toEqual([
      { flag: 'clean', pinnedSha: 'abcdef', path: 'path' },
    ])
  })

  it('returns an empty list for empty input', () => {
    expect(parseSubmoduleStatusOutput('')).toEqual([])
  })
})

describe('findSubmoduleByPath', () => {
  it('returns the matching submodule entry', () => {
    const overview = {
      hasSubmodules: true,
      entries: [
        { name: 'a', path: 'a', pinnedSha: '1', flag: 'clean' as const },
        { name: 'b', path: 'b', pinnedSha: '2', flag: 'modified' as const },
      ],
    }
    expect(findSubmoduleByPath(overview, 'a')?.name).toBe('a')
    expect(findSubmoduleByPath(overview, 'b')?.flag).toBe('modified')
  })

  it('returns undefined when no entry matches', () => {
    const overview = {
      hasSubmodules: true,
      entries: [{ name: 'a', path: 'a', pinnedSha: '1', flag: 'clean' as const }],
    }
    expect(findSubmoduleByPath(overview, 'unknown')).toBeUndefined()
  })

  it('returns undefined on an empty overview', () => {
    expect(findSubmoduleByPath({ hasSubmodules: false, entries: [] }, 'anything')).toBeUndefined()
  })
})
