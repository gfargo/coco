import { GitLogRow } from './data'
import {
  applyLogInkAction,
  createLogInkState,
  getLogInkSidebarTabs,
  getSelectedInkCommit,
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
})
