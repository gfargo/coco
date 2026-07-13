/**
 * Coverage for the `coco issues` command (#1642) — argv→filter mapping,
 * forge-dispatch selection, and the `--json` contract. Mirrors
 * `../prs/prs.test.ts`; the two commands share `createGitHubListHandler`.
 */
jest.mock('../utils/applyRepoFlag')
jest.mock('../../git/providerData')
jest.mock('../../git/issuesListData')
jest.mock('../../git/gitlabListData')
jest.mock('../../git/bitbucketListData')
jest.mock('../../lib/ui/emitJson')

import { Arguments } from 'yargs'
import { SimpleGit } from 'simple-git'
import { handler } from './handler'
import { IssuesOptions } from './config'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { getProviderRepositoryForGit } from '../../git/providerData'
import { getIssueList } from '../../git/issuesListData'
import { getGitLabIssueList } from '../../git/gitlabListData'
import { getBitbucketIssueList } from '../../git/bitbucketListData'
import { emitJson } from '../../lib/ui/emitJson'
import { Logger } from '../../lib/utils/logger'

const applyRepoFlagMock = applyRepoFlag as jest.MockedFunction<typeof applyRepoFlag>
const getProviderRepositoryForGitMock =
  getProviderRepositoryForGit as jest.MockedFunction<typeof getProviderRepositoryForGit>
const getIssueListMock = getIssueList as jest.MockedFunction<typeof getIssueList>
const getGitLabIssueListMock = getGitLabIssueList as jest.MockedFunction<typeof getGitLabIssueList>
const getBitbucketIssueListMock =
  getBitbucketIssueList as jest.MockedFunction<typeof getBitbucketIssueList>
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

function baseArgv(overrides: Partial<IssuesOptions> = {}): Arguments<IssuesOptions> {
  return {
    $0: 'coco',
    _: ['issues'],
    state: 'open',
    mine: false,
    json: false,
    refresh: false,
    cache: false,
    ...overrides,
  } as Arguments<IssuesOptions>
}

const overview = {
  available: true,
  authenticated: true,
  issues: [
    { number: 1, title: 'Bug report', url: 'https://x/1', state: 'OPEN', createdAt: '', updatedAt: '' },
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
  getIssueListMock.mockResolvedValue(overview as never)
  getGitLabIssueListMock.mockResolvedValue(overview as never)
  getBitbucketIssueListMock.mockResolvedValue(overview as never)
})

describe('coco issues — argv to filter mapping', () => {
  it('maps --mine to assignee @me, overriding a bare --assignee', async () => {
    await handler(baseArgv({ mine: true, assignee: 'someone-else' }), createLogger())

    expect(getIssueListMock).toHaveBeenCalledWith(
      fakeGit,
      expect.objectContaining({ assignee: '@me' })
    )
  })

  it('passes state, author, label, search, limit straight through', async () => {
    await handler(
      baseArgv({
        state: 'closed',
        author: 'octocat',
        label: 'bug',
        search: 'is:open',
        limit: 5,
      }),
      createLogger()
    )

    expect(getIssueListMock).toHaveBeenCalledWith(fakeGit, {
      state: 'closed',
      assignee: undefined,
      author: 'octocat',
      label: 'bug',
      search: 'is:open',
      limit: 5,
    })
  })
})

describe('coco issues — forge dispatch selection', () => {
  it('routes to getIssueList for github', async () => {
    await handler(baseArgv(), createLogger())
    expect(getIssueListMock).toHaveBeenCalled()
    expect(getGitLabIssueListMock).not.toHaveBeenCalled()
    expect(getBitbucketIssueListMock).not.toHaveBeenCalled()
  })

  it('routes to getGitLabIssueList for gitlab', async () => {
    getProviderRepositoryForGitMock.mockResolvedValue({
      provider: 'gitlab', remote: 'origin', owner: 'acme', name: 'widgets',
    })
    await handler(baseArgv(), createLogger())
    expect(getGitLabIssueListMock).toHaveBeenCalled()
    expect(getIssueListMock).not.toHaveBeenCalled()
    expect(getBitbucketIssueListMock).not.toHaveBeenCalled()
  })

  it('routes to getBitbucketIssueList for bitbucket', async () => {
    getProviderRepositoryForGitMock.mockResolvedValue({
      provider: 'bitbucket', remote: 'origin', owner: 'acme', name: 'widgets',
    })
    await handler(baseArgv(), createLogger())
    expect(getBitbucketIssueListMock).toHaveBeenCalled()
    expect(getIssueListMock).not.toHaveBeenCalled()
    expect(getGitLabIssueListMock).not.toHaveBeenCalled()
  })
})

describe('coco issues — --json contract', () => {
  it('emits the raw item list as JSON instead of the formatted table', async () => {
    const logger = createLogger()
    await handler(baseArgv({ json: true }), logger)

    expect(emitJsonMock).toHaveBeenCalledWith(overview.issues)
    expect(logger.log).not.toHaveBeenCalled()
  })
})
