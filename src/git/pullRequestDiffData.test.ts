import {
  buildPullRequestDiffArgs,
  getPullRequestDiff,
  parsePullRequestDiffLines,
} from './pullRequestDiffData'

const SAMPLE_PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,2 @@',
  '-old line',
  '+new line',
].join('\n')

describe('pull request diff data (#1363)', () => {
  it('builds the gh pr diff argv with flag=value color suppression', () => {
    expect(buildPullRequestDiffArgs(962)).toEqual([
      'pr',
      'diff',
      '962',
      '--color=never',
    ])
  })

  describe('parsePullRequestDiffLines', () => {
    it('splits the patch into lines and drops the trailing newline', () => {
      expect(parsePullRequestDiffLines(`${SAMPLE_PATCH}\n`)).toEqual(
        SAMPLE_PATCH.split('\n')
      )
    })

    it('strips CR from CRLF patches', () => {
      expect(parsePullRequestDiffLines('line one\r\nline two\r\n')).toEqual([
        'line one',
        'line two',
      ])
    })

    it('maps an empty / whitespace-only patch to [] (renders the empty hint, not a blank row)', () => {
      expect(parsePullRequestDiffLines('')).toEqual([])
      expect(parsePullRequestDiffLines('\n')).toEqual([])
    })
  })

  it('fetches and parses the patch through the injected runner', async () => {
    const runner = jest.fn().mockResolvedValue(`${SAMPLE_PATCH}\n`)
    const result = await getPullRequestDiff(41, runner)
    expect(runner).toHaveBeenCalledWith(['pr', 'diff', '41', '--color=never'])
    expect(result).toEqual({ ok: true, lines: SAMPLE_PATCH.split('\n') })
  })

  it('captures a gh failure as { ok: false } with the stderr message (no throw)', async () => {
    const failure = Object.assign(new Error('Command failed: gh pr diff 41'), {
      stderr: 'GraphQL: Could not resolve to a PullRequest with the number of 41.',
    })
    // First call (the diff) rejects; the error resolver's auth probe
    // (`gh auth status`) succeeds so the original stderr surfaces.
    const runner = jest
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue('Logged in to github.com')
    const result = await getPullRequestDiff(41, runner)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('Could not resolve to a PullRequest')
    }
  })
})
