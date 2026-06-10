import {
  buildCreateMergeRequestArgs,
  createMergeRequest,
  openMergeRequest,
} from './mergeRequestActions'

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
