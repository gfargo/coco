import {
  addMergeRequestAssignee,
  addMergeRequestLabel,
  approveMergeRequest,
  approveMergeRequestByNumber,
  buildCreateMergeRequestArgs,
  closeMergeRequest,
  closeMergeRequestByNumber,
  commentMergeRequest,
  commentMergeRequestByNumber,
  createMergeRequest,
  mergeMergeRequest,
  mergeMergeRequestByNumber,
  openMergeRequest,
  requestChangesMergeRequestByNumber,
} from './mergeRequestActions'

/** Capture the args a glab action passes to the runner. */
function capturingRunner(): { calls: string[][]; runner: (a: string[]) => Promise<string> } {
  const calls: string[][] = []
  return { calls, runner: async (a: string[]) => { calls.push(a); return '' } }
}

describe('buildCreateMergeRequestArgs (#0.70)', () => {
  it('maps create input to glab mr create flags', () => {
    expect(
      buildCreateMergeRequestArgs({ base: 'main', head: 'feature/x', title: 'T', body: 'B' })
    ).toEqual([
      'mr',
      'create',
      '--source-branch',
      'feature/x',
      '--target-branch',
      'main',
      '--title',
      'T',
      '--description',
      'B',
      '--push',
      '--yes',
    ])
  })

  it('appends --draft for draft MRs', () => {
    expect(
      buildCreateMergeRequestArgs({ base: 'main', head: 'f', title: 'T', body: 'B', draft: true })
    ).toContain('--draft')
  })
})

describe('createMergeRequest (#0.70)', () => {
  it('parses the created MR url from glab output', async () => {
    const runner = async () => 'Creating merge request\nhttps://gitlab.com/g/p/-/merge_requests/3\n'
    const result = await createMergeRequest(
      { base: 'main', head: 'f', title: 'T', body: 'B' },
      runner
    )
    expect(result).toEqual({
      ok: true,
      message: 'Created merge request: https://gitlab.com/g/p/-/merge_requests/3',
      url: 'https://gitlab.com/g/p/-/merge_requests/3',
    })
  })

  it('returns a recovery hint when glab is unavailable', async () => {
    const runner = async () => {
      throw Object.assign(new Error('x'), { code: 'ENOENT' })
    }
    const result = await createMergeRequest({ base: 'main', head: 'f', title: 'T', body: 'B' }, runner)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('glab')
  })

  it('openMergeRequest reports the url', async () => {
    const result = await openMergeRequest('https://gitlab.com/g/p/-/merge_requests/3', async () => '')
    expect(result).toEqual({
      ok: true,
      message: 'Opened merge request: https://gitlab.com/g/p/-/merge_requests/3',
      url: 'https://gitlab.com/g/p/-/merge_requests/3',
    })
  })
})

describe('MR mutating action arg contracts (#0.70)', () => {
  it('builds glab mr verbs by number', async () => {
    const { calls, runner } = capturingRunner()
    await mergeMergeRequestByNumber(5, 'squash', runner)
    await mergeMergeRequestByNumber(5, 'merge', runner)
    await approveMergeRequestByNumber(5, runner)
    await closeMergeRequestByNumber(5, runner)
    await commentMergeRequestByNumber(5, 'hi', runner)
    await requestChangesMergeRequestByNumber(5, 'fix it', runner)
    await addMergeRequestLabel(5, 'bug', runner)
    await addMergeRequestAssignee(5, 'bob', runner)
    expect(calls).toEqual([
      ['mr', 'merge', '5', '--squash', '--yes'],
      ['mr', 'merge', '5', '--yes'],
      ['mr', 'approve', '5'],
      ['mr', 'close', '5'],
      ['mr', 'note', 'create', '5', '--message', 'hi'],
      ['mr', 'note', 'create', '5', '--message', 'Requested changes: fix it'],
      ['mr', 'update', '5', '--label', 'bug'],
      ['mr', 'update', '5', '--assignee', '+bob'],
    ])
  })

  it('builds glab mr verbs for the current branch (no IID)', async () => {
    const { calls, runner } = capturingRunner()
    await mergeMergeRequest('rebase', runner)
    await closeMergeRequest(runner)
    await approveMergeRequest(runner)
    await commentMergeRequest('hello', runner)
    expect(calls).toEqual([
      ['mr', 'merge', '--rebase', '--yes'],
      ['mr', 'close'],
      ['mr', 'approve'],
      ['mr', 'note', 'create', '--message', 'hello'],
    ])
  })

  it('rejects empty comment / label / assignee bodies', async () => {
    expect((await commentMergeRequestByNumber(5, '  ')).ok).toBe(false)
    expect((await addMergeRequestLabel(5, '')).ok).toBe(false)
    expect((await addMergeRequestAssignee(5, '')).ok).toBe(false)
  })
})
