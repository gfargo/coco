import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { simpleGit } from 'simple-git'
import { Arguments } from 'yargs'
import {
    COMMIT_CONTEXT_DEFAULT_LIMIT,
    FIELD_SEPARATOR,
    LOG_DEFAULT_LIMIT,
    LOG_INTERACTIVE_DEFAULT_LIMIT,
    buildLogArgs,
    buildToggleGraphArgs,
    getCommitFilePreview,
    getCommitRows,
    getLogRows,
    getLogRowsAnchoredOn,
    getLogView,
    parseCommitDetail,
    parseLogOutput,
} from './data'
import { LogOptions } from './config'

// Several tests here spin up a real temp git repo (mkdtemp + git init +
// many commits) and shell out to walk the log. The default 5s budget is
// too tight for that I/O once the full suite runs all workers in parallel
// (e.g. during `npm run release`), producing flaky timeouts that aren't
// real failures. Give the whole file a generous budget instead.
jest.setTimeout(30_000)

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

  it('uses full topology when all refs are requested with no explicit --view', () => {
    const args = buildLogArgs(argv({ all: true }))

    expect(getLogView(argv({ all: true }))).toBe('full')
    expect(args).toContain('--all')
    expect(args).not.toContain('--first-parent')
    expect(args).not.toContain('--no-merges')
  })

  // Regression (#1622): --all used to win unconditionally, silently
  // discarding an explicit --view compact. An explicit --view must now
  // take precedence — --all still walks every ref (buildLogArgs checks
  // argv.all independently of the resolved view), but the compact
  // first-parent/no-merges presentation is honored instead of full.
  it('honors an explicit --view compact over --all (#1622)', () => {
    const args = buildLogArgs(argv({ all: true, view: 'compact' }))

    expect(getLogView(argv({ all: true, view: 'compact' }))).toBe('compact')
    expect(args).toContain('--all')
    expect(args).toContain('--first-parent')
    expect(args).toContain('--no-merges')
  })

  it('an explicit --view graph also wins over --all', () => {
    expect(getLogView(argv({ all: true, view: 'graph' }))).toBe('graph')
  })

  it('allows merge commits in compact view when requested', () => {
    const args = buildLogArgs(argv({ merges: true }))

    expect(args).toContain('--first-parent')
    expect(args).not.toContain('--no-merges')
  })

  it('appends extraRefs as positional graph roots after --all', () => {
    // Workstation includes stash commit hashes here so they appear as
    // graph nodes even though `git log --all` only walks `refs/stash`
    // (the latest stash) by default. Each hash becomes an additional
    // root the traversal starts from.
    const args = buildLogArgs(argv({ all: true }), {
      extraRefs: ['abc1234', 'def5678'],
    })

    expect(args).toContain('--all')
    expect(args).toContain('abc1234')
    expect(args).toContain('def5678')
    // Ordering matters: extraRefs come after --all so git parses them
    // as positional refs, not as flag args.
    const allIdx = args.indexOf('--all')
    const refIdx = args.indexOf('abc1234')
    expect(refIdx).toBeGreaterThan(allIdx)
  })

  it('appends extraRefs before the -- path separator', () => {
    // When a path filter is set, extraRefs must land BEFORE the `--`
    // separator so git treats them as refs rather than paths.
    const args = buildLogArgs(argv({ all: true, path: ['src'] }), {
      extraRefs: ['abc1234'],
    })

    const refIdx = args.indexOf('abc1234')
    const sepIdx = args.indexOf('--')
    expect(refIdx).toBeGreaterThan(-1)
    expect(sepIdx).toBeGreaterThan(refIdx)
  })

  it('omits extraRefs when the array is empty', () => {
    // Repos with no stashes pass an empty array; we shouldn't emit
    // anything that would confuse git or change the argument shape.
    const args = buildLogArgs(argv({ all: true }), { extraRefs: [] })

    expect(args).toContain('--all')
    // No extra positional refs landed in the args list.
    const positionalRefs = args.filter((arg) =>
      !arg.startsWith('--') && !arg.startsWith('-') && arg !== 'log'
    )
    expect(positionalRefs.filter((arg) => /^[a-f0-9]+$/i.test(arg))).toEqual([])
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

  it('passes -S<token> for pickaxe search', () => {
    const args = buildLogArgs(argv({ pickaxe: 'useState' }))
    expect(args).toContain('-SuseState')
  })

  it('passes -G<regex> for grep-diff search', () => {
    const args = buildLogArgs(argv({ grep: 'TODO|FIXME' }))
    expect(args).toContain('-GTODO|FIXME')
  })

  // Regression (#1618): --grep runs git's diff-content search (-G), not
  // commit-message search — the behavior every git user's --grep muscle
  // memory expects. --message is the actual message-search flag, mapping
  // to git's own --grep=.
  it('passes --grep=<regex> for --message (commit-message search)', () => {
    const args = buildLogArgs(argv({ message: 'fix login' }))
    expect(args).toContain('--grep=fix login')
    expect(args).not.toContain('-Gfix login')
  })

  it('--message and --grep compose independently (message search vs. diff-content search)', () => {
    const args = buildLogArgs(argv({ message: 'fix login', grep: 'TODO' }))
    expect(args).toContain('--grep=fix login')
    expect(args).toContain('-GTODO')
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
      submoduleChange: undefined,
    })
  })

  it('surfaces the structured submoduleChange for a modified-submodule file (#931)', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue([
        '-Subproject commit 11111111',
        '+Subproject commit 22222222',
      ].join('\n')),
    }

    const preview = await getCommitFilePreview(git as never, 'abc1234', {
      additions: 1,
      binary: false,
      deletions: 1,
      path: 'vendor/lib',
      status: 'M',
    })

    expect(preview.submoduleChange).toEqual({
      kind: 'modified',
      before: '11111111',
      after: '22222222',
    })
    // The summarized hunks are unchanged from before — the structured
    // field is purely additive.
    expect(preview.hunks).toHaveLength(1)
    expect(preview.hunks[0]).toMatch(/^submodule modified:/)
  })

  it('omits submoduleChange for non-submodule files', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue([
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new',
      ].join('\n')),
    }
    const preview = await getCommitFilePreview(git as never, 'abc1234', {
      additions: 1,
      binary: false,
      deletions: 1,
      path: 'src/index.ts',
      status: 'M',
    })
    expect(preview.submoduleChange).toBeUndefined()
  })

  it('surfaces submoduleChange for added (no -line) and removed (no +line) submodules', async () => {
    const addedGit = {
      raw: jest.fn().mockResolvedValue('+Subproject commit aaaaaaaa'),
    }
    const removedGit = {
      raw: jest.fn().mockResolvedValue('-Subproject commit bbbbbbbb'),
    }

    const added = await getCommitFilePreview(addedGit as never, 'abc1234', {
      additions: 1, binary: false, deletions: 0, path: 'vendor/new', status: 'A',
    })
    expect(added.submoduleChange).toEqual({
      kind: 'added',
      after: 'aaaaaaaa',
    })

    const removed = await getCommitFilePreview(removedGit as never, 'abc1234', {
      additions: 0, binary: false, deletions: 1, path: 'vendor/gone', status: 'D',
    })
    expect(removed.submoduleChange).toEqual({
      kind: 'removed',
      before: 'bbbbbbbb',
    })
  })

  describe('getLogRows empty-repo handling', () => {
    it('returns [] on a freshly-initialized repo with no commits', async () => {
      const path = await mkdtemp(join(tmpdir(), 'coco-log-empty-test-'))
      try {
        const git = simpleGit(path)
        await git.init()
        await git.addConfig('user.name', 'Coco Test')
        await git.addConfig('user.email', 'coco@example.com')
        await git.raw(['checkout', '-b', 'main'])

        // Without the isEmptyRepo short-circuit this would throw with
        // "your current branch 'main' does not have any commits yet".
        const rows = await getLogRows(git, argv())
        expect(rows).toEqual([])
      } finally {
        await rm(path, { recursive: true, force: true })
      }
    })

    it('returns commit rows on a repo with commits', async () => {
      const path = await mkdtemp(join(tmpdir(), 'coco-log-onecommit-test-'))
      try {
        const git = simpleGit(path)
        await git.init()
        await git.addConfig('user.name', 'Coco Test')
        await git.addConfig('user.email', 'coco@example.com')
        await git.addConfig('commit.gpgsign', 'false')
        await git.raw(['checkout', '-b', 'main'])
        await writeFile(join(path, 'README.md'), '# repo\n')
        await git.add('README.md')
        await git.commit('chore: initial')

        const rows = await getLogRows(git, argv())
        expect(rows.length).toBeGreaterThan(0)
        const commitRows = getCommitRows(rows)
        expect(commitRows[0]?.message).toBe('chore: initial')
      } finally {
        await rm(path, { recursive: true, force: true })
      }
    })
  })

  describe('getLogRowsAnchoredOn', () => {
    // Walks only from the target — NOT from --all + target — so the
    // target is guaranteed to be in the output regardless of date
    // ordering. The bug this avoids: with --all in the mix, git
    // unions the walks and the max-count cap can slice an old
    // target off the bottom of a busy date-sorted result.

    it('walks only from the target ref, ignoring --all from the input argv', async () => {
      const path = await mkdtemp(join(tmpdir(), 'coco-anchored-test-'))
      try {
        const git = simpleGit(path)
        await git.init()
        await git.addConfig('user.name', 'Coco Test')
        await git.addConfig('user.email', 'coco@example.com')
        await git.addConfig('commit.gpgsign', 'false')
        await git.raw(['checkout', '-b', 'main'])

        await writeFile(join(path, 'a.md'), 'a\n')
        await git.add('a.md')
        await git.commit('chore: A')
        const aRev = (await git.revparse(['HEAD'])).trim()

        await writeFile(join(path, 'b.md'), 'b\n')
        await git.add('b.md')
        await git.commit('chore: B')

        // Branch off A and add a divergent commit C that only that
        // branch can reach. C should NOT appear when we anchor on A.
        await git.raw(['checkout', '-b', 'side', aRev])
        await writeFile(join(path, 'c.md'), 'c\n')
        await git.add('c.md')
        await git.commit('chore: C-on-side')
        await git.raw(['checkout', 'main'])

        // Anchor on commit A. Should return A and A's ancestors only —
        // not B (newer on main), not C (on side branch).
        const argvBase = argv({ all: true })  // even with --all set, the helper strips it
        const anchoredRows = await getLogRowsAnchoredOn(git, argvBase, aRev, { limit: 100 })

        const subjects = getCommitRows(anchoredRows).map((r) => r.message)
        expect(subjects).toEqual(['chore: A'])
      } finally {
        await rm(path, { recursive: true, force: true })
      }
    })

    it('uses COMMIT_CONTEXT_DEFAULT_LIMIT as the cap when no limit option is supplied', async () => {
      // Sanity: the default limit constant is exported and the
      // helper falls back to it. Important because the limit also
      // shapes how much surrounding context the user gets when the
      // cursor lands; lowering it accidentally would reduce that.
      expect(COMMIT_CONTEXT_DEFAULT_LIMIT).toBeGreaterThanOrEqual(1000)
      expect(typeof COMMIT_CONTEXT_DEFAULT_LIMIT).toBe('number')
    })
  })
})
