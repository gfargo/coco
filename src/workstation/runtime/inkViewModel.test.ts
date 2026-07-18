import { GitLogRow, getCommitRows } from '../../git/logData'
import {
    DEFAULT_LOG_INK_STATUS_FILTER_MASK,
    applyLogInkAction,
    createLogInkState,
    getActiveLogInkRepoFrame,
    getLogInkRepoStackLabels,
    getLogInkSidebarTabs,
    getSelectedInkCommit,
    hunkIndexAtOffset,
    intentGoHome,
    intentOpenComposeForFile,
    intentOpenDiffForCommit,
    intentOpenDiffForWorktreeFile,
    isLogInkNestedRepo,
    parseLogInkHistoryFetchPrefix,
    scoreLogInkCommitFilter,
} from './inkViewModel'

const rows: GitLogRow[] = [
  {
    type: 'commit',
    graph: '*',
    shortHash: 'abc1234',
    hash: 'abc123456789',
    parents: ['def567890123'],
    date: '2026-04-27',
    author: 'Coco Test',
    refs: ['HEAD -> main', 'tag: 0.33.0'],
    message: 'feat: add interactive log',
  },
  {
    type: 'commit',
    graph: '*',
    shortHash: 'def5678',
    hash: 'def567890123',
    parents: ['fed999900000'],
    date: '2026-04-28',
    author: 'Griffen Fargo',
    refs: ['feature/ink'],
    message: 'fix: polish detail panel',
  },
  {
    type: 'commit',
    graph: '*',
    shortHash: 'fed9999',
    hash: 'fed999900000',
    parents: [],
    date: '2026-04-29',
    author: 'Feature Author',
    refs: ['feature/polish'],
    message: 'feat: polish commit browser',
  },
]

