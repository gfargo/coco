import { makeHookHarness } from '../../../test/builders/makeHookHarness'
import { createLogInkState, type LogInkState } from '../inkViewModel'
import { useYankActions, type UseYankActionsDeps } from './useYankActions'

// #2222. `y` / `Y` resolve what to copy from the active view, and a wrong
// target is the kind of bug that does not announce itself: the clipboard just
// holds the wrong thing. #2203 covered one way it went stale (a captured
// snapshot); these pin the other half, what each view yanks, in which form,
// and what it says when there is nothing to yank.
const row = (over: Record<string, unknown>) => over as never

const branches = [
  row({ type: 'local', name: 'alpha', shortName: 'alpha', hash: 'a1', current: false, date: '', subject: '', ahead: 0, behind: 0 }),
  row({ type: 'local', name: 'bravo', shortName: 'bravo', hash: 'b1', current: false, date: '', subject: '', ahead: 0, behind: 0 }),
]
const tags = [row({ name: 'v1.0.0', subject: 'first' }), row({ name: 'v2.0.0', subject: 'second' })]
const stashes = [
  row({ ref: 'stash@{0}', hash: 's0', message: 'wip auth', files: [] }),
  row({ ref: 'stash@{1}', hash: 's1', message: 'wip billing', files: [] }),
]
const commits = [
  row({ hash: 'a'.repeat(40), shortHash: 'aaaaaaa', message: 'first' }),
  row({ hash: 'b'.repeat(40), shortHash: 'bbbbbbb', message: 'second' }),
]

const context = {
  branches: { localBranches: branches, remoteBranches: [], dirty: false },
  tags: { tags: tags },
  stashes: { stashes },
  submodules: {
    hasSubmodules: true,
    entries: [
      row({ name: 'lib', path: 'vendor/lib', pinnedSha: '1234567890abcdef', flag: 'clean' }),
      row({ name: 'nopin', path: 'vendor/nopin', flag: 'clean' }),
    ],
  },
  remotes: {
    entries: [
      row({ name: 'origin', fetchUrl: 'https://user:ghp_secret@github.com/o/r.git' }),
      row({ name: 'bare' }),
    ],
  },
  issueList: { issues: [row({ number: 12, url: 'https://example.test/issues/12' })] },
  pullRequestList: { pullRequests: [row({ number: 34, url: 'https://example.test/pull/34' })] },
  bisect: {
    active: true,
    log: [{ kind: 'unknown', raw: '# first bad commit: [deadbeefcafebabe1234] feat: the culprit' }],
  },
} as never

const stateFor = (over: Partial<LogInkState>): LogInkState =>
  ({ ...createLogInkState([]), filteredCommits: commits, focus: 'commits', tagSort: 'name', branchSort: 'name', ...over }) as LogInkState

function yank(state: LogInkState, options: { short?: boolean; deps?: Partial<UseYankActionsDeps>; clipboard?: jest.Mock } = {}) {
  const clipboardRunner = options.clipboard ?? jest.fn().mockResolvedValue(undefined)
  const dispatch = jest.fn()
  const deps: UseYankActionsDeps = {
    clipboardRunner,
    dispatch,
    context,
    state,
    selected: undefined,
    selectedDetailFile: undefined,
    stashDiffLines: undefined,
    stashDiffParsedFiles: [],
    visibleWorktreeFilesGrouped: [],
    ...options.deps,
  }
  const result = makeHookHarness().render((React) => useYankActions(React, deps))
  return {
    run: async () => {
      await result.yankFromActiveView(options.short)
      const statuses = dispatch.mock.calls.map(([action]) => action).filter((action) => action.type === 'setStatus')
      return { copied: clipboardRunner.mock.calls.map(([value]) => value), status: statuses.at(-1) }
    },
    result,
    clipboardRunner,
    dispatch,
  }
}

