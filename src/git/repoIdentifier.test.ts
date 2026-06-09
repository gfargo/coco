import { SimpleGit } from 'simple-git'
import { parseRepoIdentifierFromRemote, resolveRepoIdentifier } from './repoIdentifier'

describe('parseRepoIdentifierFromRemote (#0.69)', () => {
  it.each([
    ['git@github.com:gfargo/coco.git', 'gfargo/coco'],
    ['git@github.com:gfargo/coco', 'gfargo/coco'],
    ['https://github.com/gfargo/coco.git', 'gfargo/coco'],
    ['https://github.com/gfargo/coco', 'gfargo/coco'],
    ['ssh://git@github.com/gfargo/coco.git', 'gfargo/coco'],
    ['git://github.com/gfargo/coco.git', 'gfargo/coco'],
    ['git@bitbucket.org:team/repo.git', 'team/repo'],
    ['https://gitlab.com/group/subgroup/repo.git', 'group/subgroup/repo'],
    ['https://host:8080/owner/repo.git', 'owner/repo'],
  ])('parses %s -> %s', (url, expected) => {
    expect(parseRepoIdentifierFromRemote(url)).toBe(expected)
  })

  it('caps absurdly deep paths at the last three segments', () => {
    expect(parseRepoIdentifierFromRemote('https://gitlab.com/a/b/c/d/repo.git')).toBe('c/d/repo')
  })

  it('returns undefined for an unparseable remote', () => {
    expect(parseRepoIdentifierFromRemote('not-a-url')).toBeUndefined()
    expect(parseRepoIdentifierFromRemote('')).toBeUndefined()
  })
})

type FakeGitOptions = {
  remotes?: Array<{ name: string; refs: { fetch?: string; push?: string } }>
  toplevel?: string
  throwOnRemotes?: boolean
  throwOnToplevel?: boolean
}

function fakeGit(opts: FakeGitOptions): SimpleGit {
  return {
    getRemotes: async () => {
      if (opts.throwOnRemotes) throw new Error('not a git repo')
      return opts.remotes ?? []
    },
    revparse: async () => {
      if (opts.throwOnToplevel) throw new Error('not a git repo')
      return opts.toplevel ?? ''
    },
  } as unknown as SimpleGit
}

describe('resolveRepoIdentifier (#0.69)', () => {
  it('prefers owner/repo from the origin remote', async () => {
    const git = fakeGit({
      remotes: [
        { name: 'upstream', refs: { fetch: 'https://github.com/other/fork.git' } },
        { name: 'origin', refs: { fetch: 'git@github.com:gfargo/coco.git' } },
      ],
    })
    expect(await resolveRepoIdentifier({ git })).toBe('gfargo/coco')
  })

  it('falls back to the first remote when there is no origin', async () => {
    const git = fakeGit({
      remotes: [{ name: 'upstream', refs: { push: 'https://gitlab.com/group/repo.git' } }],
    })
    expect(await resolveRepoIdentifier({ git })).toBe('group/repo')
  })

  it('falls back to the toplevel directory name when there is no remote', async () => {
    const git = fakeGit({ remotes: [], toplevel: '/home/me/projects/my-app\n' })
    expect(await resolveRepoIdentifier({ git })).toBe('my-app')
  })

  it('returns undefined when not in a git repo', async () => {
    const git = fakeGit({ throwOnRemotes: true })
    expect(await resolveRepoIdentifier({ git })).toBeUndefined()
  })
})