describe('log Ink view model', () => {
  it('creates a calm browsing state from parsed rows', () => {
    const state = createLogInkState(rows)

    expect(state.commits).toHaveLength(3)
    expect(state.activeView).toBe('history')
    expect(state.filteredCommits).toHaveLength(3)
    expect(state.selectedFileIndex).toBe(0)
    expect(state.selectedWorktreeFileIndex).toBe(0)
    expect(state.diffPreviewOffset).toBe(0)
    expect(state.worktreeDiffOffset).toBe(0)
    expect(state.commitCompose.summary).toBe('')
    expect(state.focus).toBe('commits')
    expect(state.sidebarTab).toBe('branches')
    expect(state.showHelp).toBe(false)
    expect(state.showCommandPalette).toBe(false)
    expect(state.pendingConfirmationId).toBeUndefined()
  })

  it('opens, moves, and closes the gitignore picker', () => {
    let state = createLogInkState(rows, { activeView: 'status' })
    expect(state.gitignorePicker).toBeUndefined()

    state = applyLogInkAction(state, { type: 'openGitignorePicker', file: '.www/' })
    expect(state.gitignorePicker).toEqual({ file: '.www/', index: 0 })

    // Move down within a 3-option list (anchored, bare, custom).
    state = applyLogInkAction(state, { type: 'moveGitignorePicker', delta: 1, count: 3 })
    expect(state.gitignorePicker?.index).toBe(1)

    // Clamps at the bottom bound.
    state = applyLogInkAction(state, { type: 'moveGitignorePicker', delta: 5, count: 3 })
    expect(state.gitignorePicker?.index).toBe(2)

    // Clamps at the top bound.
    state = applyLogInkAction(state, { type: 'moveGitignorePicker', delta: -10, count: 3 })
    expect(state.gitignorePicker?.index).toBe(0)

    state = applyLogInkAction(state, { type: 'closeGitignorePicker' })
    expect(state.gitignorePicker).toBeUndefined()
  })

  it('supports workstation surface selection', () => {
    let state = createLogInkState(rows, { activeView: 'status' })

    expect(state.activeView).toBe('status')

    state = applyLogInkAction(state, { type: 'setActiveView', value: 'diff' })

    expect(state.activeView).toBe('diff')
  })

  describe('returnFromCommit navigation', () => {
    it('returns to status when the tree is still dirty after committing from status', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'status' })
      state = applyLogInkAction(state, { type: 'pushView', value: 'compose' })

      state = applyLogInkAction(state, { type: 'returnFromCommit', stillDirty: true })

      expect(state.activeView).toBe('status')
      expect(state.viewStack).toEqual(['history', 'status'])
    })

    it('returns to history when the tree is clean even if it came from status', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'status' })
      state = applyLogInkAction(state, { type: 'pushView', value: 'compose' })

      state = applyLogInkAction(state, { type: 'returnFromCommit', stillDirty: false })

      expect(state.activeView).toBe('history')
      expect(state.viewStack).toEqual(['history'])
    })

    it('returns to history when composing straight from history', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'compose' })

      // Dirty, but there is no status frame to return to.
      state = applyLogInkAction(state, { type: 'returnFromCommit', stillDirty: true })

      expect(state.activeView).toBe('history')
      expect(state.viewStack).toEqual(['history'])
    })

    it('unwinds an intermediate diff frame back to status when still dirty', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'status' })
      state = applyLogInkAction(state, { type: 'pushView', value: 'diff' })
      state = applyLogInkAction(state, { type: 'pushView', value: 'compose' })

      state = applyLogInkAction(state, { type: 'returnFromCommit', stillDirty: true })

      expect(state.activeView).toBe('status')
      expect(state.viewStack).toEqual(['history', 'status'])
    })
  })

  it('moves selected commits and clamps at list bounds', () => {
    let state = createLogInkState(rows)

    state = applyLogInkAction(state, { type: 'move', delta: 1 })
    expect(getSelectedInkCommit(state)?.shortHash).toBe('def5678')

    state = applyLogInkAction(state, { type: 'move', delta: 10 })
    expect(getSelectedInkCommit(state)?.shortHash).toBe('fed9999')

    state = applyLogInkAction(state, { type: 'move', delta: -10 })
    expect(getSelectedInkCommit(state)?.shortHash).toBe('abc1234')
  })

  it('filters by message, author, hash, and refs', () => {
    let state = createLogInkState(rows)

    state = applyLogInkAction(state, { type: 'setFilter', value: 'polish' })
    expect(state.filteredCommits.map((commit) => commit.shortHash)).toEqual(['def5678', 'fed9999'])

    state = applyLogInkAction(state, { type: 'setFilter', value: 'coco test' })
    expect(state.filteredCommits.map((commit) => commit.shortHash)).toEqual(['abc1234'])

    state = applyLogInkAction(state, { type: 'setFilter', value: '0.33.0' })
    expect(state.filteredCommits.map((commit) => commit.shortHash)).toEqual(['abc1234'])

    state = applyLogInkAction(state, { type: 'setFilter', value: 'def567890' })
    expect(state.filteredCommits.map((commit) => commit.shortHash)).toEqual(['def5678'])
  })

  it('uses fuzzy ranking when filtering commits', () => {
    const state = applyLogInkAction(createLogInkState(rows), { type: 'setFilter', value: 'pcb' })

    expect(state.filteredCommits.map((commit) => commit.shortHash)).toEqual(['fed9999'])
    expect(scoreLogInkCommitFilter(rows[2] as typeof rows[number] & { type: 'commit' }, 'commit browser')).toBeDefined()
    expect(scoreLogInkCommitFilter(rows[1] as typeof rows[number] & { type: 'commit' }, 'commit browser')).toBeUndefined()
  })

  it('edits search text through append, backspace, and clear actions', () => {
    let state = createLogInkState(rows)

    state = applyLogInkAction(state, { type: 'appendFilter', value: 'f' })
    state = applyLogInkAction(state, { type: 'appendFilter', value: 'e' })
    state = applyLogInkAction(state, { type: 'appendFilter', value: 'a' })
    expect(state.filter).toBe('fea')

    state = applyLogInkAction(state, { type: 'backspaceFilter' })
    expect(state.filter).toBe('fe')

    state = applyLogInkAction(state, { type: 'toggleFilterMode' })
    state = applyLogInkAction(state, { type: 'clearFilter' })
    expect(state.filter).toBe('')
    expect(state.filterMode).toBe(false)
  })

  it('cycles focus and sidebar tabs predictably', () => {
    let state = createLogInkState(rows)

    state = applyLogInkAction(state, { type: 'focusNext' })
    expect(state.focus).toBe('detail')

    state = applyLogInkAction(state, { type: 'focusNext' })
    expect(state.focus).toBe('sidebar')

    state = applyLogInkAction(state, { type: 'focusPrevious' })
    expect(state.focus).toBe('detail')

    expect(getLogInkSidebarTabs()).toEqual(['status', 'branches', 'tags', 'stashes', 'worktrees'])

    // Default sidebar tab is 'branches' — moving next from there lands
    // on 'tags', moving previous returns to 'branches'.
    state = applyLogInkAction(state, { type: 'nextSidebarTab' })
    expect(state.sidebarTab).toBe('tags')

    state = applyLogInkAction(state, { type: 'previousSidebarTab' })
    expect(state.sidebarTab).toBe('branches')

    state = applyLogInkAction(state, { type: 'setSidebarTab', value: 'worktrees' })
    expect(state.sidebarTab).toBe('worktrees')
    expect(state.focus).toBe('sidebar')
  })

  it('jumps to list boundaries', () => {
    let state = createLogInkState(rows)

    state = applyLogInkAction(state, { type: 'moveToBottom' })
    expect(getSelectedInkCommit(state)?.shortHash).toBe('fed9999')

    state = applyLogInkAction(state, { type: 'moveToTop' })
    expect(getSelectedInkCommit(state)?.shortHash).toBe('abc1234')
  })

  it('focusPendingCommit selects the synthetic row; getSelectedInkCommit returns undefined', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'focusPendingCommit' })

    expect(state.pendingCommitFocused).toBe(true)
    expect(state.selectedIndex).toBe(0)
    expect(getSelectedInkCommit(state)).toBeUndefined()

    state = applyLogInkAction(state, { type: 'unfocusPendingCommit' })
    expect(state.pendingCommitFocused).toBe(false)
    expect(getSelectedInkCommit(state)?.shortHash).toBe('abc1234')
  })

  it('clears the pending-commit focus when navigating away from history', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'focusPendingCommit' })
    expect(state.pendingCommitFocused).toBe(true)

    state = applyLogInkAction(state, { type: 'pushView', value: 'status' })
    expect(state.activeView).toBe('status')
    expect(state.pendingCommitFocused).toBe(false)
  })

  it('clears the pending-commit focus on moveToTop / moveToBottom / navigateHome', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'focusPendingCommit' })
    state = applyLogInkAction(state, { type: 'moveToBottom' })
    expect(state.pendingCommitFocused).toBe(false)

    state = applyLogInkAction(state, { type: 'focusPendingCommit' })
    state = applyLogInkAction(state, { type: 'moveToTop' })
    expect(state.pendingCommitFocused).toBe(false)

    state = applyLogInkAction(state, { type: 'focusPendingCommit' })
    state = applyLogInkAction(state, { type: 'pushView', value: 'compose' })
    state = applyLogInkAction(state, { type: 'navigateHome' })
    expect(state.pendingCommitFocused).toBe(false)
  })

  it('appends older rows while preserving the selected commit', () => {
    let state = createLogInkState(rows)

    state = applyLogInkAction(state, { type: 'move', delta: 1 })
    state = applyLogInkAction(state, {
      type: 'appendRows',
      rows: [
        {
          type: 'commit',
          graph: '*',
          shortHash: '9999999',
          hash: '999999900000',
          parents: [],
          date: '2026-04-25',
          author: 'Coco Test',
          refs: [],
          message: 'chore: older commit',
        },
      ],
    })

    expect(state.commits).toHaveLength(4)
    expect(getSelectedInkCommit(state)?.shortHash).toBe('def5678')
  })

  it('dedups overlapping appended rows so the history graph cannot loop', () => {
    let state = createLogInkState(rows)

    // Simulate the anchored `loadCommitContext` page: it re-walks
    // history from the tip, so its rows OVERLAP everything already
    // loaded (plus one new older commit on the end). Before the fix
    // these duplicates accumulated in `state.rows` — which the graph
    // renderer windows over — stacking the newest commit directly
    // below the oldest and letting the cursor scroll forever.
    state = applyLogInkAction(state, {
      type: 'appendRows',
      rows: [
        ...rows,
        {
          type: 'commit',
          graph: '*',
          shortHash: '9999999',
          hash: '999999900000',
          parents: [],
          date: '2026-04-25',
          author: 'Coco Test',
          refs: [],
          message: 'chore: older commit',
        },
      ],
    })

    // The rows the graph renders over carry no duplicate commit hashes.
    const commitHashes = getCommitRows(state.rows).map((row) => row.hash)
    expect(new Set(commitHashes).size).toBe(commitHashes.length)
    // Three originals + the one genuinely-new older commit.
    expect(state.commits).toHaveLength(4)
    expect(commitHashes).toHaveLength(4)
  })

  it('advances the main-ordering pagination offset only for load-more pages (#1337)', () => {
    const olderCommit = (hash: string): (typeof rows)[number] => ({
      type: 'commit',
      graph: '*',
      shortHash: hash.slice(0, 7),
      hash,
      parents: [],
      date: '2026-04-25',
      author: 'Coco Test',
      refs: [],
      message: `chore: ${hash.slice(0, 7)}`,
    })

    let state = createLogInkState(rows)
    expect(state.mainHistoryCommitCount).toBe(3)

    // Anchored context load: rows merged from getLogRowsAnchoredOn are
    // NOT a prefix of the main ordering — the offset must not move,
    // even though commits.length grows.
    state = applyLogInkAction(state, {
      type: 'appendRows',
      rows: [olderCommit('aaaaaaa0000001')],
    })
    expect(state.commits).toHaveLength(4)
    expect(state.mainHistoryCommitCount).toBe(3)

    // Load-more page: advances by the FETCHED count (pre-dedup), not
    // the post-dedup delta — one of the two rows below is the anchored
    // commit already merged above, but git's skip offset still counts
    // it.
    state = applyLogInkAction(state, {
      type: 'appendRows',
      rows: [olderCommit('aaaaaaa0000001'), olderCommit('bbbbbbb0000002')],
      mainOrderingCount: 2,
    })
    expect(state.commits).toHaveLength(5)
    expect(state.mainHistoryCommitCount).toBe(5)

    // A wholesale replacement resets the offset to the fresh window.
    state = applyLogInkAction(state, { type: 'replaceRows', rows })
    expect(state.mainHistoryCommitCount).toBe(3)
  })

  it('tracks selected changed files and diff preview paging', () => {
    let state = createLogInkState(rows)

    state = applyLogInkAction(state, { type: 'moveDetailFile', delta: 2, fileCount: 3 })
    expect(state.selectedFileIndex).toBe(2)

    state = applyLogInkAction(state, { type: 'moveDetailFile', delta: 1, fileCount: 3 })
    expect(state.selectedFileIndex).toBe(2)

    state = applyLogInkAction(state, { type: 'pageDetailPreview', delta: 10, previewLineCount: 20 })
    expect(state.diffPreviewOffset).toBe(10)

    state = applyLogInkAction(state, { type: 'move', delta: 1 })
    expect(state.selectedFileIndex).toBe(0)
    expect(state.diffPreviewOffset).toBe(0)
  })

  it('tracks worktree file selection and diff paging', () => {
    let state = createLogInkState(rows, { activeView: 'status' })

    state = applyLogInkAction(state, { type: 'moveWorktreeFile', delta: 2, fileCount: 4 })
    expect(state.selectedWorktreeFileIndex).toBe(2)
    expect(state.activeView).toBe('status')

    state = applyLogInkAction(state, { type: 'setActiveView', value: 'diff' })
    state = applyLogInkAction(state, { type: 'pageWorktreeDiff', delta: 8, lineCount: 20 })
    expect(state.worktreeDiffOffset).toBe(8)

    state = applyLogInkAction(state, {
      type: 'jumpWorktreeHunk',
      delta: 1,
      hunkOffsets: [3, 12],
    })
    expect(state.worktreeDiffOffset).toBe(12)
    expect(hunkIndexAtOffset(state.worktreeDiffOffset, [3, 12])).toBe(1)

    state = applyLogInkAction(state, { type: 'setActiveView', value: 'status' })
    expect(state.worktreeDiffOffset).toBe(0)
    expect(hunkIndexAtOffset(state.worktreeDiffOffset, [3, 12])).toBe(0)
  })

  it('jumps commit-diff hunks symmetrically and stays put past the last hunk', () => {
    let state = createLogInkState(rows, { activeView: 'diff' })

    state = applyLogInkAction(state, {
      type: 'jumpCommitDiffHunk',
      delta: 1,
      hunkOffsets: [3, 12, 25],
    })
    expect(state.diffPreviewOffset).toBe(3)

    state = applyLogInkAction(state, {
      type: 'jumpCommitDiffHunk',
      delta: 1,
      hunkOffsets: [3, 12, 25],
    })
    expect(state.diffPreviewOffset).toBe(12)

    state = applyLogInkAction(state, {
      type: 'jumpCommitDiffHunk',
      delta: -1,
      hunkOffsets: [3, 12, 25],
    })
    expect(state.diffPreviewOffset).toBe(3)
  })

  it('keeps diffPreviewOffset put when jumping past either edge', () => {
    let state = createLogInkState(rows, { activeView: 'diff' })

    // From offset 0 (before first hunk), pressing k must not jump forward
    state = applyLogInkAction(state, {
      type: 'jumpCommitDiffHunk',
      delta: -1,
      hunkOffsets: [5, 10],
    })
    expect(state.diffPreviewOffset).toBe(0)

    // After advancing to the last hunk, pressing j again must stay put
    state = applyLogInkAction(state, {
      type: 'jumpCommitDiffHunk',
      delta: 1,
      hunkOffsets: [5, 10],
    })
    state = applyLogInkAction(state, {
      type: 'jumpCommitDiffHunk',
      delta: 1,
      hunkOffsets: [5, 10],
    })
    expect(state.diffPreviewOffset).toBe(10)

    state = applyLogInkAction(state, {
      type: 'jumpCommitDiffHunk',
      delta: 1,
      hunkOffsets: [5, 10],
    })
    expect(state.diffPreviewOffset).toBe(10)
  })

  it('keeps worktreeDiffOffset put when jumping before the first hunk', () => {
    let state = createLogInkState(rows, { activeView: 'diff' })

    state = applyLogInkAction(state, {
      type: 'jumpWorktreeHunk',
      delta: -1,
      hunkOffsets: [5, 10],
    })
    expect(state.worktreeDiffOffset).toBe(0)
  })

  it('stores commit compose state in the shared view model', () => {
    let state = createLogInkState(rows, { activeView: 'status' })

    state = applyLogInkAction(state, {
      type: 'commitCompose',
      action: { type: 'setEditing', value: true },
    })
    state = applyLogInkAction(state, {
      type: 'commitCompose',
      action: { type: 'append', value: 'feat: compose commit' },
    })

    expect(state.commitCompose.editing).toBe(true)
    expect(state.commitCompose.summary).toBe('feat: compose commit')
  })

  it('toggles graph, help, and command palette overlays', () => {
    // Note: since 0.54.x the default `fullGraph` flipped to true so
    // the workstation opens on the full multi-ref graph. The toggle
    // just flips the boolean, so one `toggleGraph` lands at false.
    let state = createLogInkState(rows)
    expect(state.fullGraph).toBe(true)

    state = applyLogInkAction(state, { type: 'toggleGraph' })
    state = applyLogInkAction(state, { type: 'toggleHelp' })
    state = applyLogInkAction(state, { type: 'toggleCommandPalette' })

    expect(state.fullGraph).toBe(false)
    expect(state.showHelp).toBe(false)
    expect(state.showCommandPalette).toBe(true)
  })

  it('defaults helpScrollOffset to 0 and resets it on toggleHelp', () => {
    let state = createLogInkState(rows)
    expect(state.helpScrollOffset).toBe(0)

    // Simulate the user opening help, scrolling, then closing it.
    state = applyLogInkAction(state, { type: 'toggleHelp' })
    state = applyLogInkAction(state, { type: 'scrollHelp', delta: 5 })
    expect(state.helpScrollOffset).toBe(5)
    state = applyLogInkAction(state, { type: 'toggleHelp' })
    // Closing clears the offset so the next open starts at the top.
    expect(state.showHelp).toBe(false)
    expect(state.helpScrollOffset).toBe(0)

    // Reopening keeps offset at 0.
    state = applyLogInkAction(state, { type: 'toggleHelp' })
    expect(state.helpScrollOffset).toBe(0)
  })

  it('toggles the view-keys strip and keeps it mutually exclusive with other overlays (#1137)', () => {
    let state = createLogInkState(rows)
    expect(state.showViewKeys).toBe(false)

    // g? opens the strip.
    state = applyLogInkAction(state, { type: 'toggleViewKeys' })
    expect(state.showViewKeys).toBe(true)

    // Toggling again closes it.
    state = applyLogInkAction(state, { type: 'toggleViewKeys' })
    expect(state.showViewKeys).toBe(false)

    // Opening full help supersedes the strip (the progressive-disclosure step).
    state = applyLogInkAction(state, { type: 'toggleViewKeys' })
    state = applyLogInkAction(state, { type: 'toggleHelp' })
    expect(state.showViewKeys).toBe(false)
    expect(state.showHelp).toBe(true)

    // Opening the strip closes help.
    state = applyLogInkAction(state, { type: 'toggleViewKeys' })
    expect(state.showHelp).toBe(false)
    expect(state.showViewKeys).toBe(true)

    // And the palette / filter mode also supersede the strip.
    state = applyLogInkAction(state, { type: 'toggleCommandPalette' })
    expect(state.showViewKeys).toBe(false)
    state = applyLogInkAction(state, { type: 'toggleViewKeys' })
    state = applyLogInkAction(state, { type: 'toggleFilterMode' })
    expect(state.showViewKeys).toBe(false)
  })

  it('scrollHelp floor-clamps at 0 (no negative offsets)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'toggleHelp' })
    state = applyLogInkAction(state, { type: 'scrollHelp', delta: -3 })
    expect(state.helpScrollOffset).toBe(0)

    state = applyLogInkAction(state, { type: 'scrollHelp', delta: 7 })
    state = applyLogInkAction(state, { type: 'scrollHelp', delta: -100 })
    expect(state.helpScrollOffset).toBe(0)
  })

  it('clears helpScrollOffset when opening filter mode or command palette', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'toggleHelp' })
    state = applyLogInkAction(state, { type: 'scrollHelp', delta: 3 })
    expect(state.helpScrollOffset).toBe(3)

    // Opening filter mode supersedes help.
    state = applyLogInkAction(state, { type: 'toggleFilterMode' })
    expect(state.showHelp).toBe(false)
    expect(state.helpScrollOffset).toBe(0)

    // And so does the command palette.
    state = applyLogInkAction(state, { type: 'toggleHelp' })
    state = applyLogInkAction(state, { type: 'scrollHelp', delta: 4 })
    state = applyLogInkAction(state, { type: 'toggleCommandPalette' })
    expect(state.showHelp).toBe(false)
    expect(state.helpScrollOffset).toBe(0)
  })

  it('defaults the diff view mode to unified', () => {
    const state = createLogInkState(rows)
    expect(state.diffViewMode).toBe('unified')
  })

  it('toggles diffViewMode between unified and split, resetting scroll offsets', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pageDetailPreview', delta: 5, previewLineCount: 100 })
    state = applyLogInkAction(state, { type: 'pageWorktreeDiff', delta: 5, lineCount: 100 })
    expect(state.diffPreviewOffset).toBe(5)
    expect(state.worktreeDiffOffset).toBe(5)

    state = applyLogInkAction(state, { type: 'toggleDiffViewMode' })
    expect(state.diffViewMode).toBe('split')
    expect(state.diffPreviewOffset).toBe(0)
    expect(state.worktreeDiffOffset).toBe(0)

    state = applyLogInkAction(state, { type: 'toggleDiffViewMode' })
    expect(state.diffViewMode).toBe('unified')
  })

  it('honors setDiffViewMode for explicit (e.g. persistence-restored) values', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'setDiffViewMode', value: 'split' })
    expect(state.diffViewMode).toBe('split')

    // Re-applying the same value is a no-op for diffViewMode but still
    // resets scroll — consistent with toggle semantics.
    state = applyLogInkAction(state, { type: 'pageDetailPreview', delta: 3, previewLineCount: 50 })
    state = applyLogInkAction(state, { type: 'setDiffViewMode', value: 'unified' })
    expect(state.diffViewMode).toBe('unified')
    expect(state.diffPreviewOffset).toBe(0)
  })

  it('tracks workflow action and confirmation state', () => {
    let state = createLogInkState(rows)

    state = applyLogInkAction(state, { type: 'setWorkflowAction', value: 'checkout-branch' })
    expect(state.workflowActionId).toBe('checkout-branch')
    expect(state.pendingConfirmationId).toBeUndefined()

    state = applyLogInkAction(state, { type: 'setPendingConfirmation', value: 'delete-branch' })
    expect(state.pendingConfirmationId).toBe('delete-branch')
    expect(state.workflowActionId).toBeUndefined()

    state = applyLogInkAction(state, { type: 'setPendingConfirmation', value: undefined })
    expect(state.pendingConfirmationId).toBeUndefined()

    state = applyLogInkAction(state, {
      type: 'setPendingConfirmation',
      value: 'revert-file',
    })
    expect(state.pendingConfirmationId).toBe('revert-file')

    state = applyLogInkAction(state, { type: 'setPendingConfirmation', value: undefined })
    expect(state.pendingConfirmationId).toBeUndefined()
  })

  // Pure conflict-resolution proposal logic now lives in
  // `conflictResolutionState.test.ts` alongside its extracted slice
  // (#1723). This composition-root test stays here because dropping the
  // session on navigation away from the conflicts view is behavior
  // `applyLogInkAction` layers on top of the slice, not something the
  // slice module itself owns.
  describe('AI conflict-resolution session (#1369)', () => {
    it('drops the session on navigation away from the conflicts view', () => {
      function readyState() {
        let state = createLogInkState(rows)
        state = applyLogInkAction(state, { type: 'pushView', value: 'conflicts' })
        state = applyLogInkAction(state, {
          type: 'setConflictResolutionReady',
          path: 'src/app.ts',
          proposals: [],
        })
        return state
      }

      let state = readyState()
      state = applyLogInkAction(state, { type: 'pushView', value: 'history' })
      expect(state.conflictResolution).toBeUndefined()

      state = readyState()
      state = applyLogInkAction(state, { type: 'popView' })
      expect(state.conflictResolution).toBeUndefined()
    })
  })

  it('choice and confirmation prompts displace each other (#1342)', () => {
    const choice = {
      id: 'diverged-pull-recovery',
      title: 'Branches diverged',
      options: [{ key: 'r', label: 'Pull with rebase', workflowId: 'pull-rebase-current' }],
    }

    // Raising a confirmation while a choice prompt is open closes the
    // choice — otherwise input precedence would shadow the confirm and
    // its `y` would be matched against choice option keys.
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'setPendingChoice', value: choice })
    state = applyLogInkAction(state, {
      type: 'setPendingConfirmation',
      value: 'delete-branch',
      payload: 'feat/x',
    })
    expect(state.pendingChoice).toBeUndefined()
    expect(state.pendingConfirmationId).toBe('delete-branch')

    // …and the mirror direction.
    state = applyLogInkAction(state, { type: 'setPendingChoice', value: choice })
    expect(state.pendingConfirmationId).toBeUndefined()
    expect(state.pendingConfirmationPayload).toBeUndefined()
    expect(state.pendingChoice).toEqual(choice)

    // Clearing one leaves the other untouched.
    state = applyLogInkAction(state, { type: 'setPendingChoice', value: undefined })
    expect(state.pendingChoice).toBeUndefined()
  })

  it('choice and confirmation prompts close help/view-keys/palette overlays (#1429)', () => {
    const choice = {
      id: 'operation-conflict-recovery',
      title: 'Operation conflict',
      options: [{ key: 'a', label: 'Abort', workflowId: 'abort-operation' }],
    }

    // Help (and its type-filter) renders above the choice panel and
    // swallows its keys — raising a choice must close it, mirroring how
    // toggleHelp/toggleViewKeys/toggleCommandPalette already close each
    // other.
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'toggleHelp' })
    state = applyLogInkAction(state, { type: 'openHelpFilter' })
    state = applyLogInkAction(state, { type: 'appendHelpFilter', value: 'reb' })
    expect(state.showHelp).toBe(true)

    state = applyLogInkAction(state, { type: 'setPendingChoice', value: choice })
    expect(state.showHelp).toBe(false)
    expect(state.helpFilterMode).toBe(false)
    expect(state.helpFilter).toBe('')
    expect(state.pendingChoice).toEqual(choice)

    // View-keys strip.
    state = applyLogInkAction(state, { type: 'setPendingChoice', value: undefined })
    state = applyLogInkAction(state, { type: 'toggleViewKeys' })
    expect(state.showViewKeys).toBe(true)
    state = applyLogInkAction(state, { type: 'setPendingChoice', value: choice })
    expect(state.showViewKeys).toBe(false)

    // Command palette.
    state = applyLogInkAction(state, { type: 'setPendingChoice', value: undefined })
    state = applyLogInkAction(state, { type: 'toggleCommandPalette' })
    expect(state.showCommandPalette).toBe(true)
    state = applyLogInkAction(state, { type: 'setPendingConfirmation', value: 'delete-branch' })
    expect(state.showCommandPalette).toBe(false)
    expect(state.pendingConfirmationId).toBe('delete-branch')

    // A confirmation raised over an open help overlay is likewise visible.
    state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'toggleHelp' })
    state = applyLogInkAction(state, {
      type: 'setPendingConfirmation',
      value: 'delete-branch',
      payload: 'feat/x',
    })
    expect(state.showHelp).toBe(false)
    expect(state.pendingConfirmationId).toBe('delete-branch')
  })

  describe('navigation primitives', () => {
    it('initializes the view stack with the root view', () => {
      const state = createLogInkState(rows)
      expect(state.viewStack).toEqual(['history'])
      expect(state.activeView).toBe('history')
    })

    it('honors a custom initial view in the stack', () => {
      const state = createLogInkState(rows, { activeView: 'status' })
      expect(state.viewStack).toEqual(['status'])
      expect(state.activeView).toBe('status')
    })

    it('pushes a new view onto the stack', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'diff' })

      expect(state.viewStack).toEqual(['history', 'diff'])
      expect(state.activeView).toBe('diff')
    })

    it('does not duplicate the top of the stack on push', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'history' })
      state = applyLogInkAction(state, { type: 'pushView', value: 'diff' })
      state = applyLogInkAction(state, { type: 'pushView', value: 'diff' })

      expect(state.viewStack).toEqual(['history', 'diff'])
    })

    // Regression: replaceRows unconditionally reset selectedIndex to 0.
    // Every history-mutating workflow (cherry-pick, fetch, each bisect
    // good/bad mark) refreshes through replaceRows, so the cursor
    // snapped to the top on every operation.
    it('replaceRows preserves the cursor by hash when the commit survives the refresh', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'move', delta: 2 })
      const selectedHash = state.filteredCommits[state.selectedIndex].hash

      // Same rows, fresh array identities — a refresh with no changes.
      state = applyLogInkAction(state, {
        type: 'replaceRows',
        rows: rows.map((row) => ({ ...row })),
      })
      expect(state.filteredCommits[state.selectedIndex].hash).toBe(selectedHash)
    })

    it('replaceRows still resets to the top when the commit set changed', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'move', delta: 2 })

      state = applyLogInkAction(state, {
        type: 'replaceRows',
        rows: [{
          type: 'commit', graph: '*', shortHash: 'zzz9999', hash: 'zzz9999'.padEnd(12, '9'),
          parents: [], date: '2026-05-01', author: 'Coco Test', refs: [], message: 'entirely new set',
        }],
      })
      expect(state.selectedIndex).toBe(0)
    })

    describe('rebase plan (#1359)', () => {
      const planRows = [
        { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'feat: one', author: 'Coco', date: '2026-05-01', action: 'pick' as const },
        { sha: 'b'.repeat(40), shortSha: 'bbbbbbb', subject: 'fix: two', author: 'Coco', date: '2026-05-02', action: 'pick' as const },
        { sha: 'c'.repeat(40), shortSha: 'ccccccc', subject: 'wip', author: 'Coco', date: '2026-05-03', action: 'pick' as const },
      ]
      const openPlan = () => applyLogInkAction(createLogInkState(rows), { type: 'openRebasePlan', rows: planRows })

      it('openRebasePlan pushes the rebase view with the cursor at the top', () => {
        const state = openPlan()
        expect(state.activeView).toBe('rebase')
        expect(state.rebasePlan?.rows).toHaveLength(3)
        expect(state.rebasePlan?.selectedIndex).toBe(0)
      })

      it('retags, rewords, and reorders the cursored row with clamping', () => {
        let state = openPlan()
        state = applyLogInkAction(state, { type: 'moveRebaseCursor', delta: 5 })
        expect(state.rebasePlan?.selectedIndex).toBe(2)

        state = applyLogInkAction(state, { type: 'setRebaseAction', action: 'fixup' })
        expect(state.rebasePlan?.rows[2].action).toBe('fixup')

        state = applyLogInkAction(state, { type: 'setRebaseRewordMessage', message: 'chore: reworded' })
        expect(state.rebasePlan?.rows[2]).toMatchObject({ action: 'reword', newMessage: 'chore: reworded' })

        // Retagging away from reword drops the stale message.
        state = applyLogInkAction(state, { type: 'setRebaseAction', action: 'pick' })
        expect(state.rebasePlan?.rows[2].newMessage).toBeUndefined()

        state = applyLogInkAction(state, { type: 'moveRebaseRow', delta: -1 })
        expect(state.rebasePlan?.rows.map((r) => r.shortSha)).toEqual(['aaaaaaa', 'ccccccc', 'bbbbbbb'])
        expect(state.rebasePlan?.selectedIndex).toBe(1)

        // Reorder off either edge is a no-op.
        state = applyLogInkAction(state, { type: 'moveRebaseCursor', delta: -5 })
        const before = state.rebasePlan?.rows.map((r) => r.shortSha)
        state = applyLogInkAction(state, { type: 'moveRebaseRow', delta: -1 })
        expect(state.rebasePlan?.rows.map((r) => r.shortSha)).toEqual(before)
      })

      it('clears the plan on lateral navigation and on popView — a stale plan must never execute', () => {
        let state = openPlan()
        state = applyLogInkAction(state, { type: 'pushView', value: 'branches' })
        expect(state.rebasePlan).toBeUndefined()

        state = openPlan()
        state = applyLogInkAction(state, { type: 'popView' })
        expect(state.activeView).toBe('history')
        expect(state.rebasePlan).toBeUndefined()
      })
    })

    // Regression: the bisect start-wizard pick flag survived every view
    // switch — its status hint auto-dismissed, and minutes later Enter on
    // a history commit silently advanced the hidden wizard instead of
    // opening the commit's diff.
    it('abandons a bisect pick when laterally navigating off the pick surface', () => {
      let state = createLogInkState(rows)
      // The wizard's own entry batch: arm the pick, then land on history.
      state = applyLogInkAction(state, { type: 'setBisectPickMode', mode: 'bad' })
      state = applyLogInkAction(state, { type: 'pushView', value: 'history' })
      expect(state.bisectPickMode).toBe('bad')

      // Wandering off to branches abandons the pick.
      state = applyLogInkAction(state, { type: 'pushView', value: 'branches' })
      expect(state.bisectPickMode).toBeUndefined()
      expect(state.bisectPickPendingBad).toBeUndefined()
    })

    // Regression: the shared `state.filter` used to survive lateral view
    // switches, silently pre-narrowing the destination's list — and since
    // workflows resolve their targets from the FILTERED lists by index,
    // silently re-aiming destructive actions (drop-stash, delete-branch).
    it('clears the shared filter on a lateral pushView/replaceView jump', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setFilter', value: 'fix' })
      expect(state.filter).toBe('fix')

      state = applyLogInkAction(state, { type: 'pushView', value: 'stash' })
      expect(state.filter).toBe('')
      expect(state.filterMode).toBe(false)

      state = applyLogInkAction(state, { type: 'setFilter', value: 'wip' })
      state = applyLogInkAction(state, { type: 'replaceView', value: 'branches' })
      expect(state.filter).toBe('')
    })

    it('keeps the filter on drill-in navigate actions (diff depends on it)', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setFilter', value: 'fix' })
      const filtered = state.filteredCommits.length
      expect(filtered).toBeGreaterThan(0)

      // Enter on a history commit dispatches navigateOpenDiffForCommit,
      // not pushView — the diff's subject commit is resolved through
      // `filteredCommits[selectedIndex]`, so the filter must survive.
      state = applyLogInkAction(state, {
        type: 'navigateOpenDiffForCommit',
        sha: state.filteredCommits[0].hash,
        commitIndex: 0,
      })
      expect(state.activeView).toBe('diff')
      expect(state.filter).toBe('fix')
      expect(state.filteredCommits).toHaveLength(filtered)
    })

    it('pops the top of the stack', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'status' })
      state = applyLogInkAction(state, { type: 'pushView', value: 'diff' })

      state = applyLogInkAction(state, { type: 'popView' })
      expect(state.viewStack).toEqual(['history', 'status'])
      expect(state.activeView).toBe('status')

      state = applyLogInkAction(state, { type: 'popView' })
      expect(state.viewStack).toEqual(['history'])
      expect(state.activeView).toBe('history')
    })

    it('refuses to pop past the root view', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'popView' })
      state = applyLogInkAction(state, { type: 'popView' })

      expect(state.viewStack).toEqual(['history'])
      expect(state.activeView).toBe('history')
    })

    it('preserves stack depth when replacing the top', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'status' })
      state = applyLogInkAction(state, { type: 'replaceView', value: 'diff' })

      expect(state.viewStack).toEqual(['history', 'diff'])
      expect(state.activeView).toBe('diff')
    })

    it('keeps the stack consistent when setActiveView is dispatched', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'status' })
      state = applyLogInkAction(state, { type: 'setActiveView', value: 'diff' })

      // setActiveView replaces the top of the stack — same depth, new top
      expect(state.viewStack).toEqual(['history', 'diff'])
      expect(state.activeView).toBe('diff')
    })

    it('keeps the stack consistent when moveWorktreeFile flips into status view', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'diff' })
      state = applyLogInkAction(state, { type: 'moveWorktreeFile', delta: 1, fileCount: 3 })

      // moveWorktreeFile uses replace semantics, so depth is preserved
      expect(state.viewStack).toEqual(['history', 'status'])
      expect(state.activeView).toBe('status')
      expect(state.selectedWorktreeFileIndex).toBe(1)
    })

    it('clears worktree state when navigating away from diff', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'diff' })
      state = applyLogInkAction(state, { type: 'pageWorktreeDiff', delta: 15, lineCount: 100 })
      state = applyLogInkAction(state, {
        type: 'jumpWorktreeHunk',
        delta: 1,
        hunkOffsets: [10, 20, 30],
      })

      expect(state.worktreeDiffOffset).toBeGreaterThan(0)
      expect(hunkIndexAtOffset(state.worktreeDiffOffset, [10, 20, 30])).toBeGreaterThan(0)

      state = applyLogInkAction(state, { type: 'popView' })
      expect(state.activeView).toBe('history')
      expect(state.worktreeDiffOffset).toBe(0)
      expect(hunkIndexAtOffset(state.worktreeDiffOffset, [10, 20, 30])).toBe(0)
    })

    it('navigates home, resetting the stack to the history root', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'status' })
      state = applyLogInkAction(state, { type: 'pushView', value: 'diff' })
      state = applyLogInkAction(state, { type: 'navigateHome' })

      expect(state.viewStack).toEqual(['history'])
      expect(state.activeView).toBe('history')
    })
  })

  describe('navigation intents', () => {
    it('intentGoHome returns null when already at the root history view', () => {
      const state = createLogInkState(rows)
      expect(intentGoHome(state)).toBeNull()
    })

    it('intentGoHome returns navigateHome when not at root', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'diff' })

      expect(intentGoHome(state)).toEqual({ type: 'navigateHome' })
    })

    it('intentGoHome returns navigateHome when initial view is non-history', () => {
      const state = createLogInkState(rows, { activeView: 'status' })
      expect(intentGoHome(state)).toEqual({ type: 'navigateHome' })
    })

    it('intentOpenDiffForCommit resolves to a navigate action when the sha is known', () => {
      const state = createLogInkState(rows)
      const intent = intentOpenDiffForCommit(state, 'def567890123')

      expect(intent).toEqual({
        type: 'navigateOpenDiffForCommit',
        sha: 'def567890123',
        commitIndex: 1,
      })
    })

    it('intentOpenDiffForCommit returns null for an unknown sha', () => {
      const state = createLogInkState(rows)
      expect(intentOpenDiffForCommit(state, 'deadbeef')).toBeNull()
    })

    it('navigateOpenDiffForCommit pushes diff and selects the commit', () => {
      let state = createLogInkState(rows)
      const intent = intentOpenDiffForCommit(state, 'fed999900000')!

      state = applyLogInkAction(state, intent)

      expect(state.viewStack).toEqual(['history', 'diff'])
      expect(state.activeView).toBe('diff')
      expect(getSelectedInkCommit(state)?.hash).toBe('fed999900000')
      expect(state.diffSource).toBe('commit')
    })

    it('navigateOpenDiffForCommit preserves the selected file when fileIndex is provided', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, {
        type: 'navigateOpenDiffForCommit',
        sha: 'def567890123',
        commitIndex: 1,
        fileIndex: 3,
      })

      expect(state.activeView).toBe('diff')
      expect(state.selectedFileIndex).toBe(3)
      expect(state.diffSource).toBe('commit')
    })

    it('clears diffSource when the diff view is popped', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, {
        type: 'navigateOpenDiffForCommit',
        sha: 'def567890123',
        commitIndex: 1,
      })
      expect(state.diffSource).toBe('commit')

      state = applyLogInkAction(state, { type: 'popView' })
      expect(state.activeView).toBe('history')
      expect(state.diffSource).toBeUndefined()
    })

    it('intentOpenDiffForWorktreeFile resolves a known path to a fileIndex', () => {
      const intent = intentOpenDiffForWorktreeFile('src/foo.ts', [
        'src/bar.ts',
        'src/foo.ts',
        'src/baz.ts',
      ])

      expect(intent).toEqual({ type: 'navigateOpenDiffForWorktreeFile', fileIndex: 1 })
    })

    it('intentOpenDiffForWorktreeFile returns null when the path is not in the worktree list', () => {
      expect(intentOpenDiffForWorktreeFile('src/foo.ts', ['src/bar.ts'])).toBeNull()
    })

    it('navigateOpenDiffForWorktreeFile pushes diff and selects the file', () => {
      let state = createLogInkState(rows)
      const intent = intentOpenDiffForWorktreeFile('src/foo.ts', [
        'src/bar.ts',
        'src/foo.ts',
        'src/baz.ts',
      ])!

      state = applyLogInkAction(state, intent)

      expect(state.viewStack).toEqual(['history', 'diff'])
      expect(state.activeView).toBe('diff')
      expect(state.selectedWorktreeFileIndex).toBe(1)
      expect(state.diffSource).toBe('worktree')
    })

    it('intentOpenComposeForFile is a no-op when the working tree is clean', () => {
      expect(intentOpenComposeForFile('src/foo.ts', [])).toBeNull()
    })

    it('intentOpenComposeForFile returns null when the path is not in the worktree list', () => {
      expect(intentOpenComposeForFile('src/foo.ts', ['src/bar.ts'])).toBeNull()
    })

    it('intentOpenComposeForFile resolves a dirty worktree path', () => {
      expect(
        intentOpenComposeForFile('src/foo.ts', ['src/bar.ts', 'src/foo.ts'])
      ).toEqual({ type: 'navigateOpenComposeForFile', fileIndex: 1 })
    })

    it('navigateOpenComposeForFile pushes status view and selects the file', () => {
      let state = createLogInkState(rows)
      const intent = intentOpenComposeForFile('src/foo.ts', ['src/foo.ts'])!

      state = applyLogInkAction(state, intent)

      expect(state.viewStack).toEqual(['history', 'status'])
      expect(state.activeView).toBe('status')
      expect(state.selectedWorktreeFileIndex).toBe(0)
    })
  })

  describe('sort cycling (P4.2)', () => {
    it('cycleBranchSort advances the mode and resets the cursor to the top', () => {
      let state = createLogInkState(rows)
      state = { ...state, selectedBranchIndex: 5 }
      expect(state.branchSort).toBe('name')

      state = applyLogInkAction(state, { type: 'cycleBranchSort' })
      expect(state.branchSort).toBe('recent')
      expect(state.selectedBranchIndex).toBe(0)

      state = applyLogInkAction(state, { type: 'cycleBranchSort' })
      expect(state.branchSort).toBe('ahead')

      state = applyLogInkAction(state, { type: 'cycleBranchSort' })
      expect(state.branchSort).toBe('name')
    })

    it('cycleTagSort advances the mode and resets the cursor', () => {
      let state = createLogInkState(rows)
      state = { ...state, selectedTagIndex: 7 }
      expect(state.tagSort).toBe('recent')

      state = applyLogInkAction(state, { type: 'cycleTagSort' })
      expect(state.tagSort).toBe('name')
      expect(state.selectedTagIndex).toBe(0)

      state = applyLogInkAction(state, { type: 'cycleTagSort' })
      expect(state.tagSort).toBe('recent')
    })

    it('cycle actions clear any pending chord prefix', () => {
      let state = createLogInkState(rows)
      state = { ...state, pendingKey: 'g' }

      state = applyLogInkAction(state, { type: 'cycleBranchSort' })
      expect(state.pendingKey).toBeUndefined()
    })
  })

  describe('promoted-view selection rectification on filter (P4.5)', () => {
    it('uses the supplied snapshot to preserve the cursor on the same item', () => {
      let state = createLogInkState(rows)
      state = { ...state, selectedBranchIndex: 1 }

      state = applyLogInkAction(state, {
        type: 'appendFilter',
        value: 'feat',
        promotedSelections: { branchIndex: 0, tagIndex: 0, stashIndex: 0 },
      })

      expect(state.filter).toBe('feat')
      expect(state.selectedBranchIndex).toBe(0)
    })

    it('snaps each promoted selection to result[0] when the snapshot says so', () => {
      let state = createLogInkState(rows)
      state = {
        ...state,
        selectedBranchIndex: 5,
        selectedTagIndex: 3,
        selectedStashIndex: 2,
      }

      state = applyLogInkAction(state, {
        type: 'appendFilter',
        value: 'q',
        promotedSelections: { branchIndex: 0, tagIndex: 0, stashIndex: 0 },
      })

      expect(state.selectedBranchIndex).toBe(0)
      expect(state.selectedTagIndex).toBe(0)
      expect(state.selectedStashIndex).toBe(0)
    })

    it('falls back to "always snap to 0" when no snapshot is supplied', () => {
      let state = createLogInkState(rows)
      state = { ...state, selectedBranchIndex: 4, selectedTagIndex: 7 }

      state = applyLogInkAction(state, { type: 'appendFilter', value: 'x' })

      expect(state.selectedBranchIndex).toBe(0)
      expect(state.selectedTagIndex).toBe(0)
    })

    it('lets the snapshot move the cursor to a non-zero index in the filtered list', () => {
      let state = createLogInkState(rows)
      state = { ...state, filter: 'alpha', selectedBranchIndex: 0 }

      state = applyLogInkAction(state, {
        type: 'backspaceFilter',
        promotedSelections: { branchIndex: 2 },
      })

      expect(state.filter).toBe('alph')
      expect(state.selectedBranchIndex).toBe(2)
    })

    it('keeps the cursor put when the filter string did not actually change', () => {
      let state = createLogInkState(rows)
      state = { ...state, filter: 'foo', selectedBranchIndex: 3 }

      state = applyLogInkAction(state, { type: 'setFilter', value: 'foo' })

      expect(state.selectedBranchIndex).toBe(3)
    })
  })

  describe('status filter mask (#776)', () => {
    it('initializes the mask to all-on so existing flows are unaffected', () => {
      const state = createLogInkState(rows)
      expect(state.statusFilterMask).toEqual(DEFAULT_LOG_INK_STATUS_FILTER_MASK)
    })

    it('toggles a single bit on each press', () => {
      let state = createLogInkState(rows)

      state = applyLogInkAction(state, { type: 'toggleStatusFilterMask', kind: 'staged' })
      expect(state.statusFilterMask).toEqual({ staged: false, unstaged: true, untracked: true })

      state = applyLogInkAction(state, { type: 'toggleStatusFilterMask', kind: 'staged' })
      expect(state.statusFilterMask).toEqual({ staged: true, unstaged: true, untracked: true })

      state = applyLogInkAction(state, { type: 'toggleStatusFilterMask', kind: 'untracked' })
      state = applyLogInkAction(state, { type: 'toggleStatusFilterMask', kind: 'unstaged' })
      expect(state.statusFilterMask).toEqual({ staged: true, unstaged: false, untracked: false })
    })

    it('snaps back to all-on when the user would have zeroed the mask', () => {
      let state = createLogInkState(rows)
      // Zero each bit one at a time. The third toggle is the one that
      // would land on all-off; the reducer must restore the default.
      state = applyLogInkAction(state, { type: 'toggleStatusFilterMask', kind: 'staged' })
      state = applyLogInkAction(state, { type: 'toggleStatusFilterMask', kind: 'unstaged' })
      state = applyLogInkAction(state, { type: 'toggleStatusFilterMask', kind: 'untracked' })

      expect(state.statusFilterMask).toEqual(DEFAULT_LOG_INK_STATUS_FILTER_MASK)
    })

    it('resets selectedWorktreeFileIndex on toggle so the cursor lands on a visible row', () => {
      let state = createLogInkState(rows)
      state = { ...state, selectedWorktreeFileIndex: 5 }

      state = applyLogInkAction(state, { type: 'toggleStatusFilterMask', kind: 'staged' })
      expect(state.selectedWorktreeFileIndex).toBe(0)
    })
  })

  describe('history server-side filter (#776)', () => {
    describe('parseLogInkHistoryFetchPrefix', () => {
      it('parses path:<value> into a path fetch arg', () => {
        expect(parseLogInkHistoryFetchPrefix('path:src/commands/log')).toEqual({
          path: 'src/commands/log',
        })
      })

      it('parses author:<value> into an author fetch arg', () => {
        expect(parseLogInkHistoryFetchPrefix('author:alice')).toEqual({ author: 'alice' })
      })

      it('keeps the rest of the string verbatim — paths and author names can contain spaces', () => {
        expect(parseLogInkHistoryFetchPrefix('path:src/with spaces/foo.ts')).toEqual({
          path: 'src/with spaces/foo.ts',
        })
        expect(parseLogInkHistoryFetchPrefix('author:Griffen Fargo')).toEqual({
          author: 'Griffen Fargo',
        })
      })

      it('returns undefined when the prefix has no value', () => {
        expect(parseLogInkHistoryFetchPrefix('path:')).toBeUndefined()
        expect(parseLogInkHistoryFetchPrefix('author:   ')).toBeUndefined()
      })

      it('returns undefined for plain (client-side) filter strings', () => {
        expect(parseLogInkHistoryFetchPrefix('feat')).toBeUndefined()
        expect(parseLogInkHistoryFetchPrefix('fixpathfoo')).toBeUndefined()
      })

      it('parses S:<token> into a pickaxe fetch arg', () => {
        expect(parseLogInkHistoryFetchPrefix('S:useState')).toEqual({ pickaxe: 'useState' })
        expect(parseLogInkHistoryFetchPrefix('S:my function name')).toEqual({ pickaxe: 'my function name' })
      })

      it('parses G:<regex> into a grep fetch arg', () => {
        expect(parseLogInkHistoryFetchPrefix('G:TODO|FIXME')).toEqual({ grep: 'TODO|FIXME' })
        expect(parseLogInkHistoryFetchPrefix('G:\\bclass\\b')).toEqual({ grep: '\\bclass\\b' })
      })

      it('returns undefined for S: and G: with no value', () => {
        expect(parseLogInkHistoryFetchPrefix('S:')).toBeUndefined()
        expect(parseLogInkHistoryFetchPrefix('G:   ')).toBeUndefined()
      })
    })

    it('setHistoryFetchArgs / replaceRows / clear flow keeps state internally consistent', () => {
      let state = createLogInkState(rows)

      state = applyLogInkAction(state, {
        type: 'setHistoryFetchArgs',
        value: { author: 'alice' },
      })
      expect(state.historyFetchArgs).toEqual({ author: 'alice' })

      // Server replaces rows with a smaller matched set.
      const matched: GitLogRow[] = [
        {
          type: 'commit',
          graph: '*',
          shortHash: 'fff0001',
          hash: 'fff000111111',
          parents: [],
          date: '2026-05-01',
          author: 'alice',
          refs: [],
          message: 'matched commit',
        },
      ]
      state = applyLogInkAction(state, { type: 'replaceRows', rows: matched })
      expect(state.commits).toHaveLength(1)
      expect(state.selectedIndex).toBe(0)
      expect(state.historyFetchArgs).toEqual({ author: 'alice' })

      // Clearing the fetch args is a separate action — replaceRows did
      // not touch them, so the runtime can decide when to drop them.
      state = applyLogInkAction(state, { type: 'setHistoryFetchArgs', value: undefined })
      expect(state.historyFetchArgs).toBeUndefined()
    })
  })

  // #806 follow-up — branch / tag selection auto-jumps the history
  // view to the cursored ref's tip commit. The reducer just locates
  // the hash within the filtered list; the runtime React effect is
  // what watches the cursor and dispatches.
  describe('selectCommitByHash', () => {
    it('snaps selectedIndex to the commit matching the full hash', () => {
      let state = createLogInkState(rows)
      // rows[2] has hash 'fed999900000'.
      state = applyLogInkAction(state, { type: 'selectCommitByHash', hash: 'fed999900000' })
      expect(state.selectedIndex).toBe(2)
    })

    it('also accepts the short hash', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'selectCommitByHash', hash: 'fed9999' })
      expect(state.selectedIndex).toBe(2)
    })

    it('is a no-op when the hash is not in the loaded list', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'move', delta: 1 })
      expect(state.selectedIndex).toBe(1)
      // No matching commit → cursor stays put. The runtime effect
      // surfaces a status hint; this reducer just declines to move.
      state = applyLogInkAction(state, { type: 'selectCommitByHash', hash: 'nonexistent' })
      expect(state.selectedIndex).toBe(1)
    })

    it('resets the file index and diff offset on jump', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveDetailFile', delta: 3, fileCount: 5 })
      state = applyLogInkAction(state, { type: 'selectCommitByHash', hash: 'fed999900000' })
      expect(state.selectedFileIndex).toBe(0)
      expect(state.diffPreviewOffset).toBe(0)
    })

    it('matches a target that is a prefix of a loaded commit hash', () => {
      // The production short-hash mismatch: `for-each-ref` returned
      // 'fed9' for the cursored ref but `git log` stored 'fed9999' on
      // the row. Exact lookup would miss; prefix matching catches it.
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'selectCommitByHash', hash: 'fed9' })
      expect(state.selectedIndex).toBe(2)
    })

    it('matches a target that is longer than a loaded short hash', () => {
      // Inverse direction: cursored ref carries an 8-char hash, the
      // loaded row only has a 7-char short form. The reducer should
      // still resolve the jump.
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'selectCommitByHash', hash: 'fed99990' })
      expect(state.selectedIndex).toBe(2)
    })

    it('refuses to prefix-match on absurdly short targets', () => {
      // A 3-char "hash" would collide with too many real commits.
      // Same floor as `isHashLoaded` in the resolver.
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'move', delta: 1 })
      expect(state.selectedIndex).toBe(1)
      state = applyLogInkAction(state, { type: 'selectCommitByHash', hash: 'fed' })
      expect(state.selectedIndex).toBe(1) // unchanged
    })
  })

  // #806 follow-up — after a successful checkout, the branches sidebar
  // cursor snaps back to position 0 so it lands on the just-checked-out
  // branch (which is now pinned at the top per the #809 sort rule).
  describe('resetBranchSelection', () => {
    it('snaps selectedBranchIndex to 0', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveBranch', delta: 5, count: 10 })
      expect(state.selectedBranchIndex).toBe(5)
      state = applyLogInkAction(state, { type: 'resetBranchSelection' })
      expect(state.selectedBranchIndex).toBe(0)
    })
  })

  // #1452 dual-write — moveBranch/moveTag/moveStash write the resolved
  // id alongside the index. The reducer has no access to LogInkContext,
  // so it trusts whatever id the dispatch site resolved; it does not
  // (and cannot) verify the id matches the index itself.
  describe('moveBranch / moveTag / moveStash id dual-write (#1452)', () => {
    it('writes selectedBranchId alongside the index when the dispatch site resolved one', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveBranch', delta: 1, count: 5, id: 'feature' })
      expect(state.selectedBranchIndex).toBe(1)
      expect(state.selectedBranchId).toBe('feature')
    })

    it('leaves selectedBranchId undefined when the dispatch site could not resolve one', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveBranch', delta: 1, count: 5 })
      expect(state.selectedBranchId).toBeUndefined()
    })

    it('writes selectedTagId alongside the index', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveTag', delta: 2, count: 5, id: 'v2.0' })
      expect(state.selectedTagIndex).toBe(2)
      expect(state.selectedTagId).toBe('v2.0')
    })

    it('writes selectedStashId alongside the index', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveStash', delta: 1, count: 5, id: 'stash@{1}' })
      expect(state.selectedStashIndex).toBe(1)
      expect(state.selectedStashId).toBe('stash@{1}')
    })

    it('writes selectedWorktreeListId alongside the index', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveWorktreeListEntry', delta: 1, count: 5, id: '/repo-feature' })
      expect(state.selectedWorktreeListIndex).toBe(1)
      expect(state.selectedWorktreeListId).toBe('/repo-feature')
    })

    it('leaves selectedWorktreeListId undefined when the dispatch site could not resolve one', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveWorktreeListEntry', delta: 1, count: 5 })
      expect(state.selectedWorktreeListId).toBeUndefined()
    })

    it('writes selectedSubmoduleId alongside the index', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveSubmodule', delta: 1, count: 5, id: '/vendor/b' })
      expect(state.selectedSubmoduleIndex).toBe(1)
      expect(state.selectedSubmoduleId).toBe('/vendor/b')
    })

    it('leaves selectedSubmoduleId undefined when the dispatch site could not resolve one', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveSubmodule', delta: 1, count: 5 })
      expect(state.selectedSubmoduleId).toBeUndefined()
    })

    it('writes selectedRemoteId alongside the index', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveRemote', delta: 1, count: 5, id: 'upstream' })
      expect(state.selectedRemoteIndex).toBe(1)
      expect(state.selectedRemoteId).toBe('upstream')
    })

    it('leaves selectedRemoteId undefined when the dispatch site could not resolve one', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveRemote', delta: 1, count: 5 })
      expect(state.selectedRemoteId).toBeUndefined()
    })

    it('writes selectedIssueId alongside the index', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveIssue', delta: 1, count: 5, id: '7' })
      expect(state.selectedIssueIndex).toBe(1)
      expect(state.selectedIssueId).toBe('7')
    })

    it('leaves selectedIssueId undefined when the dispatch site could not resolve one', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveIssue', delta: 1, count: 5 })
      expect(state.selectedIssueId).toBeUndefined()
    })

    it('writes selectedPullRequestTriageId alongside the index', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'movePullRequestTriage', delta: 1, count: 5, id: '9' })
      expect(state.selectedPullRequestTriageIndex).toBe(1)
      expect(state.selectedPullRequestTriageId).toBe('9')
    })

    it('leaves selectedPullRequestTriageId undefined when the dispatch site could not resolve one', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'movePullRequestTriage', delta: 1, count: 5 })
      expect(state.selectedPullRequestTriageId).toBeUndefined()
    })
  })

  // #1452 flip — every OTHER action that resets or rectifies
  // selectedBranchIndex/selectedTagIndex/selectedStashIndex must also
  // clear (or precisely set) the id mirror, so the id-preferring
  // selectors in selection.ts never resolve to a stale item that
  // disagrees with a freshly reset/rectified index.
  describe('id mirror stays consistent across non-move index resets (#1452)', () => {
    it('resetBranchSelection clears selectedBranchId', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveBranch', delta: 3, count: 10, id: 'feature' })
      expect(state.selectedBranchId).toBe('feature')
      state = applyLogInkAction(state, { type: 'resetBranchSelection' })
      expect(state.selectedBranchIndex).toBe(0)
      expect(state.selectedBranchId).toBeUndefined()
    })

    it('cycleBranchSort clears selectedBranchId', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveBranch', delta: 3, count: 10, id: 'feature' })
      state = applyLogInkAction(state, { type: 'cycleBranchSort' })
      expect(state.selectedBranchIndex).toBe(0)
      expect(state.selectedBranchId).toBeUndefined()
    })

    it('cycleTagSort clears selectedTagId', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveTag', delta: 3, count: 10, id: 'v2.0' })
      state = applyLogInkAction(state, { type: 'cycleTagSort' })
      expect(state.selectedTagIndex).toBe(0)
      expect(state.selectedTagId).toBeUndefined()
    })

    it('navigateOpenDiffForStash sets selectedStashId precisely from action.ref', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveStash', delta: 3, count: 10, id: 'stash@{3}' })
      state = applyLogInkAction(state, { type: 'navigateOpenDiffForStash', ref: 'stash@{7}', stashIndex: 2 })
      expect(state.selectedStashIndex).toBe(2)
      expect(state.selectedStashId).toBe('stash@{7}')
    })

    it('a filter change clears all three id mirrors', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveBranch', delta: 1, count: 10, id: 'feature' })
      state = applyLogInkAction(state, { type: 'moveTag', delta: 1, count: 10, id: 'v2.0' })
      state = applyLogInkAction(state, { type: 'moveStash', delta: 1, count: 10, id: 'stash@{1}' })
      state = applyLogInkAction(state, { type: 'appendFilter', value: 'x' })
      expect(state.selectedBranchId).toBeUndefined()
      expect(state.selectedTagId).toBeUndefined()
      expect(state.selectedStashId).toBeUndefined()
    })
  })

  // OSS-1001 / #1671 — a background context refresh only replaces
  // `LogInkContext`; it never touches the reducer, so `selected*Index`
  // goes stale the moment the refresh reorders/inserts/removes rows.
  // `rectifyPromotedSelections` re-syncs the index to wherever the id
  // now sits (or clears the id when it no longer resolves) so the
  // rendered highlight and the id-first workflow executor stay in
  // agreement — see `refreshRectification.test.ts` for the snapshot
  // computation this action consumes.
  describe('rectifyPromotedSelections (OSS-1001 / #1671)', () => {
    it('moves selectedBranchIndex to the snapshot index and keeps the id', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveBranch', delta: 3, count: 10, id: 'feature-a' })
      expect(state.selectedBranchIndex).toBe(3)
      state = applyLogInkAction(state, {
        type: 'rectifyPromotedSelections',
        snapshot: { branch: { index: 5 } },
      })
      expect(state.selectedBranchIndex).toBe(5)
      expect(state.selectedBranchId).toBe('feature-a')
    })

    it('clears selectedBranchId and leaves the index untouched when the id no longer resolves', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveBranch', delta: 3, count: 10, id: 'feature-a' })
      state = applyLogInkAction(state, {
        type: 'rectifyPromotedSelections',
        snapshot: { branch: { clear: true } },
      })
      expect(state.selectedBranchIndex).toBe(3)
      expect(state.selectedBranchId).toBeUndefined()
    })

    it('is a no-op for views absent from the snapshot — never fights a resetBranchSelection', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveBranch', delta: 3, count: 10, id: 'feature-a' })
      state = applyLogInkAction(state, { type: 'resetBranchSelection' })
      expect(state.selectedBranchId).toBeUndefined()
      // An empty snapshot (e.g. the branch id was already unset before
      // the refresh landed) must not resurrect a stale index/id.
      const before = state
      state = applyLogInkAction(state, { type: 'rectifyPromotedSelections', snapshot: {} })
      expect(state).toBe(before)
    })

    it('rectifies tag / stash / worktree / submodule / remote independently in one dispatch', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveTag', delta: 1, count: 10, id: 'v2.0' })
      state = applyLogInkAction(state, { type: 'moveStash', delta: 1, count: 10, id: 'stash@{1}' })
      state = applyLogInkAction(state, { type: 'moveWorktreeListEntry', delta: 1, count: 10, id: '/repo-feature' })
      state = applyLogInkAction(state, { type: 'moveSubmodule', delta: 1, count: 10, id: '/vendor/b' })
      state = applyLogInkAction(state, { type: 'moveRemote', delta: 1, count: 10, id: 'upstream' })
      state = applyLogInkAction(state, {
        type: 'rectifyPromotedSelections',
        snapshot: {
          tag: { index: 4 },
          stash: { clear: true },
          worktreeList: { index: 2 },
          submodule: { clear: true },
          remote: { index: 0 },
        },
      })
      expect(state.selectedTagIndex).toBe(4)
      expect(state.selectedTagId).toBe('v2.0')
      expect(state.selectedStashIndex).toBe(1)
      expect(state.selectedStashId).toBeUndefined()
      expect(state.selectedWorktreeListIndex).toBe(2)
      expect(state.selectedWorktreeListId).toBe('/repo-feature')
      expect(state.selectedSubmoduleIndex).toBe(1)
      expect(state.selectedSubmoduleId).toBeUndefined()
      expect(state.selectedRemoteIndex).toBe(0)
      expect(state.selectedRemoteId).toBe('upstream')
    })
  })

  // #1361 — multi-select marks + range anchor.
  describe('multi-select selection (#1361)', () => {
    it('toggleMark adds then removes an id, collapsing to undefined when empty', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'feat/a' })
      expect(state.selection).toEqual({ view: 'branches', anchorId: undefined, ids: new Set(['feat/a']) })
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'feat/b' })
      expect(state.selection?.ids).toEqual(new Set(['feat/a', 'feat/b']))
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'feat/a' })
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'feat/b' })
      expect(state.selection).toBeUndefined()
    })

    it('marking in a different view resets the previous view\'s selection', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'feat/a' })
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'stash', id: 'stash@{0}' })
      expect(state.selection).toEqual({ view: 'stash', anchorId: undefined, ids: new Set(['stash@{0}']) })
    })

    // #1361 — marks and a range anchor are mutually exclusive within a
    // view: the batch selector already prioritizes an active range over
    // marks, so letting both coexist would paint mark glyphs on rows a
    // batch action wouldn't actually touch (found in review — the
    // selector-priority behavior was tested, the state invariant wasn't).
    it('setRangeAnchor drops any existing marks in the same view', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'feat/a' })
      state = applyLogInkAction(state, { type: 'setRangeAnchor', view: 'branches', id: 'feat/b' })
      expect(state.selection).toEqual({ view: 'branches', anchorId: 'feat/b', ids: new Set() })
    })

    it('toggleMark drops any existing range anchor in the same view', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setRangeAnchor', view: 'branches', id: 'feat/a' })
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'feat/b' })
      expect(state.selection).toEqual({ view: 'branches', anchorId: undefined, ids: new Set(['feat/b']) })
    })

    it('clearing the anchor after it superseded marks leaves the selection empty', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'feat/a' })
      state = applyLogInkAction(state, { type: 'setRangeAnchor', view: 'branches', id: 'feat/b' })
      state = applyLogInkAction(state, { type: 'setRangeAnchor', view: 'branches', id: undefined })
      expect(state.selection).toBeUndefined()
    })

    it('clearing the anchor with no marks collapses the selection to undefined', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setRangeAnchor', view: 'branches', id: 'feat/a' })
      state = applyLogInkAction(state, { type: 'setRangeAnchor', view: 'branches', id: undefined })
      expect(state.selection).toBeUndefined()
    })

    it('setMarks replaces the selection wholesale and drops any anchor', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setRangeAnchor', view: 'branches', id: 'feat/a' })
      state = applyLogInkAction(state, { type: 'setMarks', view: 'branches', ids: ['feat/b', 'feat/c'] })
      expect(state.selection).toEqual({ view: 'branches', anchorId: undefined, ids: new Set(['feat/b', 'feat/c']) })
      state = applyLogInkAction(state, { type: 'setMarks', view: 'branches', ids: [] })
      expect(state.selection).toBeUndefined()
    })

    it('clearSelection drops everything', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'feat/a' })
      state = applyLogInkAction(state, { type: 'clearSelection' })
      expect(state.selection).toBeUndefined()
    })

    it('marks survive filter changes (ids are stable across re-filtering)', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'feat/a' })
      state = applyLogInkAction(state, { type: 'appendFilter', value: 'x' })
      expect(state.selection?.ids).toEqual(new Set(['feat/a']))
    })

    it('marks are cleared at the repo-frame boundary, both push and pop', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'feat/a' })
      const pushed = applyLogInkAction(state, { type: 'pushRepoFrame', label: 'vendor/lib' })
      expect(pushed.selection).toBeUndefined()
      const markedInside = applyLogInkAction(pushed, { type: 'toggleMark', view: 'branches', id: 'sub-branch' })
      const popped = applyLogInkAction(markedInside, { type: 'popRepoFrame' })
      expect(popped.selection).toBeUndefined()
    })
  })

  // Sidebar header focus (#806 follow-up) — escapes the items list
  // upward onto the active tab's header. Reducer-level coverage
  // here; input dispatch coverage lives in inkInput.test.ts.
  describe('sidebarHeaderFocused', () => {
    it('defaults to false', () => {
      expect(createLogInkState(rows).sidebarHeaderFocused).toBe(false)
    })

    it('setSidebarHeaderFocused toggles the flag', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setSidebarHeaderFocused', value: true })
      expect(state.sidebarHeaderFocused).toBe(true)
      state = applyLogInkAction(state, { type: 'setSidebarHeaderFocused', value: false })
      expect(state.sidebarHeaderFocused).toBe(false)
    })

    it('clears when focus moves away from the sidebar', () => {
      let state = applyLogInkAction(createLogInkState(rows), { type: 'setFocus', value: 'sidebar' })
      state = applyLogInkAction(state, { type: 'setSidebarHeaderFocused', value: true })
      expect(state.sidebarHeaderFocused).toBe(true)
      state = applyLogInkAction(state, { type: 'setFocus', value: 'commits' })
      expect(state.sidebarHeaderFocused).toBe(false)
    })

    it('clears on focusNext / focusPrevious', () => {
      let state = applyLogInkAction(createLogInkState(rows), { type: 'setFocus', value: 'sidebar' })
      state = applyLogInkAction(state, { type: 'setSidebarHeaderFocused', value: true })
      state = applyLogInkAction(state, { type: 'focusNext' })
      expect(state.sidebarHeaderFocused).toBe(false)

      state = applyLogInkAction(state, { type: 'setFocus', value: 'sidebar' })
      state = applyLogInkAction(state, { type: 'setSidebarHeaderFocused', value: true })
      state = applyLogInkAction(state, { type: 'focusPrevious' })
      expect(state.sidebarHeaderFocused).toBe(false)
    })

    it('preserves the flag when setFocus targets sidebar (no-op self-assignment)', () => {
      let state = applyLogInkAction(createLogInkState(rows), { type: 'setFocus', value: 'sidebar' })
      state = applyLogInkAction(state, { type: 'setSidebarHeaderFocused', value: true })
      // Re-setting focus to sidebar (e.g. via setSidebarTab which
      // also normalizes focus) should not reset header focus.
      state = applyLogInkAction(state, { type: 'setFocus', value: 'sidebar' })
      expect(state.sidebarHeaderFocused).toBe(true)
    })
  })

  // Status surface group header focus (#791 follow-up) — same shape
  // as `sidebarHeaderFocused` but scoped to the worktree status
  // surface, where the cursor escapes upward onto the active group's
  // header (Staged / Unstaged / Untracked) instead of the sidebar's
  // tab header.
  describe('statusGroupHeaderFocused', () => {
    it('defaults to false', () => {
      expect(createLogInkState(rows).statusGroupHeaderFocused).toBe(false)
    })

    it('setStatusGroupHeaderFocused toggles the flag', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setStatusGroupHeaderFocused', value: true })
      expect(state.statusGroupHeaderFocused).toBe(true)
      state = applyLogInkAction(state, { type: 'setStatusGroupHeaderFocused', value: false })
      expect(state.statusGroupHeaderFocused).toBe(false)
    })

    it('clears when focus moves away from commits', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setStatusGroupHeaderFocused', value: true })
      expect(state.statusGroupHeaderFocused).toBe(true)
      state = applyLogInkAction(state, { type: 'setFocus', value: 'sidebar' })
      expect(state.statusGroupHeaderFocused).toBe(false)
    })

    it('clears on Tab / Shift+Tab cycling', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setStatusGroupHeaderFocused', value: true })
      state = applyLogInkAction(state, { type: 'focusNext' })
      expect(state.statusGroupHeaderFocused).toBe(false)
    })

    it('clears when the cursor moves to a real file (moveWorktreeFile)', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setStatusGroupHeaderFocused', value: true })
      state = applyLogInkAction(state, { type: 'moveWorktreeFile', delta: 1, fileCount: 4 })
      expect(state.statusGroupHeaderFocused).toBe(false)
    })

    it('clears when the filter mask changes (groups recompose)', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setStatusGroupHeaderFocused', value: true })
      state = applyLogInkAction(state, { type: 'toggleStatusFilterMask', kind: 'staged' })
      expect(state.statusGroupHeaderFocused).toBe(false)
    })

    it('clears when leaving the status view (popView away from status)', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'status' })
      state = applyLogInkAction(state, { type: 'setStatusGroupHeaderFocused', value: true })
      expect(state.statusGroupHeaderFocused).toBe(true)
      state = applyLogInkAction(state, { type: 'popView' })
      expect(state.statusGroupHeaderFocused).toBe(false)
    })
  })

  describe('jumpToStatusGroup', () => {
    it('snaps the worktree file index to the target and clears header focus', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setStatusGroupHeaderFocused', value: true })
      state = applyLogInkAction(state, { type: 'jumpToStatusGroup', targetIndex: 3 })
      expect(state.selectedWorktreeFileIndex).toBe(3)
      expect(state.statusGroupHeaderFocused).toBe(false)
      expect(state.worktreeDiffOffset).toBe(0)
    })

    it('clamps a negative target to 0', () => {
      const state = applyLogInkAction(createLogInkState(rows), {
        type: 'jumpToStatusGroup',
        targetIndex: -5,
      })
      expect(state.selectedWorktreeFileIndex).toBe(0)
    })
  })

  // #806 follow-up — tabbed inspector for short terminals.
  describe('inspectorTab', () => {
    it('defaults to inspector', () => {
      const state = createLogInkState(rows)
      expect(state.inspectorTab).toBe('inspector')
    })

    it('setInspectorTab snaps to the requested tab', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setInspectorTab', value: 'actions' })
      expect(state.inspectorTab).toBe('actions')
      state = applyLogInkAction(state, { type: 'setInspectorTab', value: 'inspector' })
      expect(state.inspectorTab).toBe('inspector')
    })

    it('cycleInspectorTab toggles between inspector and actions', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'cycleInspectorTab', delta: 1 })
      expect(state.inspectorTab).toBe('actions')
      state = applyLogInkAction(state, { type: 'cycleInspectorTab', delta: 1 })
      expect(state.inspectorTab).toBe('inspector')
      state = applyLogInkAction(state, { type: 'cycleInspectorTab', delta: -1 })
      expect(state.inspectorTab).toBe('actions')
    })

    it('switching tabs resets inspectorActionIndex to 0', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveInspectorAction', delta: 3, actionCount: 8 })
      expect(state.inspectorActionIndex).toBe(3)
      state = applyLogInkAction(state, { type: 'cycleInspectorTab', delta: 1 })
      expect(state.inspectorActionIndex).toBe(0)
      state = applyLogInkAction(state, { type: 'moveInspectorAction', delta: 4, actionCount: 8 })
      state = applyLogInkAction(state, { type: 'setInspectorTab', value: 'inspector' })
      expect(state.inspectorActionIndex).toBe(0)
    })
  })

  // Inspector Actions cursor (#791 follow-up). Mirrors the
  // moveDetailFile / moveBranch shape — clamp on count, reset on tab
  // switch.
  describe('inspectorActionIndex', () => {
    it('defaults to 0', () => {
      expect(createLogInkState(rows).inspectorActionIndex).toBe(0)
    })

    it('moveInspectorAction clamps to [0, count - 1]', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveInspectorAction', delta: 5, actionCount: 3 })
      expect(state.inspectorActionIndex).toBe(2)
      state = applyLogInkAction(state, { type: 'moveInspectorAction', delta: -10, actionCount: 3 })
      expect(state.inspectorActionIndex).toBe(0)
    })

    it('resetInspectorActionIndex snaps back to 0', () => {
      let state = applyLogInkAction(createLogInkState(rows), {
        type: 'moveInspectorAction',
        delta: 4,
        actionCount: 8,
      })
      expect(state.inspectorActionIndex).toBe(4)
      state = applyLogInkAction(state, { type: 'resetInspectorActionIndex' })
      expect(state.inspectorActionIndex).toBe(0)
    })
  })

  // Boot loading flag (#808). Drives the "Loading commits…"
  // placeholder + the "loading commits" header indicator while the
  // deferred commit-log fetch is in flight on TUI mount.
  describe('bootLoading', () => {
    it('defaults to false', () => {
      expect(createLogInkState(rows).bootLoading).toBe(false)
    })

    it('createLogInkState honors the bootLoading option', () => {
      expect(createLogInkState([], { bootLoading: true }).bootLoading).toBe(true)
    })

    it('setBootLoading toggles the flag', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setBootLoading', value: true })
      expect(state.bootLoading).toBe(true)
      state = applyLogInkAction(state, { type: 'setBootLoading', value: false })
      expect(state.bootLoading).toBe(false)
    })

    it('replaceRows clears bootLoading once rows arrive', () => {
      let state = createLogInkState([], { bootLoading: true })
      expect(state.bootLoading).toBe(true)
      state = applyLogInkAction(state, { type: 'replaceRows', rows })
      expect(state.bootLoading).toBe(false)
      expect(state.commits.length).toBeGreaterThan(0)
    })
  })

  describe('conflicts view', () => {
    it('initializes selectedConflictFileIndex to 0', () => {
      const state = createLogInkState(rows)
      expect(state.selectedConflictFileIndex).toBe(0)
    })

    it('moves the conflict file cursor within bounds', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveConflictFile', delta: 1, count: 5 })
      expect(state.selectedConflictFileIndex).toBe(1)
      state = applyLogInkAction(state, { type: 'moveConflictFile', delta: 1, count: 5 })
      expect(state.selectedConflictFileIndex).toBe(2)
    })

    it('clamps the conflict file cursor at list bounds', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveConflictFile', delta: -1, count: 3 })
      expect(state.selectedConflictFileIndex).toBe(0)
      state = applyLogInkAction(state, { type: 'moveConflictFile', delta: 10, count: 3 })
      expect(state.selectedConflictFileIndex).toBe(2)
    })

    it('pushes the conflicts view onto the navigation stack', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'conflicts' })
      expect(state.activeView).toBe('conflicts')
      expect(state.viewStack).toEqual(['history', 'conflicts'])
    })

    it('pops back from the conflicts view', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'conflicts' })
      state = applyLogInkAction(state, { type: 'popView' })
      expect(state.activeView).toBe('history')
      expect(state.viewStack).toEqual(['history'])
    })
  })

  describe('status message kind (info / error / success)', () => {
    it('defaults to no kind when setStatus is called without one', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setStatus', value: 'hello' })
      expect(state.statusMessage).toBe('hello')
      expect(state.statusKind).toBeUndefined()
    })

    it('preserves the kind across error / success / info transitions', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setStatus', value: 'oops', kind: 'error' })
      expect(state.statusKind).toBe('error')

      state = applyLogInkAction(state, { type: 'setStatus', value: 'yay', kind: 'success' })
      expect(state.statusKind).toBe('success')

      // Explicit 'info' clears the kind back to undefined so the error
      // styling doesn't bleed through.
      state = applyLogInkAction(state, { type: 'setStatus', value: 'fyi', kind: 'info' })
      expect(state.statusKind).toBeUndefined()
    })

    it('clearing the message clears the kind', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setStatus', value: 'oops', kind: 'error' })
      state = applyLogInkAction(state, { type: 'setStatus', value: undefined })
      expect(state.statusMessage).toBeUndefined()
      expect(state.statusKind).toBeUndefined()
    })
  })

  // Pure split-plan overlay logic now lives in `splitPlanState.test.ts`
  // alongside its extracted slice (#1723 / originally #907) — none of
  // it depends on composition-root behavior, so nothing stays here.

  describe('recent-commit markers', () => {
    it('markRecentCommits records the hash list with the action-supplied timestamp', () => {
      // Audit finding #9: `markedAt` is now part of the action payload
      // so the reducer stays pure. The dispatcher (in app.ts) calls
      // `Date.now()` and passes the result; the reducer just stores it.
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, {
        type: 'markRecentCommits',
        hashes: ['abc123', 'def456'],
        markedAt: 1234567890,
      })

      expect(state.recentCommitHashes?.hashes).toEqual(['abc123', 'def456'])
      expect(state.recentCommitHashes?.markedAt).toBe(1234567890)
    })

    it('markRecentCommits with empty list closes the marker', () => {
      // Allows callers to clear the marker early via the same action
      // shape — useful when a follow-up op fires before the auto-
      // clear timeout and we want to wipe old marks first.
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, {
        type: 'markRecentCommits',
        hashes: ['abc123'],
        markedAt: 1,
      })
      state = applyLogInkAction(state, { type: 'markRecentCommits', hashes: [], markedAt: 2 })
      expect(state.recentCommitHashes).toBeUndefined()
    })

    it('clearRecentCommits closes the marker', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, {
        type: 'markRecentCommits',
        hashes: ['abc123'],
        markedAt: 1,
      })
      state = applyLogInkAction(state, { type: 'clearRecentCommits' })
      expect(state.recentCommitHashes).toBeUndefined()
    })

    it('overwriting markRecentCommits replaces the previous list', () => {
      // If a second op fires before the first's auto-clear, the
      // newer hash set should win — old marks shouldn't bleed into
      // the new operation's set.
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, {
        type: 'markRecentCommits',
        hashes: ['old1', 'old2'],
        markedAt: 1,
      })
      state = applyLogInkAction(state, {
        type: 'markRecentCommits',
        hashes: ['new1'],
        markedAt: 2,
      })

      expect(state.recentCommitHashes?.hashes).toEqual(['new1'])
    })
  })

  describe('repoStack foundation (#931)', () => {
    it('initializes the state with a single root frame labeled "root"', () => {
      const state = createLogInkState(rows)
      expect(state.repoStack).toHaveLength(1)
      expect(state.repoStack[0].label).toBe('root')
      expect(state.repoStack[0].parentReturn).toBeUndefined()
      expect(state.repoStack[0].entryRange).toBeUndefined()
    })

    it('uses the supplied repoLabel for the root frame', () => {
      const state = createLogInkState(rows, { repoLabel: 'coco' })
      expect(state.repoStack[0].label).toBe('coco')
    })

    it('records the supplied repoWorkdir on the root frame', () => {
      const state = createLogInkState(rows, { repoLabel: 'coco', repoWorkdir: '/abs/coco' })
      expect(state.repoStack[0].workdir).toBe('/abs/coco')
    })

    it('leaves workdir undefined on the root frame when repoWorkdir is omitted', () => {
      const state = createLogInkState(rows)
      expect(state.repoStack[0].workdir).toBeUndefined()
    })

    it('getActiveLogInkRepoFrame returns the top of the stack', () => {
      const state = createLogInkState(rows, { repoLabel: 'coco' })
      expect(getActiveLogInkRepoFrame(state).label).toBe('coco')
    })

    it('isLogInkNestedRepo is false for a freshly-created state', () => {
      const state = createLogInkState(rows)
      expect(isLogInkNestedRepo(state)).toBe(false)
    })

    it('isLogInkNestedRepo returns true when the stack has more than one frame', () => {
      const state = createLogInkState(rows, { repoLabel: 'coco' })
      // Direct mutation here — the push/pop actions don't exist yet
      // (PR 2). This test asserts the selector reads the stack
      // shape correctly; the action paths get their own tests when
      // they land.
      const nested = {
        ...state,
        repoStack: [...state.repoStack, { label: 'vendor/lib' }],
      }
      expect(isLogInkNestedRepo(nested)).toBe(true)
      expect(getActiveLogInkRepoFrame(nested).label).toBe('vendor/lib')
    })

    it('getLogInkRepoStackLabels returns ordered labels root-first', () => {
      const state = createLogInkState(rows, { repoLabel: 'coco' })
      const nested = {
        ...state,
        repoStack: [
          ...state.repoStack,
          { label: 'vendor/lib' },
          { label: 'vendor/lib/deep' },
        ],
      }
      expect(getLogInkRepoStackLabels(nested)).toEqual([
        'coco', 'vendor/lib', 'vendor/lib/deep',
      ])
    })
  })

  describe('pushRepoFrame / popRepoFrame (#931 PR 2)', () => {
    function nudgeParentState(s: ReturnType<typeof createLogInkState>) {
      // Move the parent off defaults so we can verify snapshot + restore.
      // Filter first so the move's clamping is computed against the
      // filtered list, not retroactively shrunken by the filter.
      let next = applyLogInkAction(s, { type: 'setFilter', value: 'feat:' })
      next = applyLogInkAction(next, { type: 'move', delta: 1 })
      next = applyLogInkAction(next, { type: 'setActiveView', value: 'branches' })
      return next
    }

    it('pushRepoFrame appends a new frame with the supplied label', () => {
      const before = createLogInkState(rows, { repoLabel: 'coco' })
      const after = applyLogInkAction(before, {
        type: 'pushRepoFrame',
        label: 'vendor/lib',
      })
      expect(after.repoStack).toHaveLength(2)
      expect(after.repoStack[0].label).toBe('coco')
      expect(after.repoStack[1].label).toBe('vendor/lib')
      expect(isLogInkNestedRepo(after)).toBe(true)
      expect(getActiveLogInkRepoFrame(after).label).toBe('vendor/lib')
    })

    it('pushRepoFrame snapshots the parent view position into parentReturn', () => {
      const before = nudgeParentState(createLogInkState(rows, { repoLabel: 'coco' }))
      const after = applyLogInkAction(before, {
        type: 'pushRepoFrame',
        label: 'vendor/lib',
      })
      const ret = after.repoStack[1].parentReturn
      // The snapshot now also captures sidebar tab + sort preferences
      // so pop can restore them (#995). Use defaults from createLogInkState
      // since `nudgeParentState` doesn't touch those fields.
      expect(ret).toEqual({
        activeView: 'branches',
        viewStack: before.viewStack,
        diffSource: undefined,
        stashDiffRef: undefined,
        compareHead: undefined,
        selectedIndex: before.selectedIndex,
        selectedFileIndex: 0,
        selectedSubmoduleIndex: 0,
        filter: 'feat:',
        sidebarTab: before.sidebarTab,
        userSidebarTab: before.userSidebarTab,
        branchSort: before.branchSort,
        tagSort: before.tagSort,
        // Per-repo state captured for the pop restore (#1343).
        compareBase: undefined,
        blamePath: undefined,
        fileHistoryPath: undefined,
        changelogCache: {},
        selectedWorktreeFileIndex: 0,
        selectedBranchIndex: 0,
        selectedTagIndex: 0,
        selectedStashIndex: 0,
        selectedWorktreeListIndex: 0,
        selectedConflictFileIndex: 0,
        selectedReflogIndex: 0,
        selectedRemoteIndex: 0,
        selectedBlameIndex: 0,
        selectedFileHistoryIndex: 0,
        selectedIssueIndex: 0,
        selectedPullRequestTriageIndex: 0,
      })
      expect(before.selectedIndex).toBeGreaterThan(0)
    })

    it('popRepoFrame restores the parent\'s sidebar tab and sort modes (#995)', () => {
      // Simulate the user-reported bleed: user changes sidebar tab +
      // branch sort inside a submodule frame, then pops back to the
      // parent. The parent should snap back to whatever it had pre-push,
      // not inherit the submodule's choices.
      const root = applyLogInkAction(createLogInkState(rows, { repoLabel: 'coco' }), {
        type: 'setSidebarTab',
        value: 'tags',
      })
      // Cycle branch sort once so the parent's value diverges from the
      // default for the assertion.
      const parent = applyLogInkAction(root, { type: 'cycleBranchSort' })
      const parentBranchSort = parent.branchSort
      const parentSidebarTab = parent.userSidebarTab
      expect(parentSidebarTab).toBe('tags')

      // Push into a submodule, change sidebar tab + cycle sort again,
      // then pop. The pop should restore the parent's pre-push values.
      const pushed = applyLogInkAction(parent, {
        type: 'pushRepoFrame',
        label: 'vendor/lib',
      })
      const insideSubmodule = applyLogInkAction(
        applyLogInkAction(pushed, { type: 'setSidebarTab', value: 'stashes' }),
        { type: 'cycleBranchSort' }
      )
      expect(insideSubmodule.userSidebarTab).toBe('stashes')
      expect(insideSubmodule.branchSort).not.toBe(parentBranchSort)

      const popped = applyLogInkAction(insideSubmodule, { type: 'popRepoFrame' })
      expect(popped.userSidebarTab).toBe(parentSidebarTab)
      expect(popped.sidebarTab).toBe(parentSidebarTab)
      expect(popped.branchSort).toBe(parentBranchSort)
      // Submodule's state is gone; only the root frame remains.
      expect(popped.repoStack).toHaveLength(1)
    })

    // #1452 — parentReturn only captures the index, not the id mirror
    // (adding it is deferred; nothing reads these fields outside the
    // selectors yet, so a cleared mirror right after push/pop is
    // harmless — the selectors fall back to the restored index, which
    // is exactly correct). Push and pop must each clear the mirror
    // rather than leaking the other frame's id across the boundary.
    it('pushRepoFrame and popRepoFrame clear the id mirrors', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveBranch', delta: 1, count: 10, id: 'feature' })
      expect(state.selectedBranchId).toBe('feature')

      const pushed = applyLogInkAction(state, { type: 'pushRepoFrame', label: 'vendor/lib' })
      expect(pushed.selectedBranchId).toBeUndefined()

      const insideSubmodule = applyLogInkAction(pushed, {
        type: 'moveBranch', delta: 1, count: 10, id: 'submodule-branch',
      })
      const popped = applyLogInkAction(insideSubmodule, { type: 'popRepoFrame' })
      expect(popped.selectedBranchId).toBeUndefined()
      expect(popped.selectedBranchIndex).toBe(state.selectedBranchIndex)
    })

    // Same discipline for the worktree id mirror (#1452 worktree flip).
    it('pushRepoFrame and popRepoFrame clear selectedWorktreeListId too', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveWorktreeListEntry', delta: 1, count: 10, id: '/repo-feature' })
      expect(state.selectedWorktreeListId).toBe('/repo-feature')

      const pushed = applyLogInkAction(state, { type: 'pushRepoFrame', label: 'vendor/lib' })
      expect(pushed.selectedWorktreeListId).toBeUndefined()

      const insideSubmodule = applyLogInkAction(pushed, {
        type: 'moveWorktreeListEntry', delta: 1, count: 10, id: '/submodule-worktree',
      })
      const popped = applyLogInkAction(insideSubmodule, { type: 'popRepoFrame' })
      expect(popped.selectedWorktreeListId).toBeUndefined()
      expect(popped.selectedWorktreeListIndex).toBe(state.selectedWorktreeListIndex)
    })

    // Same discipline for the submodule / remote id mirrors (#1452
    // submodule/remote flip).
    it('pushRepoFrame and popRepoFrame clear selectedSubmoduleId and selectedRemoteId too', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveSubmodule', delta: 1, count: 10, id: '/vendor/b' })
      state = applyLogInkAction(state, { type: 'moveRemote', delta: 1, count: 10, id: 'upstream' })
      expect(state.selectedSubmoduleId).toBe('/vendor/b')
      expect(state.selectedRemoteId).toBe('upstream')

      const pushed = applyLogInkAction(state, { type: 'pushRepoFrame', label: 'vendor/lib' })
      expect(pushed.selectedSubmoduleId).toBeUndefined()
      expect(pushed.selectedRemoteId).toBeUndefined()

      const insideSubmodule = applyLogInkAction(pushed, {
        type: 'moveSubmodule', delta: 1, count: 10, id: '/submodule-vendor',
      })
      const popped = applyLogInkAction(insideSubmodule, { type: 'popRepoFrame' })
      expect(popped.selectedSubmoduleId).toBeUndefined()
      expect(popped.selectedRemoteId).toBeUndefined()
      expect(popped.selectedSubmoduleIndex).toBe(state.selectedSubmoduleIndex)
      expect(popped.selectedRemoteIndex).toBe(state.selectedRemoteIndex)
    })

    it('pushRepoFrame and popRepoFrame clear selectedIssueId and selectedPullRequestTriageId too', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'moveIssue', delta: 1, count: 10, id: '7' })
      state = applyLogInkAction(state, { type: 'movePullRequestTriage', delta: 1, count: 10, id: '9' })
      expect(state.selectedIssueId).toBe('7')
      expect(state.selectedPullRequestTriageId).toBe('9')

      const pushed = applyLogInkAction(state, { type: 'pushRepoFrame', label: 'vendor/lib' })
      expect(pushed.selectedIssueId).toBeUndefined()
      expect(pushed.selectedPullRequestTriageId).toBeUndefined()

      const insideSubmodule = applyLogInkAction(pushed, {
        type: 'moveIssue', delta: 1, count: 10, id: '42',
      })
      const popped = applyLogInkAction(insideSubmodule, { type: 'popRepoFrame' })
      expect(popped.selectedIssueId).toBeUndefined()
      expect(popped.selectedPullRequestTriageId).toBeUndefined()
      expect(popped.selectedIssueIndex).toBe(state.selectedIssueIndex)
      expect(popped.selectedPullRequestTriageIndex).toBe(state.selectedPullRequestTriageIndex)
    })

    // Regression: popping a frame entered FROM a commit diff used to
    // restore `viewStack: ['diff']` (one element — Esc and `<` both dead)
    // with `diffSource` cleared by navigation inside the submodule, so
    // the diff rendered source-less and picked up staging key handling.
    it('popRepoFrame restores the full parent view stack and diff identity', () => {
      let parent = createLogInkState(rows, { repoLabel: 'coco' })
      parent = applyLogInkAction(parent, {
        type: 'navigateOpenDiffForCommit',
        sha: parent.filteredCommits[0].hash,
        commitIndex: 0,
      })
      expect(parent.viewStack).toEqual(['history', 'diff'])
      expect(parent.diffSource).toBe('commit')

      let inside = applyLogInkAction(parent, {
        type: 'pushRepoFrame',
        label: 'vendor/lib',
      })
      // Navigate around inside the submodule — this clears the shared
      // diffSource on the live state, which is exactly why pop must
      // restore it from the captured parentReturn.
      inside = applyLogInkAction(inside, { type: 'pushView', value: 'branches' })
      expect(inside.diffSource).toBeUndefined()

      const popped = applyLogInkAction(inside, { type: 'popRepoFrame' })
      expect(popped.activeView).toBe('diff')
      expect(popped.viewStack).toEqual(['history', 'diff'])
      expect(popped.diffSource).toBe('commit')
    })

    it('pushRepoFrame records the optional entryRange', () => {
      const before = createLogInkState(rows, { repoLabel: 'coco' })
      const after = applyLogInkAction(before, {
        type: 'pushRepoFrame',
        label: 'vendor/lib',
        entryRange: { oldSha: 'aaa', newSha: 'bbb' },
      })
      expect(after.repoStack[1].entryRange).toEqual({ oldSha: 'aaa', newSha: 'bbb' })
    })

    it('pushRepoFrame records the optional workdir on the new frame', () => {
      const before = createLogInkState(rows, { repoLabel: 'coco', repoWorkdir: '/abs/coco' })
      const after = applyLogInkAction(before, {
        type: 'pushRepoFrame',
        label: 'vendor/lib',
        workdir: '/abs/coco/vendor/lib',
      })
      expect(after.repoStack[1].workdir).toBe('/abs/coco/vendor/lib')
      // Root frame's workdir is preserved on push.
      expect(after.repoStack[0].workdir).toBe('/abs/coco')
    })

    it('pushRepoFrame resets per-frame navigation state', () => {
      const before = nudgeParentState(createLogInkState(rows, { repoLabel: 'coco' }))
      const after = applyLogInkAction(before, {
        type: 'pushRepoFrame',
        label: 'vendor/lib',
      })
      expect(after.activeView).toBe('history')
      expect(after.viewStack).toEqual(['history'])
      expect(after.selectedIndex).toBe(0)
      expect(after.selectedFileIndex).toBe(0)
      expect(after.selectedSubmoduleIndex).toBe(0)
      expect(after.filter).toBe('')
      expect(after.filterMode).toBe(false)
    })

    it('pushRepoFrame preserves carry-over preferences (sort modes, palette, sidebar)', () => {
      let before = createLogInkState(rows, { repoLabel: 'coco' })
      before = applyLogInkAction(before, { type: 'setSidebarTab', value: 'tags' })
      before = applyLogInkAction(before, { type: 'cycleBranchSort' })
      before = applyLogInkAction(before, { type: 'recordPaletteRecent', value: 'history.goHome' })

      const after = applyLogInkAction(before, { type: 'pushRepoFrame', label: 'vendor/lib' })
      expect(after.sidebarTab).toBe(before.sidebarTab)
      expect(after.userSidebarTab).toBe(before.userSidebarTab)
      expect(after.branchSort).toBe(before.branchSort)
      expect(after.paletteRecent).toEqual(before.paletteRecent)
    })

    it('popRepoFrame is a no-op at the root frame', () => {
      const before = createLogInkState(rows, { repoLabel: 'coco' })
      const after = applyLogInkAction(before, { type: 'popRepoFrame' })
      expect(after.repoStack).toHaveLength(1)
      expect(isLogInkNestedRepo(after)).toBe(false)
    })

    it('pushRepoFrame followed by popRepoFrame restores the parent position', () => {
      const before = nudgeParentState(createLogInkState(rows, { repoLabel: 'coco' }))
      const pushed = applyLogInkAction(before, {
        type: 'pushRepoFrame',
        label: 'vendor/lib',
      })
      const popped = applyLogInkAction(pushed, { type: 'popRepoFrame' })

      expect(popped.repoStack).toHaveLength(1)
      expect(popped.activeView).toBe('branches')
      expect(popped.viewStack).toEqual(['branches'])
      expect(popped.selectedIndex).toBe(before.selectedIndex)
      expect(popped.filter).toBe('feat:')
      expect(isLogInkNestedRepo(popped)).toBe(false)
    })

    it('popRepoFrame on a 3-deep stack drops only the top frame', () => {
      let state = createLogInkState(rows, { repoLabel: 'coco' })
      state = applyLogInkAction(state, { type: 'pushRepoFrame', label: 'vendor/lib' })
      state = applyLogInkAction(state, { type: 'pushRepoFrame', label: 'vendor/lib/deep' })
      expect(getLogInkRepoStackLabels(state)).toEqual(['coco', 'vendor/lib', 'vendor/lib/deep'])

      state = applyLogInkAction(state, { type: 'popRepoFrame' })
      expect(getLogInkRepoStackLabels(state)).toEqual(['coco', 'vendor/lib'])
      expect(isLogInkNestedRepo(state)).toBe(true)
    })

    it('pushRepoFrame clears in-flight confirmation state', () => {
      let before = createLogInkState(rows, { repoLabel: 'coco' })
      before = applyLogInkAction(before, {
        type: 'setPendingConfirmation',
        value: 'revert-file',
        payload: 'src/foo.ts',
      })
      const after = applyLogInkAction(before, { type: 'pushRepoFrame', label: 'vendor/lib' })
      expect(after.pendingConfirmationId).toBeUndefined()
      expect(after.pendingConfirmationPayload).toBeUndefined()
    })

    // #1343 — compare base, blame / file-history paths, the branch-keyed
    // changelog cache, and per-list cursors are all meaningful only
    // against the repo that produced them. Push must clear them (a
    // parent-repo path or ref must never hydrate against the
    // submodule's git) and pop must restore the parent's.
    it('pushRepoFrame clears per-repo state; popRepoFrame restores it (#1343)', () => {
      let parent = createLogInkState(rows, { repoLabel: 'coco' })
      parent = applyLogInkAction(parent, {
        type: 'setCompareBase',
        value: { kind: 'branch', ref: 'main', label: 'main' },
      })
      parent = applyLogInkAction(parent, { type: 'navigateOpenBlameForPath', path: 'src/app.ts' })
      parent = applyLogInkAction(parent, {
        type: 'navigateOpenFileHistoryForPath',
        path: 'src/app.ts',
      })
      parent = applyLogInkAction(parent, {
        type: 'setChangelogReady',
        branch: 'main',
        text: '## parent changelog',
        baseLabel: 'origin/main',
        generatedAt: 1750000000000,
      })
      parent = applyLogInkAction(parent, { type: 'moveBranch', delta: 3, count: 10 })

      parent = applyLogInkAction(parent, {
        type: 'setPendingChoice',
        value: {
          id: 'diverged-pull-recovery',
          title: 'Branches diverged',
          options: [{ key: 'r', label: 'Pull with rebase', workflowId: 'pull-rebase-current' }],
        },
      })
      parent = applyLogInkAction(parent, {
        type: 'setWorktreeCheckoutConflict',
        value: { branch: 'feat/x', worktreePath: '/abs/coco/.worktrees/feat-x', dirty: false },
      })

      const inside = applyLogInkAction(parent, {
        type: 'pushRepoFrame',
        label: 'vendor/lib',
        workdir: '/abs/coco/vendor/lib',
      })
      expect(inside.compareBase).toBeUndefined()
      expect(inside.blamePath).toBeUndefined()
      expect(inside.fileHistoryPath).toBeUndefined()
      expect(inside.changelogCache).toEqual({})
      expect(inside.selectedBranchIndex).toBe(0)
      // #1429 — a choice raised in the parent references the parent's git
      // call; it must not survive the drill-in to be answered against the
      // child frame.
      expect(inside.pendingChoice).toBeUndefined()
      expect(inside.worktreeCheckoutConflict).toBeUndefined()

      const popped = applyLogInkAction(inside, { type: 'popRepoFrame' })
      expect(popped.compareBase).toEqual({ kind: 'branch', ref: 'main', label: 'main' })
      expect(popped.blamePath).toBe('src/app.ts')
      expect(popped.fileHistoryPath).toBe('src/app.ts')
      expect(popped.changelogCache.main).toBeDefined()
      expect(popped.selectedBranchIndex).toBe(3)
      // Not restored on pop — they're transient like pendingConfirmationId,
      // not carried in parentReturn.
      expect(popped.pendingChoice).toBeUndefined()
      expect(popped.worktreeCheckoutConflict).toBeUndefined()
    })
  })
})

