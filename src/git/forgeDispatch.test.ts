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

import { SimpleGit } from 'simple-git'
import * as mr from './mergeRequestActions'
import * as issues from './gitlabIssueActions'
import * as lists from './gitlabListData'
import * as detail from './gitlabDetailData'
import { getForgeActions } from './forgeActions'
import { defaultGlabRunner } from './glabCli'

const fakeGit = {} as unknown as SimpleGit

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
