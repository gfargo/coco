import { GitLogRow } from './data'
import {
  applyLogInkAction,
  createLogInkState,
  getLogInkSidebarTabs,
  getSelectedInkCommit,
  intentGoHome,
  intentOpenComposeForFile,
  intentOpenDiffForCommit,
  intentOpenDiffForWorktreeFile,
  scoreLogInkCommitFilter,
} from './inkViewModel'

const rows: GitLogRow[] = [
  {
    type: 'commit',
    graph: '*',
    shortHash: 'abc1234',
    hash: 'abc123456789',
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
    expect(state.sidebarTab).toBe('status')
    expect(state.showHelp).toBe(false)
    expect(state.showCommandPalette).toBe(false)
    expect(state.pendingMutationConfirmation).toBeUndefined()
  })

  it('supports workstation surface selection', () => {
    let state = createLogInkState(rows, { activeView: 'status' })

    expect(state.activeView).toBe('status')

    state = applyLogInkAction(state, { type: 'setActiveView', value: 'diff' })

    expect(state.activeView).toBe('diff')
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

    state = applyLogInkAction(state, { type: 'nextSidebarTab' })
    expect(state.sidebarTab).toBe('branches')

    state = applyLogInkAction(state, { type: 'previousSidebarTab' })
    expect(state.sidebarTab).toBe('status')

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
    expect(state.selectedWorktreeHunkIndex).toBe(1)

    state = applyLogInkAction(state, { type: 'setActiveView', value: 'status' })
    expect(state.worktreeDiffOffset).toBe(0)
    expect(state.selectedWorktreeHunkIndex).toBe(0)
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
    let state = createLogInkState(rows)

    state = applyLogInkAction(state, { type: 'toggleGraph' })
    state = applyLogInkAction(state, { type: 'toggleHelp' })
    state = applyLogInkAction(state, { type: 'toggleCommandPalette' })

    expect(state.fullGraph).toBe(true)
    expect(state.showHelp).toBe(false)
    expect(state.showCommandPalette).toBe(true)
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
      type: 'setPendingMutationConfirmation',
      value: 'revert-file',
    })
    expect(state.pendingMutationConfirmation).toBe('revert-file')
    expect(state.pendingConfirmationId).toBeUndefined()

    state = applyLogInkAction(state, { type: 'setPendingMutationConfirmation', value: undefined })
    expect(state.pendingMutationConfirmation).toBeUndefined()
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
      expect(state.selectedWorktreeHunkIndex).toBeGreaterThan(0)

      state = applyLogInkAction(state, { type: 'popView' })
      expect(state.activeView).toBe('history')
      expect(state.worktreeDiffOffset).toBe(0)
      expect(state.selectedWorktreeHunkIndex).toBe(0)
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
})
