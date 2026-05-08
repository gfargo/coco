import { SimpleGit } from 'simple-git'
import { getReflogOverview, parseReflogOverview, splitReflogSubject } from './reflogData'

const SEP = '\x1f'

describe('parseReflogOverview', () => {
  it('returns an empty list for empty output', () => {
    expect(parseReflogOverview('')).toEqual([])
    expect(parseReflogOverview('\n\n')).toEqual([])
  })

  it('parses well-formed entries with selector, hash, relative date, and subject', () => {
    const output = [
      `HEAD@{0}${SEP}abc1234${SEP}2 hours ago${SEP}commit: add reflog view`,
      `HEAD@{1}${SEP}def5678${SEP}3 hours ago${SEP}checkout: moving from main to feat/reflog`,
      `HEAD@{2}${SEP}ghi9012${SEP}1 day ago${SEP}merge feature: Merge branch 'feature' into main`,
    ].join('\n')

    expect(parseReflogOverview(output)).toEqual([
      {
        selector: 'HEAD@{0}',
        hash: 'abc1234',
        relativeDate: '2 hours ago',
        subject: 'commit: add reflog view',
      },
      {
        selector: 'HEAD@{1}',
        hash: 'def5678',
        relativeDate: '3 hours ago',
        subject: 'checkout: moving from main to feat/reflog',
      },
      {
        selector: 'HEAD@{2}',
        hash: 'ghi9012',
        relativeDate: '1 day ago',
        subject: "merge feature: Merge branch 'feature' into main",
      },
    ])
  })

  it('tolerates trailing whitespace and blank lines between entries', () => {
    const output = [
      `HEAD@{0}${SEP}abc${SEP}now${SEP}commit: a   `,
      '',
      `HEAD@{1}${SEP}def${SEP}now${SEP}commit: b`,
      '',
    ].join('\n')

    const entries = parseReflogOverview(output)
    expect(entries).toHaveLength(2)
    expect(entries[0].selector).toBe('HEAD@{0}')
    expect(entries[1].selector).toBe('HEAD@{1}')
  })

  it('fills missing fields with empty strings rather than undefined', () => {
    // Defensive — a malformed line missing the subject shouldn't crash
    // the renderer. Selector + hash come through; the rest is empty.
    const output = `HEAD@{0}${SEP}abc${SEP}now`
    expect(parseReflogOverview(output)).toEqual([
      {
        selector: 'HEAD@{0}',
        hash: 'abc',
        relativeDate: 'now',
        subject: '',
      },
    ])
  })
})

describe('getReflogOverview', () => {
  it('invokes git reflog with the expected format and parses the result', async () => {
    const raw = jest.fn().mockResolvedValue(
      `HEAD@{0}${SEP}abc${SEP}now${SEP}commit: x\nHEAD@{1}${SEP}def${SEP}5 minutes ago${SEP}checkout: moving from main to dev`
    )
    const git = { raw } as unknown as SimpleGit

    const result = await getReflogOverview(git, 50)

    expect(raw).toHaveBeenCalledWith([
      'reflog',
      '--max-count=50',
      `--pretty=format:%gd${SEP}%h${SEP}%cr${SEP}%gs`,
    ])
    expect(result.entries).toHaveLength(2)
    expect(result.entries[0].selector).toBe('HEAD@{0}')
  })

  it('uses a sensible default limit when none is provided', async () => {
    const raw = jest.fn().mockResolvedValue('')
    const git = { raw } as unknown as SimpleGit

    await getReflogOverview(git)

    const args = raw.mock.calls[0][0] as string[]
    expect(args).toContain('--max-count=200')
  })
})

describe('splitReflogSubject', () => {
  it('separates the action prefix from the message at the first colon', () => {
    expect(splitReflogSubject('commit: my message')).toEqual({
      action: 'commit',
      message: 'my message',
    })
  })

  it('preserves parenthetical qualifiers in the action prefix', () => {
    expect(splitReflogSubject('commit (amend): updated message')).toEqual({
      action: 'commit (amend)',
      message: 'updated message',
    })
  })

  it('handles checkout subjects with no leading verb-only convention', () => {
    expect(splitReflogSubject('checkout: moving from main to feature')).toEqual({
      action: 'checkout',
      message: 'moving from main to feature',
    })
  })

  it('treats subjects without a colon as action-only with empty message', () => {
    expect(splitReflogSubject('reset')).toEqual({
      action: 'reset',
      message: '',
    })
  })

  it('trims whitespace around both action and message', () => {
    expect(splitReflogSubject('  commit  :  my message  ')).toEqual({
      action: 'commit',
      message: 'my message',
    })
  })
})
