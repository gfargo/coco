import { deriveStatus, makeFakeGit } from './makeFakeGit'

describe('deriveStatus', () => {
  it('derives staged + files consistently for a cleanly staged file', async () => {
    const status = deriveStatus([{ path: 'a.ts', index: 'M', working_dir: ' ' }])

    expect(status.staged).toEqual(['a.ts'])
    expect(status.files).toEqual([{ path: 'a.ts', index: 'M', working_dir: ' ' }])
  })

  it('derives BOTH staged inclusion and a worktree-dirty files entry for a staged-then-edited file', async () => {
    // This is the exact shape the apply-time drift guard (split.ts) checks:
    // staged (index side) AND edited-since (working_dir side) at once.
    const status = deriveStatus([{ path: 'a.ts', index: 'M', working_dir: 'M' }])

    expect(status.staged).toContain('a.ts')
    expect(status.files).toEqual([{ path: 'a.ts', index: 'M', working_dir: 'M' }])
    const fileEntry = status.files.find((file) => file.path === 'a.ts')
    expect(fileEntry?.working_dir).not.toEqual(' ')
  })

  it('derives renamed entries with from/to', async () => {
    const status = deriveStatus([{ path: 'new.ts', index: 'R', working_dir: ' ', from: 'old.ts' }])

    expect(status.renamed).toEqual([{ from: 'old.ts', to: 'new.ts' }])
    expect(status.files).toEqual([{ path: 'new.ts', index: 'R', working_dir: ' ', from: 'old.ts' }])
  })

  it('derives untracked files', async () => {
    const status = deriveStatus([{ path: 'new.ts', index: '?', working_dir: '?' }])

    expect(status.not_added).toEqual(['new.ts'])
  })

  it('throws on an unrecognized status code instead of silently misclassifying it', async () => {
    expect(() => deriveStatus([{ path: 'a.ts', index: 'Z', working_dir: 'Z' }])).toThrow(
      /unrecognized status code/
    )
  })
})

describe('makeFakeGit', () => {
  it('derives diff --cached output from the worktree by default', async () => {
    const { git } = makeFakeGit([{ path: 'a.ts', index: 'M', working_dir: ' ' }])

    const staged = await git.raw(['diff', '--cached', '--name-only', '-z'])

    expect(staged.split('\0').filter(Boolean)).toEqual(['a.ts'])
  })

  it('logs an ordered op for every raw/add call', async () => {
    const { git, ops } = makeFakeGit([{ path: 'a.ts', index: 'M', working_dir: ' ' }])

    await git.raw(['diff', '--cached', '--name-only', '-z'])
    await git.add(['a.ts'])
    await git.raw(['reset'])

    expect(ops).toEqual(['list-staged', 'stage a.ts', 'reset'])
  })

  it('advanceHead moves revparse forward', async () => {
    const { git } = makeFakeGit([])

    expect((await git.revparse(['HEAD'])).trim()).toEqual('head-0')
    git.advanceHead()
    expect((await git.revparse(['HEAD'])).trim()).toEqual('head-1')
  })

  it('staged() convenience treats every path as a clean staged modification', async () => {
    const { git } = makeFakeGit.staged(['a.ts', 'b.ts'])

    const status = await git.status()

    expect(status.staged).toEqual(['a.ts', 'b.ts'])
    expect(status.files).toHaveLength(2)
  })
})
