import { getRemoteOverview, parseRemoteVerboseOutput } from './remoteData'

describe('parseRemoteVerboseOutput', () => {
  it('groups fetch + push lines into one entry per remote', () => {
    const output = [
      'origin\tgit@github.com:gfargo/coco.git (fetch)',
      'origin\tgit@github.com:gfargo/coco.git (push)',
      'upstream\thttps://example.com/upstream.git (fetch)',
      'upstream\thttps://example.com/upstream.git (push)',
    ].join('\n')

    expect(parseRemoteVerboseOutput(output)).toEqual([
      {
        name: 'origin',
        fetchUrl: 'git@github.com:gfargo/coco.git',
        pushUrl: 'git@github.com:gfargo/coco.git',
      },
      {
        name: 'upstream',
        fetchUrl: 'https://example.com/upstream.git',
        pushUrl: 'https://example.com/upstream.git',
      },
    ])
  })

  it('keeps distinct fetch and push URLs', () => {
    const output = [
      'origin\thttps://example.com/upstream.git (fetch)',
      'origin\tgit@github.com:me/fork.git (push)',
    ].join('\n')

    expect(parseRemoteVerboseOutput(output)).toEqual([
      {
        name: 'origin',
        fetchUrl: 'https://example.com/upstream.git',
        pushUrl: 'git@github.com:me/fork.git',
      },
    ])
  })

  it('falls back to the available URL when one direction is missing', () => {
    const output = 'origin\tgit@github.com:gfargo/coco.git (fetch)'
    expect(parseRemoteVerboseOutput(output)).toEqual([
      {
        name: 'origin',
        fetchUrl: 'git@github.com:gfargo/coco.git',
        pushUrl: 'git@github.com:gfargo/coco.git',
      },
    ])
  })

  it('ignores blank and malformed lines', () => {
    const output = ['', 'garbage line', 'origin\tgit@host:repo.git (fetch)', '   '].join('\n')
    expect(parseRemoteVerboseOutput(output)).toEqual([
      { name: 'origin', fetchUrl: 'git@host:repo.git', pushUrl: 'git@host:repo.git' },
    ])
  })

  it('preserves remote order from the output', () => {
    const output = [
      'zeta\thttps://z.git (fetch)',
      'zeta\thttps://z.git (push)',
      'alpha\thttps://a.git (fetch)',
      'alpha\thttps://a.git (push)',
    ].join('\n')
    expect(parseRemoteVerboseOutput(output).map((e) => e.name)).toEqual(['zeta', 'alpha'])
  })
})

describe('getRemoteOverview', () => {
  it('reports remotes from `git remote -v`', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(
        'origin\tgit@github.com:gfargo/coco.git (fetch)\norigin\tgit@github.com:gfargo/coco.git (push)\n'
      ),
    }

    await expect(getRemoteOverview(git as never)).resolves.toEqual({
      hasRemotes: true,
      entries: [
        {
          name: 'origin',
          fetchUrl: 'git@github.com:gfargo/coco.git',
          pushUrl: 'git@github.com:gfargo/coco.git',
        },
      ],
    })
    expect(git.raw).toHaveBeenCalledWith(['remote', '-v'])
  })

  it('returns an empty overview when no remotes are configured', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    await expect(getRemoteOverview(git as never)).resolves.toEqual({
      hasRemotes: false,
      entries: [],
    })
  })

  it('falls back to an empty overview when the command fails', async () => {
    const git = { raw: jest.fn().mockRejectedValue(new Error('not a git repo')) }
    await expect(getRemoteOverview(git as never)).resolves.toEqual({
      hasRemotes: false,
      entries: [],
    })
  })
})
