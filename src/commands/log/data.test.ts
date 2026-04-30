import { Arguments } from 'yargs'
import {
  FIELD_SEPARATOR,
  buildLogArgs,
  getCommitFilePreview,
  getCommitRows,
  getLogView,
  parseCommitDetail,
  parseLogOutput,
} from './data'
import { LogOptions } from './config'

function argv(overrides: Partial<LogOptions> = {}): Arguments<LogOptions> {
  return {
    $0: 'coco',
    _: ['log'],
    interactive: false,
    verbose: false,
    version: false,
    help: false,
    ...overrides,
  } as Arguments<LogOptions>
}

describe('log data layer', () => {
  it('defaults to a compact first-parent history view', () => {
    const args = buildLogArgs(argv())

    expect(getLogView(argv())).toBe('compact')
    expect(args).toEqual(expect.arrayContaining(['--first-parent', '--no-merges']))
    expect(args).not.toContain('--all')
  })

  it('uses full topology when all refs are requested', () => {
    const args = buildLogArgs(argv({ all: true, view: 'compact' }))

    expect(getLogView(argv({ all: true, view: 'compact' }))).toBe('full')
    expect(args).toContain('--all')
    expect(args).not.toContain('--first-parent')
    expect(args).not.toContain('--no-merges')
  })

  it('allows merge commits in compact view when requested', () => {
    const args = buildLogArgs(argv({ merges: true }))

    expect(args).toContain('--first-parent')
    expect(args).not.toContain('--no-merges')
  })

  it('preserves graph continuation rows while parsing commits', () => {
    const output = [
      `*${FIELD_SEPARATOR}abc1234${FIELD_SEPARATOR}abc1234${FIELD_SEPARATOR}2026-04-27${FIELD_SEPARATOR}Coco Test${FIELD_SEPARATOR}(HEAD -> main, tag: 1.0.0)${FIELD_SEPARATOR}feat: first`,
      '|\\',
      `| *${FIELD_SEPARATOR}def5678${FIELD_SEPARATOR}def5678${FIELD_SEPARATOR}2026-04-26${FIELD_SEPARATOR}Coco Test${FIELD_SEPARATOR}${FIELD_SEPARATOR}fix: second`,
      '|/',
    ].join('\n')

    const rows = parseLogOutput(output)

    expect(rows).toEqual([
      expect.objectContaining({
        type: 'commit',
        graph: '*',
        shortHash: 'abc1234',
        refs: ['HEAD -> main', 'tag: 1.0.0'],
      }),
      {
        type: 'graph',
        graph: '|\\',
      },
      expect.objectContaining({
        type: 'commit',
        graph: '| *',
        shortHash: 'def5678',
      }),
      {
        type: 'graph',
        graph: '|/',
      },
    ])
    expect(getCommitRows(rows)).toHaveLength(2)
  })

  it('parses commit detail metadata and changed files', () => {
    const detail = parseCommitDetail(
      [
        'abc1234',
        'abc1234',
        '2026-04-27',
        'Coco Test',
        '(tag: 1.0.0)',
        'feat: add details',
        'Detailed body',
      ].join(FIELD_SEPARATOR),
      ['A\tREADME.md', 'R100\told.ts\tnew.ts'].join('\n'),
      ['10\t2\tREADME.md', '3\t1\tnew.ts'].join('\n')
    )

    expect(detail).toEqual(expect.objectContaining({
      refs: ['tag: 1.0.0'],
      message: 'feat: add details',
      body: 'Detailed body',
      files: [
        {
          additions: 10,
          binary: false,
          deletions: 2,
          status: 'A',
          path: 'README.md',
        },
        {
          additions: 3,
          binary: false,
          deletions: 1,
          status: 'R100',
          oldPath: 'old.ts',
          path: 'new.ts',
        },
      ],
      stats: {
        deletions: 3,
        filesChanged: 2,
        insertions: 13,
      },
    }))
  })

  it('loads a bounded selected-file hunk preview', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue([
        'diff --git a/src/file.ts b/src/file.ts',
        '@@ -1,2 +1,2 @@',
        '-old line',
        '+new line',
        ' context',
      ].join('\n')),
    }

    const preview = await getCommitFilePreview(git as never, 'abc1234', {
      additions: 1,
      binary: false,
      deletions: 1,
      path: 'src/file.ts',
      status: 'M',
    })

    expect(git.raw).toHaveBeenCalledWith([
      'show',
      '--format=',
      '--find-renames',
      '--color=never',
      '--unified=3',
      'abc1234',
      '--',
      'src/file.ts',
    ])
    expect(preview).toEqual({
      hunks: ['@@ -1,2 +1,2 @@', '-old line', '+new line', ' context'],
      oldPath: undefined,
      path: 'src/file.ts',
      stats: {
        additions: 1,
        binary: false,
        deletions: 1,
      },
    })
  })
})
