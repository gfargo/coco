import { Arguments } from 'yargs'
import {
  FIELD_SEPARATOR,
  LOG_DEFAULT_LIMIT,
  LOG_INTERACTIVE_DEFAULT_LIMIT,
  buildLogArgs,
  buildToggleGraphArgs,
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
    expect(args).toContain(`--max-count=${LOG_DEFAULT_LIMIT}`)
  })

  it('uses a larger default history window for interactive mode', () => {
    const args = buildLogArgs(argv({ interactive: true }))

    expect(args).toContain(`--max-count=${LOG_INTERACTIVE_DEFAULT_LIMIT}`)
  })

  it('preserves an explicit limit in interactive mode', () => {
    const args = buildLogArgs(argv({ interactive: true, limit: 42 }))

    expect(args).toContain('--max-count=42')
  })

  it('supports incremental interactive history loading with skip and batch limit', () => {
    const args = buildLogArgs(argv({ interactive: true }), { limit: 50, skip: 300 })

    expect(args).toContain('--max-count=50')
    expect(args).toContain('--skip=300')
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

  describe('buildToggleGraphArgs', () => {
    it('switches to full topology when fullGraph is true', () => {
      const merged = buildToggleGraphArgs(argv({ view: 'compact' }), true)

      expect(merged.view).toBe('full')
      // The merged args, fed through buildLogArgs, must produce --all and
      // drop --first-parent so all branches' topology shows up.
      const args = buildLogArgs(merged)
      expect(args).toContain('--all')
      expect(args).not.toContain('--first-parent')
    })

    it('restores the original view when fullGraph is false', () => {
      const merged = buildToggleGraphArgs(argv({ view: 'compact' }), false)

      expect(merged.view).toBe('compact')
      const args = buildLogArgs(merged)
      expect(args).toContain('--first-parent')
      expect(args).not.toContain('--all')
    })

    it('defaults to compact when argv.view is undefined and fullGraph is false', () => {
      const merged = buildToggleGraphArgs(argv(), false)

      expect(merged.view).toBe('compact')
    })

    it('preserves unrelated argv fields (path, author, since, branch)', () => {
      const merged = buildToggleGraphArgs(
        argv({ view: 'compact', author: 'alice', path: 'src/', since: '2024-01-01', branch: 'main' }),
        true
      )

      expect(merged.author).toBe('alice')
      expect(merged.path).toBe('src/')
      expect(merged.since).toBe('2024-01-01')
      expect(merged.branch).toBe('main')
      expect(merged.view).toBe('full')
    })

    it('does not mutate the input argv', () => {
      const original = argv({ view: 'compact' })
      buildToggleGraphArgs(original, true)

      expect(original.view).toBe('compact')
    })
  })

  it('preserves graph continuation rows while parsing commits', () => {
    // First commit is a merge (two parent hashes); second is a regular
    // commit (single parent). Stage 3 of #791 uses the parent count to
    // pick a distinct merge glyph so the renderer can flag it visually.
    const output = [
      `*${FIELD_SEPARATOR}abc1234${FIELD_SEPARATOR}abc1234${FIELD_SEPARATOR}aaa1111 bbb2222${FIELD_SEPARATOR}2026-04-27${FIELD_SEPARATOR}Coco Test${FIELD_SEPARATOR}(HEAD -> main, tag: 1.0.0)${FIELD_SEPARATOR}feat: first`,
      '|\\',
      `| *${FIELD_SEPARATOR}def5678${FIELD_SEPARATOR}def5678${FIELD_SEPARATOR}ccc3333${FIELD_SEPARATOR}2026-04-26${FIELD_SEPARATOR}Coco Test${FIELD_SEPARATOR}${FIELD_SEPARATOR}fix: second`,
      '|/',
    ].join('\n')

    const rows = parseLogOutput(output)

    expect(rows).toEqual([
      expect.objectContaining({
        type: 'commit',
        graph: '*',
        shortHash: 'abc1234',
        parents: ['aaa1111', 'bbb2222'],
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
        parents: ['ccc3333'],
      }),
      {
        type: 'graph',
        graph: '|/',
      },
    ])
    expect(getCommitRows(rows)).toHaveLength(2)
  })

  it('parses an empty parents field as an empty list (root commit)', () => {
    // A root commit has no parents. `%P` returns an empty string in
    // that case; the parser must not produce `['']`.
    const output = `*${FIELD_SEPARATOR}aaa0000${FIELD_SEPARATOR}aaa000000000${FIELD_SEPARATOR}${FIELD_SEPARATOR}2026-04-25${FIELD_SEPARATOR}Coco Test${FIELD_SEPARATOR}${FIELD_SEPARATOR}initial commit`
    const [row] = parseLogOutput(output)

    expect(row.type).toBe('commit')
    if (row.type === 'commit') {
      expect(row.parents).toEqual([])
    }
  })

  it('threads %P into the log format so parents come back populated', () => {
    expect(buildLogArgs(argv())).toEqual(
      expect.arrayContaining([expect.stringContaining('%P')])
    )
  })

  it('parses commit detail metadata and changed files', () => {
    const detail = parseCommitDetail(
      [
        'abc1234',
        'abc1234',
        'parent1 parent2',
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
      parents: ['parent1', 'parent2'],
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
