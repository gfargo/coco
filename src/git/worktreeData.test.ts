import { getWorktreeListOverview, parseWorktreeList } from './worktreeData'

const porcelain = [
  'worktree /repo',
  'HEAD abc123',
  'branch refs/heads/main',
  '',
  'worktree /repo-feature',
  'HEAD def456',
  'branch refs/heads/feature/log',
  '',
  'worktree /repo-detached',
  'HEAD fedcba',
  'detached',
].join('\n')

describe('log worktree data', () => {
  it('parses porcelain worktree list output', () => {
    expect(parseWorktreeList(porcelain)).toEqual([
      {
        path: '/repo',
        head: 'abc123',
        branch: 'main',
        detached: false,
        bare: false,
      },
      {
        path: '/repo-feature',
        head: 'def456',
        branch: 'feature/log',
        detached: false,
        bare: false,
      },
      {
        path: '/repo-detached',
        head: 'fedcba',
        detached: true,
        bare: false,
      },
    ])
  })

  it('loads current and dirty status for worktrees', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('/repo\n'),
      raw: jest.fn()
        .mockResolvedValueOnce(porcelain)
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce(' M src/file.ts\n')
        .mockResolvedValueOnce(''),
    }

    await expect(getWorktreeListOverview(git as never)).resolves.toEqual({
      currentPath: '/repo',
      worktrees: [
        {
          path: '/repo',
          head: 'abc123',
          branch: 'main',
          detached: false,
          bare: false,
          current: true,
          dirty: false,
        },
        {
          path: '/repo-feature',
          head: 'def456',
          branch: 'feature/log',
          detached: false,
          bare: false,
          current: false,
          dirty: true,
        },
        {
          path: '/repo-detached',
          head: 'fedcba',
          detached: true,
          bare: false,
          current: false,
          dirty: false,
        },
      ],
    })
  })

  // #2209 — the context loader already has the current worktree's status;
  // only the other worktrees should spawn their own `git status`.
  it('answers the current worktree from a supplied status instead of spawning', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('/repo\n'),
      raw: jest.fn(async (args: string[]) => {
        if (args[0] === 'worktree') return porcelain
        return args[1] === '/repo-feature' ? ' M src/file.ts\n' : ''
      }),
    }

    const overview = await getWorktreeListOverview(git as never, { statusOutput: '?? new.txt\0' })

    const statusCalls = git.raw.mock.calls.filter(([args]) => args.includes('status')).map(([args]) => args[1])
    expect(statusCalls).toEqual(['/repo-feature', '/repo-detached'])
    expect(overview.worktrees.map((w) => [w.path, w.dirty])).toEqual([
      ['/repo', true],
      ['/repo-feature', true],
      ['/repo-detached', false],
    ])
  })

  it('treats an empty supplied status as clean', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('/repo\n'),
      raw: jest.fn(async (args: string[]) => (args[0] === 'worktree' ? porcelain : '')),
    }
    const overview = await getWorktreeListOverview(git as never, { statusOutput: '' })
    expect(overview.worktrees[0]).toMatchObject({ path: '/repo', current: true, dirty: false })
  })
})
