import { SimpleGit } from 'simple-git'
import { detectProvider, getProviderOverview, setForgeHostOverrides } from './providerData'
import { getMergeRequestOverview } from './gitlabListData'

describe('detectProvider + forgeHosts overrides (#0.70)', () => {
  afterEach(() => setForgeHostOverrides(undefined))

  it('detects known hosts and heuristic self-hosted / Enterprise names', () => {
    expect(detectProvider('github.com')).toBe('github')
    expect(detectProvider('gitlab.com')).toBe('gitlab')
    expect(detectProvider('gitlab.acme.com')).toBe('gitlab')
    expect(detectProvider('github.acme.com')).toBe('github') // GHE
    expect(detectProvider('git.acme.com')).toBe('unsupported') // vanity host
  })

  it('honors config overrides (case-insensitive) and clears them', () => {
    setForgeHostOverrides({ 'git.acme.com': 'gitlab', 'Code.Internal': 'github' })
    expect(detectProvider('git.acme.com')).toBe('gitlab')
    expect(detectProvider('CODE.internal')).toBe('github')
    setForgeHostOverrides(undefined)
    expect(detectProvider('git.acme.com')).toBe('unsupported')
  })
})

function gitlabGit(currentBranch = 'feature/x'): SimpleGit {
  return {
    getRemotes: async () => [{ name: 'origin', refs: { fetch: 'git@gitlab.com:group/proj.git' } }],
    raw: async (args: string[]) => {
      if (args[0] === 'branch') return `${currentBranch}\n`
      throw new Error('no symbolic-ref / rev-parse in test')
    },
  } as unknown as SimpleGit
}

describe('getProviderOverview — GitLab branch (#0.70)', () => {
  it('uses glab for auth, default branch, and current MR', async () => {
    const glab = async (args: string[]): Promise<string> => {
      if (args[0] === 'auth') return ''
      const ep = args[1]
      if (ep.includes('/merge_requests?')) {
        return JSON.stringify([{ iid: 9, title: 'MR', state: 'opened', draft: false }])
      }
      return JSON.stringify({ default_branch: 'main' }) // projects/<path>
    }
    const gh = async (): Promise<string> => {
      throw new Error('gh must not be called for a gitlab repo')
    }
    const overview = await getProviderOverview(gitlabGit(), gh, glab)
    expect(overview.repository.provider).toBe('gitlab')
    expect(overview.authenticated).toBe(true)
    expect(overview.repository.defaultBranch).toBe('main')
    expect(overview.currentPullRequest).toMatchObject({ number: 9, isDraft: false })
  })

  it('reports not-authenticated when glab is missing', async () => {
    const glab = async () => {
      throw Object.assign(new Error('x'), { code: 'ENOENT' })
    }
    const overview = await getProviderOverview(gitlabGit(), async () => '', glab)
    expect(overview.repository.provider).toBe('gitlab')
    expect(overview.authenticated).toBe(false)
    expect(overview.message).toContain('glab')
  })
})

describe('getMergeRequestOverview (#0.70)', () => {
  it('maps the current-branch MR to the shared overview shape', async () => {
    const glab = async (args: string[]): Promise<string> => {
      if (args[0] === 'auth') return ''
      return JSON.stringify([
        {
          iid: 9,
          title: 'MR',
          web_url: 'https://gitlab.com/group/proj/-/merge_requests/9',
          state: 'opened',
          draft: true,
          source_branch: 'feature/x',
          target_branch: 'main',
          description: 'body text',
          author: { username: 'alice' },
          merge_status: 'can_be_merged',
        },
      ])
    }
    const overview = await getMergeRequestOverview(gitlabGit(), glab)
    expect(overview.authenticated).toBe(true)
    expect(overview.currentPullRequest).toMatchObject({
      number: 9,
      isDraft: true,
      headRefName: 'feature/x',
      baseRefName: 'main',
      body: 'body text',
      author: 'alice',
      mergeable: 'can_be_merged',
    })
  })

  it('reports no MR when none is open for the branch', async () => {
    const glab = async (args: string[]): Promise<string> => (args[0] === 'auth' ? '' : '[]')
    const overview = await getMergeRequestOverview(gitlabGit(), glab)
    expect(overview.currentPullRequest).toBeUndefined()
    expect(overview.message).toContain('No merge request found')
  })
})
