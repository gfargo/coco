import { Arguments } from 'yargs'
import {
  FIELD_SEPARATOR,
  buildLogArgs,
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
      ['A\tREADME.md', 'R100\told.ts\tnew.ts'].join('\n')
    )

    expect(detail).toEqual(expect.objectContaining({
      refs: ['tag: 1.0.0'],
      message: 'feat: add details',
      body: 'Detailed body',
      files: [
        {
          status: 'A',
          path: 'README.md',
        },
        {
          status: 'R100',
          oldPath: 'old.ts',
          path: 'new.ts',
        },
      ],
    }))
  })
})
