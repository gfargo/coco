/**
 * Coverage for the forge/PR/issue-triage workflow handlers extracted out
 * of `useWorkflowAction.ts` (#1765 follow-up, OSS-948). The forge facade
 * is a plain mock object (matching how `useWorkflowAction` threads it
 * in), and `defaultOpenUrlRunner` is mocked so the open-url handlers
 * resolve without touching a real browser.
 */
import { createForgeTriageWorkflowHandlers } from './useForgeTriageWorkflowActions'
import { defaultOpenUrlRunner } from '../../../git/historyActions'
import type { ForgeActions } from '../../../git/forgeActions'
import type { LogInkState } from '../inkViewModel'
import type { LogInkContext } from '../types'
import type { IssueListItem } from '../../../git/issuesListData'
import type { PullRequestListItem } from '../../../git/pullRequestListData'

jest.mock('../../../git/historyActions', () => {
  const actual = jest.requireActual('../../../git/historyActions')
  return {
    ...actual,
    defaultOpenUrlRunner: jest.fn().mockResolvedValue(undefined),
  }
})

const defaultOpenUrlRunnerMock = defaultOpenUrlRunner as jest.MockedFunction<typeof defaultOpenUrlRunner>

const issue: IssueListItem = {
  number: 42,
  title: 'Something broke',
  url: 'https://github.com/acme/repo/issues/42',
  state: 'OPEN',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

const pr: PullRequestListItem = {
  number: 7,
  title: 'Fix the thing',
  url: 'https://github.com/acme/repo/pull/7',
  state: 'OPEN',
  isDraft: false,
  headRefName: 'fix-branch',
  baseRefName: 'main',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

const stateWithSelection = (): LogInkState =>
  ({
    filter: '',
    selectedIssueId: String(issue.number),
    selectedIssueIndex: 0,
    selectedPullRequestTriageId: String(pr.number),
    selectedPullRequestTriageIndex: 0,
  }) as unknown as LogInkState

const emptyState = (): LogInkState =>
  ({
    filter: '',
    selectedIssueId: undefined,
    selectedIssueIndex: 0,
    selectedPullRequestTriageId: undefined,
    selectedPullRequestTriageIndex: 0,
  }) as unknown as LogInkState

const contextWithEntries = (): LogInkContext =>
  ({
    issueList: { issues: [issue] },
    pullRequestList: { pullRequests: [pr] },
    branches: { currentBranch: 'fix-branch' },
    provider: { repository: { defaultBranch: 'main' } },
  }) as unknown as LogInkContext

const emptyContext = (): LogInkContext =>
  ({
    issueList: { issues: [] },
    pullRequestList: { pullRequests: [] },
  }) as unknown as LogInkContext

function createForgeMock(): ForgeActions {
  return {
    getPullRequestList: jest.fn(),
    getIssueList: jest.fn(),
    getPullRequestDetail: jest.fn(),
    getIssueDetail: jest.fn(),
    getPullRequestDiffByNumber: jest.fn(),
    commentPullRequestByNumber: jest.fn().mockResolvedValue({ ok: true, message: 'commented' }),
    addPullRequestLabel: jest.fn().mockResolvedValue({ ok: true, message: 'labeled' }),
    addPullRequestAssignee: jest.fn().mockResolvedValue({ ok: true, message: 'assigned' }),
    mergePullRequestByNumber: jest.fn().mockResolvedValue({ ok: true, message: 'merged' }),
    closePullRequestByNumber: jest.fn().mockResolvedValue({ ok: true, message: 'closed' }),
    approvePullRequestByNumber: jest.fn().mockResolvedValue({ ok: true, message: 'approved' }),
    requestChangesPullRequestByNumber: jest.fn().mockResolvedValue({ ok: true, message: 'requested changes' }),
    checkoutPullRequestByNumber: jest.fn().mockResolvedValue({ ok: true, message: 'checked out' }),
    mergePullRequest: jest.fn().mockResolvedValue({ ok: true, message: 'merged' }),
    closePullRequest: jest.fn().mockResolvedValue({ ok: true, message: 'closed' }),
    approvePullRequest: jest.fn().mockResolvedValue({ ok: true, message: 'approved' }),
    commentPullRequest: jest.fn().mockResolvedValue({ ok: true, message: 'commented' }),
    requestChangesPullRequest: jest.fn().mockResolvedValue({ ok: true, message: 'requested changes' }),
    createPullRequest: jest.fn().mockResolvedValue({ ok: true, message: 'created' }),
    openPullRequest: jest.fn(),
    commentIssue: jest.fn().mockResolvedValue({ ok: true, message: 'commented' }),
    addIssueLabel: jest.fn().mockResolvedValue({ ok: true, message: 'labeled' }),
    addIssueAssignee: jest.fn().mockResolvedValue({ ok: true, message: 'assigned' }),
    closeIssue: jest.fn().mockResolvedValue({ ok: true, message: 'closed' }),
    reopenIssue: jest.fn().mockResolvedValue({ ok: true, message: 'reopened' }),
  } as unknown as ForgeActions
}

function createBaseDeps(over: {
  state?: LogInkState
  context?: LogInkContext
  payload?: string
  forge?: ForgeActions
}) {
  return {
    forge: over.forge ?? createForgeMock(),
    forgeProvider: undefined,
    state: over.state ?? stateWithSelection(),
    context: over.context ?? contextWithEntries(),
    payload: over.payload,
    setContext: jest.fn(),
    setContextStatus: jest.fn(),
    issuedAtDepth: 0,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('guards', () => {
  it('rejects triage handlers when nothing is selected', async () => {
    const handlers = createForgeTriageWorkflowHandlers(
      createBaseDeps({ state: emptyState(), context: emptyContext(), payload: 'hello' })
    )

    await expect(handlers['triage-issue-comment']()).resolves.toEqual({
      ok: false,
      message: 'No issue under cursor',
    })
    await expect(handlers['triage-pr-comment']()).resolves.toEqual({
      ok: false,
      message: 'No pull request under cursor',
    })
    await expect(handlers['triage-pr-checkout']()).resolves.toEqual({
      ok: false,
      message: 'No pull request under cursor',
    })
  })

  it('rejects a blank create-pr title', async () => {
    const forge = createForgeMock()
    const handlers = createForgeTriageWorkflowHandlers(createBaseDeps({ forge, payload: '   ' }))

    await expect(handlers['create-pr']()).resolves.toEqual({
      ok: false,
      message: 'Pull request title is required (first line of the prompt).',
    })
    expect(forge.createPullRequest).not.toHaveBeenCalled()
  })
})

describe('create-pr', () => {
  it('derives head/base from context and splits title/body from the payload', async () => {
    const forge = createForgeMock()
    const handlers = createForgeTriageWorkflowHandlers(
      createBaseDeps({ forge, payload: 'Fix the thing\n\nSome body text' })
    )

    await handlers['create-pr']()

    expect(forge.createPullRequest).toHaveBeenCalledWith({
      base: 'main',
      head: 'fix-branch',
      title: 'Fix the thing',
      body: 'Some body text',
    })
  })
})

describe('triage mutations', () => {
  it('comments on the selected issue and invalidates its caches on success', async () => {
    const forge = createForgeMock()
    const setContext = jest.fn()
    const setContextStatus = jest.fn()
    const handlers = createForgeTriageWorkflowHandlers({
      ...createBaseDeps({ forge, payload: 'looks good' }),
      setContext,
      setContextStatus,
    })

    const result = await handlers['triage-issue-comment']()

    expect(forge.commentIssue).toHaveBeenCalledWith(issue.number, 'looks good')
    expect(result).toEqual({ ok: true, message: 'commented' })
    expect(setContext).toHaveBeenCalledWith(expect.any(Function), 0)
    expect(setContextStatus).toHaveBeenCalledWith(expect.any(Function), 0)
  })

  it('checks out a PR by cursor when no payload number is given', async () => {
    const forge = createForgeMock()
    const handlers = createForgeTriageWorkflowHandlers(createBaseDeps({ forge }))

    await handlers['triage-pr-checkout']()

    expect(forge.checkoutPullRequestByNumber).toHaveBeenCalledWith(pr.number)
  })

  it('checks out a PR by payload number when provided, bypassing the cursor', async () => {
    const forge = createForgeMock()
    const handlers = createForgeTriageWorkflowHandlers(createBaseDeps({ forge, payload: '99' }))

    await handlers['triage-pr-checkout']()

    expect(forge.checkoutPullRequestByNumber).toHaveBeenCalledWith(99)
  })

  it('opens the selected issue and PR URLs via defaultOpenUrlRunner', async () => {
    const forge = createForgeMock()
    const handlers = createForgeTriageWorkflowHandlers(createBaseDeps({ forge }))

    await expect(handlers['triage-issue-open']()).resolves.toEqual({
      ok: true,
      message: `Opened ${issue.url}`,
    })
    expect(defaultOpenUrlRunnerMock).toHaveBeenCalledWith(issue.url)

    await expect(handlers['triage-pr-open']()).resolves.toEqual({
      ok: true,
      message: `Opened ${pr.url}`,
    })
    expect(defaultOpenUrlRunnerMock).toHaveBeenCalledWith(pr.url)
  })
})
