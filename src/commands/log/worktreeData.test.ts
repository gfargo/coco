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
})
