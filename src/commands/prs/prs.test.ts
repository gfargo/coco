/**
 * Coverage for the `coco prs` command (#1642) — argv→filter mapping,
 * forge-dispatch selection, and the `--json` contract. The shared engine
 * (`createGitHubListHandler`) is exercised through the composed handler
 * rather than in isolation, since the spec object it's built from isn't
 * exported separately.
 */
jest.mock('../utils/applyRepoFlag')
jest.mock('../../git/providerData')
jest.mock('../../git/pullRequestListData')
jest.mock('../../git/gitlabListData')
jest.mock('../../git/bitbucketListData')
jest.mock('../../lib/ui/emitJson')

import { Arguments } from 'yargs'
import { SimpleGit } from 'simple-git'
import { handler } from './handler'
import { PrsOptions } from './config'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { getProviderRepositoryForGit } from '../../git/providerData'
import { getPullRequestList } from '../../git/pullRequestListData'
import { getMergeRequestList } from '../../git/gitlabListData'
import { getBitbucketPullRequestList } from '../../git/bitbucketListData'
import { emitJson } from '../../lib/ui/emitJson'
import { Logger } from '../../lib/utils/logger'

const applyRepoFlagMock = applyRepoFlag as jest.MockedFunction<typeof applyRepoFlag>
const getProviderRepositoryForGitMock =
  getProviderRepositoryForGit as jest.MockedFunction<typeof getProviderRepositoryForGit>
const getPullRequestListMock = getPullRequestList as jest.MockedFunction<typeof getPullRequestList>
const getMergeRequestListMock = getMergeRequestList as jest.MockedFunction<typeof getMergeRequestList>
const getBitbucketPullRequestListMock =
  getBitbucketPullRequestList as jest.MockedFunction<typeof getBitbucketPullRequestList>
const emitJsonMock = emitJson as jest.MockedFunction<typeof emitJson>

const fakeGit = {} as SimpleGit

function createLogger(): Logger {
  return {
    log: jest.fn(),
    verbose: jest.fn(),
    setConfig: jest.fn(),
    error: jest.fn(),
    startTimer: jest.fn().mockReturnThis(),
    stopTimer: jest.fn().mockReturnThis(),
    startSpinner: jest.fn().mockReturnThis(),
    stopSpinner: jest.fn().mockReturnThis(),
  } as unknown as Logger
}

function baseArgv(overrides: Partial<PrsOptions> = {}): Arguments<PrsOptions> {
  return {
    $0: 'coco',
    _: ['prs'],
    state: 'open',
    draft: false,
    mine: false,
    json: false,
    refresh: false,
    cache: false,
    ...overrides,
  } as Arguments<PrsOptions>
}

const overview = {
  available: true,
  authenticated: true,
  pullRequests: [
    { number: 1, title: 'Add feature', url: 'https://x/1', state: 'OPEN', isDraft: false, headRefName: 'f', baseRefName: 'main', createdAt: '', updatedAt: '' },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  applyRepoFlagMock.mockReturnValue(fakeGit)
  getProviderRepositoryForGitMock.mockResolvedValue({
    provider: 'github',
    remote: 'origin',
    owner: 'acme',
    name: 'widgets',
  })
  getPullRequestListMock.mockResolvedValue(overview as never)
  getMergeRequestListMock.mockResolvedValue(overview as never)
  getBitbucketPullRequestListMock.mockResolvedValue(overview as never)
})

describe('coco prs — argv to filter mapping', () => {
  it('maps --mine to assignee @me, overriding a bare --assignee', async () => {
    await handler(baseArgv({ mine: true, assignee: 'someone-else' }), createLogger())

    expect(getPullRequestListMock).toHaveBeenCalledWith(
      fakeGit,
      expect.objectContaining({ assignee: '@me' })
    )
  })

  it('passes state, author, label, search, base, head, draft, limit straight through', async () => {
    await handler(
      baseArgv({
        state: 'closed',
        author: 'octocat',
        label: 'bug',
        search: 'is:open',
        base: 'main',
        head: 'feature/x',
        draft: true,
        limit: 5,
      }),
      createLogger()
    )

    expect(getPullRequestListMock).toHaveBeenCalledWith(fakeGit, {
      state: 'closed',
      assignee: undefined,
      author: 'octocat',
      label: 'bug',
      search: 'is:open',
      base: 'main',
      head: 'feature/x',
      draft: true,
      limit: 5,
    })
  })
})

describe('coco prs — forge dispatch selection', () => {
  it('routes to getPullRequestList for github', async () => {
    getProviderRepositoryForGitMock.mockResolvedValue({
      provider: 'github', remote: 'origin', owner: 'acme', name: 'widgets',
    })
    await handler(baseArgv(), createLogger())
    expect(getPullRequestListMock).toHaveBeenCalled()
    expect(getMergeRequestListMock).not.toHaveBeenCalled()
    expect(getBitbucketPullRequestListMock).not.toHaveBeenCalled()
  })

  it('routes to getMergeRequestList for gitlab', async () => {
    getProviderRepositoryForGitMock.mockResolvedValue({
      provider: 'gitlab', remote: 'origin', owner: 'acme', name: 'widgets',
    })
    await handler(baseArgv(), createLogger())
    expect(getMergeRequestListMock).toHaveBeenCalled()
    expect(getPullRequestListMock).not.toHaveBeenCalled()
    expect(getBitbucketPullRequestListMock).not.toHaveBeenCalled()
  })

  it('routes to getBitbucketPullRequestList for bitbucket', async () => {
    getProviderRepositoryForGitMock.mockResolvedValue({
      provider: 'bitbucket', remote: 'origin', owner: 'acme', name: 'widgets',
    })
    await handler(baseArgv(), createLogger())
    expect(getBitbucketPullRequestListMock).toHaveBeenCalled()
    expect(getPullRequestListMock).not.toHaveBeenCalled()
    expect(getMergeRequestListMock).not.toHaveBeenCalled()
  })
})

describe('coco prs — --json contract', () => {
  it('emits the raw item list as JSON instead of the formatted table', async () => {
    const logger = createLogger()
    await handler(baseArgv({ json: true }), logger)

    expect(emitJsonMock).toHaveBeenCalledWith(overview.pullRequests)
    expect(logger.log).not.toHaveBeenCalled()
  })
})
