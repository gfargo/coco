/**
 * Proves the forge adapter actually dispatches GitLab work to the glab
 * implementations (the audit flagged that nothing tested this — the facade test
 * only checked method presence). The glab-side modules are auto-mocked so we can
 * assert the adapter calls them with the right arguments.
 */
jest.mock('./mergeRequestActions')
jest.mock('./gitlabIssueActions')
jest.mock('./gitlabListData')
jest.mock('./gitlabDetailData')
jest.mock('./giteaPullRequestActions')
jest.mock('./giteaIssueActions')
jest.mock('./giteaListData')
jest.mock('./giteaDetailData')
jest.mock('./giteaCli', () => ({
  ...jest.requireActual('./giteaCli'),
  makeGiteaRunner: jest.fn(() => mockGiteaRunner),
}))

import { SimpleGit } from 'simple-git'
import * as mr from './mergeRequestActions'
import * as issues from './gitlabIssueActions'
import * as lists from './gitlabListData'
import * as detail from './gitlabDetailData'
import * as giteaPR from './giteaPullRequestActions'
import * as giteaIssues from './giteaIssueActions'
import * as giteaLists from './giteaListData'
import * as giteaDetail from './giteaDetailData'
import { getForgeActions } from './forgeActions'
import { defaultGlabRunner } from './glabCli'

const fakeGit = {} as unknown as SimpleGit

// Referenced inside the `jest.mock('./giteaCli', ...)` factory above —
// jest's hoisting allowlist permits `mock`-prefixed identifiers to be
// referenced before the factory itself is (also hoisted) initialized.
const mockGiteaRunner = jest.fn()

describe('forge GitLab dispatch (#0.70)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('routes MR mutations to the glab implementations, binding runner + host', async () => {
    // The facade binds `defaultGlabRunner` + the remote host into every glab
    // action so the error-path auth re-probe (resolveGlabActionError) scopes to
    // the right instance. `undefined` host is fine — actions stay host-less.
    const forge = getForgeActions('gitlab', { gitlabPath: 'g/p', gitlabHost: 'gitlab.acme.com' })
    await forge.mergePullRequestByNumber(5, 'squash')
    await forge.commentPullRequestByNumber(5, 'hi')
    await forge.addPullRequestLabel(5, 'bug')
    await forge.addPullRequestAssignee(5, 'bob')
    await forge.approvePullRequestByNumber(5)
    await forge.closePullRequestByNumber(5)
    await forge.requestChangesPullRequestByNumber(5, 'fix')
    await forge.createPullRequest({ base: 'main', head: 'f', title: 'T', body: 'B' })

    const host = 'gitlab.acme.com'
    expect(mr.mergeMergeRequestByNumber).toHaveBeenCalledWith(5, 'squash', defaultGlabRunner, host)
    expect(mr.commentMergeRequestByNumber).toHaveBeenCalledWith(5, 'hi', defaultGlabRunner, host)
    expect(mr.addMergeRequestLabel).toHaveBeenCalledWith(5, 'bug', defaultGlabRunner, host)
    expect(mr.addMergeRequestAssignee).toHaveBeenCalledWith(5, 'bob', defaultGlabRunner, host)
    expect(mr.approveMergeRequestByNumber).toHaveBeenCalledWith(5, defaultGlabRunner, host)
    expect(mr.closeMergeRequestByNumber).toHaveBeenCalledWith(5, defaultGlabRunner, host)
    expect(mr.requestChangesMergeRequestByNumber).toHaveBeenCalledWith(5, 'fix', defaultGlabRunner, host)
    expect(mr.createMergeRequest).toHaveBeenCalledWith(
      { base: 'main', head: 'f', title: 'T', body: 'B' },
      defaultGlabRunner,
      host
    )
  })

  it('routes issue mutations to the glab implementations, binding runner + host', async () => {
    const forge = getForgeActions('gitlab', { gitlabHost: 'gitlab.acme.com' })
    await forge.commentIssue(7, 'hi')
    await forge.addIssueLabel(7, 'bug')
    await forge.addIssueAssignee(7, 'bob')
    await forge.closeIssue(7)
    await forge.reopenIssue(7)

    const host = 'gitlab.acme.com'
    expect(issues.commentGitLabIssue).toHaveBeenCalledWith(7, 'hi', defaultGlabRunner, host)
    expect(issues.addGitLabIssueLabel).toHaveBeenCalledWith(7, 'bug', defaultGlabRunner, host)
    expect(issues.addGitLabIssueAssignee).toHaveBeenCalledWith(7, 'bob', defaultGlabRunner, host)
    expect(issues.closeGitLabIssue).toHaveBeenCalledWith(7, defaultGlabRunner, host)
    expect(issues.reopenGitLabIssue).toHaveBeenCalledWith(7, defaultGlabRunner, host)
  })

  it('routes lists + detail to the glab implementations, binding the project path', async () => {
    const forge = getForgeActions('gitlab', { gitlabPath: 'g/p' })
    await forge.getPullRequestList(fakeGit, {})
    await forge.getIssueList(fakeGit, {})
    await forge.getPullRequestDetail(3)
    await forge.getIssueDetail(4)

    expect(lists.getMergeRequestList).toHaveBeenCalledWith(fakeGit, {})
    expect(lists.getGitLabIssueList).toHaveBeenCalledWith(fakeGit, {})
    expect(detail.getMergeRequestDetail).toHaveBeenCalledWith('g/p', 3)
    expect(detail.getGitLabIssueDetail).toHaveBeenCalledWith('g/p', 4)
  })

  it('does not call any glab implementation for a github repo', async () => {
    const forge = getForgeActions('github')
    // The github path is the real implementation (not mocked); it will throw on
    // the bare git stub, which is fine — we only assert no glab routing happened.
    await forge.getPullRequestList(fakeGit, {}).catch(() => undefined)
    expect(lists.getMergeRequestList).not.toHaveBeenCalled()
    expect(mr.mergeMergeRequestByNumber).not.toHaveBeenCalled()
  })
})