describe('issue / pull-request triage navigation (#882 phase 3)', () => {
  it('createLogInkState seeds selectedIssueIndex / selectedPullRequestTriageIndex to 0', () => {
    const state = createLogInkState(rows)
    expect(state.selectedIssueIndex).toBe(0)
    expect(state.selectedPullRequestTriageIndex).toBe(0)
  })

  it('moveIssue advances the cursor and clamps to count - 1', () => {
    let state = createLogInkState(rows)

    state = applyLogInkAction(state, { type: 'moveIssue', delta: 3, count: 5 })
    expect(state.selectedIssueIndex).toBe(3)

    // Clamps at count - 1 — no wrap.
    state = applyLogInkAction(state, { type: 'moveIssue', delta: 10, count: 5 })
    expect(state.selectedIssueIndex).toBe(4)

    // Negative delta clamps at 0.
    state = applyLogInkAction(state, { type: 'moveIssue', delta: -99, count: 5 })
    expect(state.selectedIssueIndex).toBe(0)
  })

  it('movePullRequestTriage advances independently from selectedIssueIndex', () => {
    let state = createLogInkState(rows)

    state = applyLogInkAction(state, { type: 'moveIssue', delta: 2, count: 5 })
    state = applyLogInkAction(state, { type: 'movePullRequestTriage', delta: 1, count: 3 })

    expect(state.selectedIssueIndex).toBe(2)
    expect(state.selectedPullRequestTriageIndex).toBe(1)
  })

  it('move actions clear any pending chord prefix', () => {
    let state = createLogInkState(rows)
    state = { ...state, pendingKey: 'g' }

    state = applyLogInkAction(state, { type: 'moveIssue', delta: 1, count: 5 })
    expect(state.pendingKey).toBeUndefined()
  })

  it('pushView accepts the new triage view ids', () => {
    let state = createLogInkState(rows)

    state = applyLogInkAction(state, { type: 'pushView', value: 'issues' })
    expect(state.activeView).toBe('issues')
    expect(state.viewStack).toContain('issues')

    state = applyLogInkAction(state, { type: 'pushView', value: 'pull-request-triage' })
    expect(state.activeView).toBe('pull-request-triage')
    expect(state.viewStack).toContain('pull-request-triage')
  })
})