describe('yankFromActiveView: what each view copies (#2222)', () => {
  it('copies the cursored commit: the full hash for y, the short hash for Y', async () => {
    const state = stateFor({ activeView: 'history', selectedIndex: 1 })
    expect(await yank(state).run()).toMatchObject({ copied: ['b'.repeat(40)], status: { value: 'Copied commit bbbbbbb', kind: 'success' } })
    expect(await yank(state, { short: true }).run()).toMatchObject({ copied: ['bbbbbbb'], status: { value: 'Copied short hash bbbbbbb' } })
  })

  it('copies the cursored branch, tag and stash ref', async () => {
    expect(await yank(stateFor({ activeView: 'branches', selectedBranchIndex: 1 })).run())
      .toMatchObject({ copied: ['bravo'], status: { value: 'Copied branch bravo' } })
    expect(await yank(stateFor({ activeView: 'tags', selectedTagIndex: 1 })).run())
      .toMatchObject({ copied: ['v2.0.0'], status: { value: 'Copied tag v2.0.0' } })
    expect(await yank(stateFor({ activeView: 'stash', selectedStashIndex: 1 })).run())
      .toMatchObject({ copied: ['stash@{1}'], status: { value: 'Copied stash stash@{1}' } })
  })

  it('copies from the filtered rows, so the cursor and the clipboard agree with the screen', async () => {
    // Only v2.0.0 matches, so index 0 is v2.0.0, not the first tag overall.
    expect((await yank(stateFor({ activeView: 'tags', filter: 'second', selectedTagIndex: 0 })).run()).copied).toEqual(['v2.0.0'])
    expect((await yank(stateFor({ activeView: 'stash', filter: 'billing', selectedStashIndex: 0 })).run()).copied).toEqual(['stash@{1}'])
  })

  it('copies the cursored status file from the mask-filtered list, nothing for a stale index', async () => {
    const files = [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] as never
    expect(await yank(stateFor({ activeView: 'status', selectedWorktreeFileIndex: 1 }), { deps: { visibleWorktreeFilesGrouped: files } }).run())
      .toMatchObject({ copied: ['src/b.ts'], status: { value: 'Copied path src/b.ts' } })
    expect(await yank(stateFor({ activeView: 'status', selectedWorktreeFileIndex: 5 }), { deps: { visibleWorktreeFilesGrouped: files } }).run())
      .toMatchObject({ copied: [], status: { value: 'Nothing to yank in this view', kind: 'warning' } })
  })

  describe('submodules', () => {
    it('copies the path for y and the short pinned sha for Y', async () => {
      const state = stateFor({ activeView: 'submodules', selectedSubmoduleIndex: 0 })
      expect(await yank(state).run()).toMatchObject({ copied: ['vendor/lib'], status: { value: 'Copied submodule path vendor/lib' } })
      expect(await yank(state, { short: true }).run()).toMatchObject({ copied: ['12345678'], status: { value: 'Copied short sha 12345678 (submodule lib)' } })
    })

    it('has no short form for a submodule with no pinned commit', async () => {
      const state = stateFor({ activeView: 'submodules', selectedSubmoduleIndex: 1 })
      expect(await yank(state, { short: true }).run()).toMatchObject({ copied: [], status: { value: 'Nothing to yank in this view' } })
    })
  })

  describe('remotes', () => {
    it('copies the fetch URL with its credentials masked, never the token', async () => {
      const { copied, status } = await yank(stateFor({ activeView: 'remotes', selectedRemoteIndex: 0 })).run()
      expect(copied).toEqual(['https://***@github.com/o/r.git'])
      expect(copied.join('')).not.toContain('ghp_secret')
      expect(status).toMatchObject({ value: 'Copied remote origin URL', kind: 'success' })
    })

    it('has nothing to copy for a remote with no fetch URL', async () => {
      expect(await yank(stateFor({ activeView: 'remotes', selectedRemoteIndex: 1 })).run())
        .toMatchObject({ copied: [], status: { value: 'Nothing to yank in this view' } })
    })
  })

  it('copies the URL of the cursored issue and pull request', async () => {
    expect(await yank(stateFor({ activeView: 'issues' })).run())
      .toMatchObject({ copied: ['https://example.test/issues/12'], status: { value: 'Copied issue #12 URL' } })
    expect(await yank(stateFor({ activeView: 'pull-request-triage' })).run())
      .toMatchObject({ copied: ['https://example.test/pull/34'], status: { value: 'Copied pull request #34 URL' } })
  })

  describe('bisect', () => {
    it('copies the first bad commit: full for y, eight characters for Y', async () => {
      const state = stateFor({ activeView: 'bisect' })
      expect((await yank(state).run()).copied).toEqual(['deadbeefcafebabe1234'])
      expect((await yank(state, { short: true }).run()).copied).toEqual(['deadbeef'])
    })

    it('has nothing to copy until a first bad commit is found, or when no bisect is active', async () => {
      const notDone = { ...(context as object), bisect: { active: true, log: [{ kind: 'unknown', raw: '# bad: [abc] x' }] } } as never
      expect((await yank(stateFor({ activeView: 'bisect' }), { deps: { context: notDone } }).run()).copied).toEqual([])
      const inactive = { ...(context as object), bisect: { active: false, log: [] } } as never
      expect((await yank(stateFor({ activeView: 'bisect' }), { deps: { context: inactive } }).run()).copied).toEqual([])
    })
  })

  describe('diff', () => {
    it('copies the cursored worktree file', async () => {
      const files = [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] as never
      const state = stateFor({ activeView: 'diff', diffSource: 'worktree', selectedWorktreeFileIndex: 1 })
      expect((await yank(state, { deps: { visibleWorktreeFilesGrouped: files } }).run()).copied).toEqual(['src/b.ts'])
    })

    it('copies the stash file the preview offset is inside, and nothing without the patch loaded', async () => {
      const parsed = [{ path: 'a.ts', startLine: 0 }, { path: 'b.ts', startLine: 10 }]
      // `null` is "not loaded" (an `undefined` argument would take the default).
      const at = (offset: number, lines: string[] | null = ['x']) =>
        yank(stateFor({ activeView: 'diff', diffSource: 'stash', diffPreviewOffset: offset }), { deps: { stashDiffLines: lines ?? undefined, stashDiffParsedFiles: parsed } }).run()
      expect((await at(4)).copied).toEqual(['a.ts'])
      expect((await at(10)).copied).toEqual(['b.ts'])
      expect((await at(99)).copied).toEqual(['b.ts'])
      // Without the patch loaded there is no stash target at all.
      expect((await at(4, null)).copied).toEqual([])
    })

    describe('commit diff', () => {
      const selected = { hash: 'c'.repeat(40), shortHash: 'ccccccc' } as never
      const base = stateFor({ activeView: 'diff', diffSource: 'commit' })

      it('copies the cursored file for y and the commit for Y', async () => {
        const deps = { selected, selectedDetailFile: { path: 'src/a.ts' } as never }
        expect(await yank(base, { deps }).run()).toMatchObject({ copied: ['src/a.ts'], status: { value: 'Copied path src/a.ts' } })
        expect(await yank(base, { deps, short: true }).run()).toMatchObject({ copied: ['c'.repeat(40)], status: { value: 'Copied commit ccccccc' } })
      })

      it('falls back to the commit when no file is cursored', async () => {
        expect((await yank(base, { deps: { selected } }).run()).copied).toEqual(['c'.repeat(40)])
      })

      it('has nothing without a commit or a file', async () => {
        expect((await yank(base).run()).copied).toEqual([])
      })
    })
  })

  describe('the sidebar', () => {
    it('copies the cursored sidebar entity, not the view behind it (#1388)', async () => {
      const behind = { activeView: 'history', focus: 'sidebar', selectedIndex: 0 } as const
      expect((await yank(stateFor({ ...behind, sidebarTab: 'branches', selectedBranchIndex: 1 })).run()).copied).toEqual(['bravo'])
      expect((await yank(stateFor({ ...behind, sidebarTab: 'tags', selectedTagIndex: 0 })).run()).copied).toEqual(['v1.0.0'])
      expect((await yank(stateFor({ ...behind, sidebarTab: 'stashes', selectedStashIndex: 1 })).run()).copied).toEqual(['stash@{1}'])
    })

    it('falls back to the view behind it for a tab that has no yank target', async () => {
      const state = stateFor({ activeView: 'history', focus: 'sidebar', sidebarTab: 'status', selectedIndex: 0 })
      expect((await yank(state).run()).copied).toEqual(['a'.repeat(40)])
    })

    it('ignores the sidebar tab once focus is back on the main pane', async () => {
      const state = stateFor({ activeView: 'history', focus: 'commits', sidebarTab: 'branches', selectedIndex: 1 })
      expect((await yank(state).run()).copied).toEqual(['b'.repeat(40)])
    })
  })

  it('says so, and copies nothing, in a view with no yank target', async () => {
    const { copied, status } = await yank(stateFor({ activeView: 'pull-request' })).run()
    expect(copied).toEqual([])
    expect(status).toEqual({ type: 'setStatus', value: 'Nothing to yank in this view', kind: 'warning' })
  })

  it('says so for an empty list', async () => {
    const empty = { ...(context as object), branches: { localBranches: [], remoteBranches: [], dirty: false } } as never
    expect((await yank(stateFor({ activeView: 'branches' }), { deps: { context: empty } }).run()).status)
      .toMatchObject({ value: 'Nothing to yank in this view', kind: 'warning' })
  })

  it('reports a clipboard failure as an error and does not claim it copied', async () => {
    const clipboard = jest.fn().mockRejectedValue(new Error('pbcopy not found'))
    const { status } = await yank(stateFor({ activeView: 'branches' }), { clipboard }).run()
    expect(status).toEqual({ type: 'setStatus', value: 'Copy failed: pbcopy not found', kind: 'error' })
  })
})

