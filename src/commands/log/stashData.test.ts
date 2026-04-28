import { getStashDiffSummary, getStashOverview, parseStashFiles, parseStashList, stashDataTestInternals } from './stashData'

describe('log stash data', () => {
  it('parses stash list lines with branch context and messages', () => {
    const output = [
      'stash@{0}\x1fabc123\x1f2026-04-28 09:00:00 -0400\x1fOn main: save docs',
      'stash@{1}\x1fdef456\x1f2026-04-27 18:00:00 -0400\x1fWIP on feature/log: 1234567 add tui',
    ].join('\n')

    expect(parseStashList(output)).toEqual([
      {
        ref: 'stash@{0}',
        hash: 'abc123',
        date: '2026-04-28 09:00:00 -0400',
        branch: 'main',
        message: 'save docs',
      },
      {
        ref: 'stash@{1}',
        hash: 'def456',
        date: '2026-04-27 18:00:00 -0400',
        branch: 'feature/log',
        message: '1234567 add tui',
      },
    ])
  })

  it('keeps unknown stash subjects readable', () => {
    expect(stashDataTestInternals.parseStashSubject('custom stash subject')).toEqual({
      branch: '<unknown>',
      message: 'custom stash subject',
    })
  })

  it('parses stash files and loads overview details', async () => {
    const git = {
      raw: jest.fn()
        .mockResolvedValueOnce('stash@{0}\x1fabc123\x1f2026-04-28 09:00:00 -0400\x1fOn main: save docs')
        .mockResolvedValueOnce('src/a.ts\nsrc/b.ts\n'),
    }

    await expect(getStashOverview(git as never)).resolves.toEqual({
      stashes: [
        {
          ref: 'stash@{0}',
          hash: 'abc123',
          date: '2026-04-28 09:00:00 -0400',
          branch: 'main',
          message: 'save docs',
          files: ['src/a.ts', 'src/b.ts'],
        },
      ],
    })
    expect(parseStashFiles('\n src/a.ts \n\n')).toEqual(['src/a.ts'])
  })

  it('loads stash diff summary lines', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(' src/a.ts | 2 +-\n 1 file changed\n'),
    }

    await expect(getStashDiffSummary(git as never, 'stash@{0}')).resolves.toEqual([
      ' src/a.ts | 2 +-',
      ' 1 file changed',
    ])
    expect(git.raw).toHaveBeenCalledWith(['stash', 'show', '--stat', 'stash@{0}'])
  })
})