describe('triage filter preset cycling (#882 phase 6)', () => {
  it('seeds selectedIssueFilter / selectedPullRequestFilter to "open"', () => {
    const state = createLogInkState(rows)
    expect(state.selectedIssueFilter).toBe('open')
    expect(state.selectedPullRequestFilter).toBe('open')
  })

  it('cycleIssueFilter advances through the preset list and wraps', () => {
    let state = createLogInkState(rows)
    expect(state.selectedIssueFilter).toBe('open')

    state = applyLogInkAction(state, { type: 'cycleIssueFilter' })
    expect(state.selectedIssueFilter).toBe('closed')

    state = applyLogInkAction(state, { type: 'cycleIssueFilter' })
    expect(state.selectedIssueFilter).toBe('mine')

    state = applyLogInkAction(state, { type: 'cycleIssueFilter' })
    expect(state.selectedIssueFilter).toBe('assigned')

    state = applyLogInkAction(state, { type: 'cycleIssueFilter' })
    expect(state.selectedIssueFilter).toBe('open')
  })

  it('cycleIssueFilter snaps the cursor to the top of the (newly filtered) list', () => {
    let state = createLogInkState(rows)
    state = { ...state, selectedIssueIndex: 5 }

    state = applyLogInkAction(state, { type: 'cycleIssueFilter' })
    expect(state.selectedIssueIndex).toBe(0)
  })

  it('cycleIssueFilter clears selectedIssueId alongside the index (#1452)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'moveIssue', delta: 1, count: 5, id: '7' })
    expect(state.selectedIssueId).toBe('7')

    state = applyLogInkAction(state, { type: 'cycleIssueFilter' })
    expect(state.selectedIssueId).toBeUndefined()
  })

  it('cyclePullRequestTriageFilter advances and wraps independently', () => {
    let state = createLogInkState(rows)

    state = applyLogInkAction(state, { type: 'cyclePullRequestTriageFilter' })
    expect(state.selectedPullRequestFilter).toBe('draft')

    // Cycling PRs leaves the issue preset alone.
    expect(state.selectedIssueFilter).toBe('open')
  })

  it('cyclePullRequestTriageFilter clears selectedPullRequestTriageId alongside the index (#1452)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'movePullRequestTriage', delta: 1, count: 5, id: '9' })
    expect(state.selectedPullRequestTriageId).toBe('9')

    state = applyLogInkAction(state, { type: 'cyclePullRequestTriageFilter' })
    expect(state.selectedPullRequestTriageId).toBeUndefined()
  })

  it('cycle actions clear any pending chord prefix', () => {
    let state = createLogInkState(rows)
    state = { ...state, pendingKey: 'g' }

    state = applyLogInkAction(state, { type: 'cycleIssueFilter' })
    expect(state.pendingKey).toBeUndefined()
  })

  describe('setPendingPullRequestBodyDraft (#881 phase 4)', () => {
    it('starts undefined and flips on / off via the action', () => {
      // The flag gates the Esc cancel binding in the input handler.
      // `startCreatePullRequest` sets it true before awaiting the
      // workflow and clears it in a `finally` so a thrown error can't
      // strand the user in a cancellable state.
      const state = createLogInkState(rows)
      expect(state.pendingPullRequestBodyDraft).toBeUndefined()

      const pending = applyLogInkAction(state, {
        type: 'setPendingPullRequestBodyDraft',
        value: true,
      })
      expect(pending.pendingPullRequestBodyDraft).toBe(true)

      const cleared = applyLogInkAction(pending, {
        type: 'setPendingPullRequestBodyDraft',
        value: false,
      })
      // Cleared to `undefined` rather than `false` so the flag's
      // absence is uniform — readers can shorthand the check with
      // `!state.pendingPullRequestBodyDraft` either way.
      expect(cleared.pendingPullRequestBodyDraft).toBeUndefined()
    })

    it('clears the pending key (chord prefix) on toggle', () => {
      // Same hygiene as the other dispatched actions: any incoming
      // dispatch resets a half-typed chord (`g`-prefix) so we don't
      // accumulate stale prefixes across async workflow events.
      const seeded = { ...createLogInkState(rows), pendingKey: 'g' }
      const next = applyLogInkAction(seeded, {
        type: 'setPendingPullRequestBodyDraft',
        value: true,
      })
      expect(next.pendingKey).toBeUndefined()
    })
  })

  // Pure theme-picker filter/cursor logic now lives in
  // `themePicker.test.ts` alongside its extracted slice (#1630 first
  // slice). This composition-root test stays here because it's the
  // overlay-exclusivity behavior `applyLogInkAction` layers on top of
  // the slice, not something the slice module itself owns.
  describe('theme picker', () => {
    it('toggleThemePicker opens/closes and closes other overlays', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'toggleHelp' })
      state = applyLogInkAction(state, { type: 'toggleThemePicker' })
      expect(state.showThemePicker).toBe(true)
      expect(state.showHelp).toBe(false)
      expect(state.showCommandPalette).toBe(false)

      state = applyLogInkAction(state, { type: 'toggleThemePicker' })
      expect(state.showThemePicker).toBe(false)
    })
  })
})