describe('forge Gitea dispatch (#826)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('routes PR mutations to the gitea implementations, binding a host-bound runner', async () => {
    const forge = getForgeActions('gitea', { giteaPath: 'o/r', giteaHost: 'codeberg.org' })
    await forge.mergePullRequestByNumber(5, 'squash')
    await forge.commentPullRequestByNumber(5, 'hi')
    await forge.addPullRequestLabel(5, 'bug')
    await forge.addPullRequestAssignee(5, 'bob')
    await forge.approvePullRequestByNumber(5)
    await forge.closePullRequestByNumber(5)
    await forge.requestChangesPullRequestByNumber(5, 'fix')
    await forge.getPullRequestDiffByNumber(5)
    await forge.createPullRequest({ base: 'main', head: 'f', title: 'T', body: 'B' })

    expect(giteaPR.mergeGiteaPullRequestByNumber).toHaveBeenCalledWith('o/r', 5, 'squash', mockGiteaRunner)
    expect(giteaPR.commentGiteaPullRequestByNumber).toHaveBeenCalledWith('o/r', 5, 'hi', mockGiteaRunner)
    expect(giteaPR.addGiteaPullRequestLabel).toHaveBeenCalledWith('o/r', 5, 'bug', mockGiteaRunner)
    expect(giteaPR.addGiteaPullRequestReviewer).toHaveBeenCalledWith('o/r', 5, 'bob', mockGiteaRunner)
    expect(giteaPR.approveGiteaPullRequestByNumber).toHaveBeenCalledWith('o/r', 5, mockGiteaRunner)
    expect(giteaPR.closeGiteaPullRequestByNumber).toHaveBeenCalledWith('o/r', 5, mockGiteaRunner)
    expect(giteaPR.requestChangesGiteaPullRequestByNumber).toHaveBeenCalledWith('o/r', 5, 'fix', mockGiteaRunner)
    expect(giteaDetail.getGiteaPullRequestDiff).toHaveBeenCalledWith('o/r', 5, mockGiteaRunner)
    expect(giteaPR.createGiteaPullRequest).toHaveBeenCalledWith(
      'o/r',
      { base: 'main', head: 'f', title: 'T', body: 'B' },
      mockGiteaRunner
    )
  })

  it('routes issue mutations to the gitea implementations, binding a host-bound runner', async () => {
    const forge = getForgeActions('gitea', { giteaPath: 'o/r', giteaHost: 'codeberg.org' })
    await forge.commentIssue(7, 'hi')
    await forge.addIssueLabel(7, 'bug')
    await forge.addIssueAssignee(7, 'bob')
    await forge.closeIssue(7)
    await forge.reopenIssue(7)

    expect(giteaIssues.commentGiteaIssue).toHaveBeenCalledWith('o/r', 7, 'hi', mockGiteaRunner)
    expect(giteaIssues.addGiteaIssueLabel).toHaveBeenCalledWith('o/r', 7, 'bug', mockGiteaRunner)
    expect(giteaIssues.addGiteaIssueAssignee).toHaveBeenCalledWith('o/r', 7, 'bob', mockGiteaRunner)
    expect(giteaIssues.closeGiteaIssue).toHaveBeenCalledWith('o/r', 7, mockGiteaRunner)
    expect(giteaIssues.reopenGiteaIssue).toHaveBeenCalledWith('o/r', 7, mockGiteaRunner)
  })

  it('routes lists + detail to the gitea implementations, binding the project path', async () => {
    const forge = getForgeActions('gitea', { giteaPath: 'o/r', giteaHost: 'codeberg.org' })
    await forge.getPullRequestList(fakeGit, {})
    await forge.getIssueList(fakeGit, {})
    await forge.getPullRequestDetail(3)
    await forge.getIssueDetail(4)

    expect(giteaLists.getGiteaPullRequestList).toHaveBeenCalledWith(fakeGit, {})
    expect(giteaLists.getGiteaIssueList).toHaveBeenCalledWith(fakeGit, {})
    expect(giteaDetail.getGiteaPullRequestDetail).toHaveBeenCalledWith('o/r', 3, mockGiteaRunner)
    expect(giteaDetail.getGiteaIssueDetail).toHaveBeenCalledWith('o/r', 4, mockGiteaRunner)
  })

  it('does not call any gitea implementation for a github repo', async () => {
    const forge = getForgeActions('github')
    await forge.getPullRequestList(fakeGit, {}).catch(() => undefined)
    expect(giteaLists.getGiteaPullRequestList).not.toHaveBeenCalled()
    expect(giteaPR.mergeGiteaPullRequestByNumber).not.toHaveBeenCalled()
  })
})