describe('yankText (#2222)', () => {
  const make = (clipboard: jest.Mock = jest.fn().mockResolvedValue(undefined)) => {
    const harness = yank(stateFor({ activeView: 'history' }), { clipboard })
    const last = () => harness.dispatch.mock.calls.at(-1)?.[0]
    return { ...harness, last }
  }

  it('copies the text it is given and confirms what landed', async () => {
    const { result, clipboardRunner, last } = make()
    await result.yankText('release notes body', 'the changelog')
    expect(clipboardRunner).toHaveBeenCalledWith('release notes body')
    expect(last()).toEqual({ type: 'setStatus', value: 'Copied the changelog to clipboard.', kind: 'success' })
  })

  it('warns, and does not touch the clipboard, for an empty value', async () => {
    const { result, clipboardRunner, last } = make()
    await result.yankText('', 'the changelog')
    expect(clipboardRunner).not.toHaveBeenCalled()
    expect(last()).toEqual({ type: 'setStatus', value: 'Nothing to copy — the changelog is empty.', kind: 'warning' })
  })

  it('names what failed to copy', async () => {
    const { result, last } = make(jest.fn().mockRejectedValue(new Error('no display')))
    await result.yankText('text', 'the changelog')
    expect(last()).toEqual({ type: 'setStatus', value: 'Copy failed (the changelog): no display', kind: 'error' })
  })
})