// #1135 v2 — peek is "focus the sidebar with a return ticket." The
// reducer holds the prior focus in `peekReturnFocus`; the toggle
// restores it, and any deliberate navigation (focus change or view
// push/pop) cancels the ticket so the user is never snapped back
// somewhere unexpected.
describe('sidebar peek (#1135 v2)', () => {
  it('togglePeek from a non-sidebar pane jumps to the sidebar and stores the return focus', () => {
    let state = createLogInkState(rows)
    expect(state.focus).toBe('commits')

    state = applyLogInkAction(state, { type: 'togglePeek' })
    expect(state.focus).toBe('sidebar')
    expect(state.peekReturnFocus).toBe('commits')
  })

  it('togglePeek again restores the stashed focus and clears the ticket', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'setFocus', value: 'detail' })
    state = applyLogInkAction(state, { type: 'togglePeek' })
    expect(state.focus).toBe('sidebar')
    expect(state.peekReturnFocus).toBe('detail')

    state = applyLogInkAction(state, { type: 'togglePeek' })
    expect(state.focus).toBe('detail')
    expect(state.peekReturnFocus).toBeUndefined()
  })

  it('togglePeek is a no-op when already focused on the sidebar', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'setFocus', value: 'sidebar' })
    state = applyLogInkAction(state, { type: 'togglePeek' })
    expect(state.focus).toBe('sidebar')
    expect(state.peekReturnFocus).toBeUndefined()
  })

  it('drilling into a view cancels a pending peek', () => {
    let state = applyLogInkAction(createLogInkState(rows), { type: 'togglePeek' })
    expect(state.peekReturnFocus).toBe('commits')

    state = applyLogInkAction(state, { type: 'pushView', value: 'branches' })
    expect(state.peekReturnFocus).toBeUndefined()
  })

  it('Tab (focusNext) cancels a pending peek', () => {
    let state = applyLogInkAction(createLogInkState(rows), { type: 'togglePeek' })
    expect(state.peekReturnFocus).toBe('commits')

    state = applyLogInkAction(state, { type: 'focusNext' })
    expect(state.peekReturnFocus).toBeUndefined()
  })
})

describe('worktree hunk navigation — viewport-derived current hunk (#1179)', () => {
  // @@ headers at line offsets 0, 10, 25, 40 → four hunks.
  const offsets = [0, 10, 25, 40]

  describe('hunkIndexAtOffset', () => {
    it('returns the last hunk whose header is at or above the viewport top', () => {
      expect(hunkIndexAtOffset(0, offsets)).toBe(0)
      expect(hunkIndexAtOffset(5, offsets)).toBe(0)   // inside hunk 1
      expect(hunkIndexAtOffset(10, offsets)).toBe(1)  // on hunk 2 header
      expect(hunkIndexAtOffset(30, offsets)).toBe(2)  // inside hunk 3
      expect(hunkIndexAtOffset(50, offsets)).toBe(3)  // past the last header
    })

    it('defaults to 0 with no hunks', () => {
      expect(hunkIndexAtOffset(99, [])).toBe(0)
    })
  })

  it('page-scrolling tracks the current hunk via the offset (#1185)', () => {
    let state = createLogInkState([])
    // ↑/↓ scroll lines; the current hunk derives from the offset.
    state = applyLogInkAction(state, { type: 'pageWorktreeDiff', delta: 30, lineCount: 53 })
    expect(state.worktreeDiffOffset).toBe(30)
    // Offset 30 sits inside hunk 3 (offsets 0/10/25/40) — derived, not stored.
    expect(hunkIndexAtOffset(state.worktreeDiffOffset, offsets)).toBe(2)
  })

  it('[`/`] jumps the offset onto a hunk header; the index derives from it', () => {
    let state = createLogInkState([])
    state = applyLogInkAction(state, { type: 'jumpWorktreeHunk', delta: 1, hunkOffsets: offsets })
    expect(state.worktreeDiffOffset).toBe(10)
    expect(hunkIndexAtOffset(state.worktreeDiffOffset, offsets)).toBe(1)
    state = applyLogInkAction(state, { type: 'jumpWorktreeHunk', delta: 1, hunkOffsets: offsets })
    expect(state.worktreeDiffOffset).toBe(25)
    expect(hunkIndexAtOffset(state.worktreeDiffOffset, offsets)).toBe(2)
  })
})

describe('PR-triage diff drill-in (#1363)', () => {
  it('navigateOpenDiffForPullRequest pushes the diff view tagged diffSource=pr', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'pull-request-triage' })
    state = applyLogInkAction(state, {
      type: 'navigateOpenDiffForPullRequest',
      number: 962,
      pullRequestIndex: 3,
    })
    expect(state.activeView).toBe('diff')
    expect(state.viewStack).toEqual(['history', 'pull-request-triage', 'diff'])
    expect(state.diffSource).toBe('pr')
    expect(state.prDiffNumber).toBe(962)
    expect(state.selectedPullRequestTriageIndex).toBe(3)
    // #1452 — action.number IS the target PR's id, set precisely here.
    expect(state.selectedPullRequestTriageId).toBe('962')
  })

  it('resets the scroll offsets and line-select anchor so the patch opens at the top', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pageDetailPreview', delta: 5, previewLineCount: 100 })
    expect(state.diffPreviewOffset).toBeGreaterThan(0)
    state = applyLogInkAction(state, { type: 'pushView', value: 'pull-request-triage' })
    state = applyLogInkAction(state, { type: 'navigateOpenDiffForPullRequest', number: 7 })
    expect(state.diffPreviewOffset).toBe(0)
    expect(state.worktreeDiffOffset).toBe(0)
    expect(state.diffLineSelectAnchor).toBeUndefined()
  })

  it('popping the diff view clears diffSource and prDiffNumber (mirrors stashDiffRef)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'pull-request-triage' })
    state = applyLogInkAction(state, { type: 'navigateOpenDiffForPullRequest', number: 962 })
    state = applyLogInkAction(state, { type: 'popView' })
    expect(state.activeView).toBe('pull-request-triage')
    expect(state.diffSource).toBeUndefined()
    expect(state.prDiffNumber).toBeUndefined()
  })

  it('pushing a non-diff view over the PR diff clears the PR diff identity', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'pull-request-triage' })
    state = applyLogInkAction(state, { type: 'navigateOpenDiffForPullRequest', number: 962 })
    state = applyLogInkAction(state, { type: 'pushView', value: 'history' })
    expect(state.prDiffNumber).toBeUndefined()
    expect(state.diffSource).toBeUndefined()
  })

  it('repo-frame push/pop round-trips the PR diff identity (#931 capture discipline)', () => {
    let state = createLogInkState(rows, { repoLabel: 'coco' })
    state = applyLogInkAction(state, { type: 'pushView', value: 'pull-request-triage' })
    state = applyLogInkAction(state, { type: 'navigateOpenDiffForPullRequest', number: 962 })
    state = applyLogInkAction(state, { type: 'pushRepoFrame', label: 'vendor/lib' })
    // The child frame opens on its own history view; any view push
    // inside it clears the carried diff identity (same shared-state
    // semantics as stashDiffRef — see LogInkRepoFrameReturn's doc).
    expect(state.activeView).toBe('history')
    state = applyLogInkAction(state, { type: 'popRepoFrame' })
    expect(state.activeView).toBe('diff')
    expect(state.diffSource).toBe('pr')
    expect(state.prDiffNumber).toBe(962)
  })
})
