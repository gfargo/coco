import { GitLogRow } from './data'
import { getLogInkInputEvents, getLogInkPaletteExecuteEvents } from './inkInput'
import { applyLogInkAction, createLogInkState } from './inkViewModel'

const rows: GitLogRow[] = [
  {
    type: 'commit',
    graph: '*',
    shortHash: 'abc1234',
    hash: 'abc123456789',
    parents: ['def567890123'],
    date: '2026-04-29',
    author: 'Coco Test',
    refs: ['HEAD -> main'],
    message: 'feat: add log TUI interactions',
  },
  {
    type: 'commit',
    graph: '*',
    shortHash: 'def5678',
    hash: 'def567890123',
    parents: ['fed999900000'],
    date: '2026-04-30',
    author: 'Coco Test',
    refs: [],
    message: 'fix: polish log TUI',
  },
  {
    type: 'commit',
    graph: '*',
    shortHash: 'fed9999',
    hash: 'fed999900000',
    parents: [],
    date: '2026-05-01',
    author: 'Coco Test',
    refs: [],
    message: 'docs: update log TUI help',
  },
]

function applyInput(
  state = createLogInkState(rows),
  inputValue: string,
  key: Parameters<typeof getLogInkInputEvents>[2] = {},
  context: Parameters<typeof getLogInkInputEvents>[3] = {}
) {
  return getLogInkInputEvents(state, inputValue, key, context)
    .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
    .reduce((current, event) => applyLogInkAction(current, event.action), state)
}

describe('log Ink input interactions', () => {
  it('exits with q or Ctrl+C', () => {
    expect(getLogInkInputEvents(createLogInkState(rows), 'q')).toEqual([{ type: 'exit' }])
    expect(getLogInkInputEvents(createLogInkState(rows), 'c', { ctrl: true })).toEqual([
      { type: 'exit' },
    ])
  })

  it('opens and edits search mode without handling meta/control text input', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, '/')
    expect(state.filterMode).toBe(true)

    state = applyInput(state, 'f')
    state = applyInput(state, 'i')
    state = applyInput(state, 'x')
    expect(state.filter).toBe('fix')
    expect(state.filteredCommits).toHaveLength(1)

    state = applyInput(state, '', { backspace: true })
    expect(state.filter).toBe('fi')

    state = applyInput(state, 'u', { ctrl: true })
    expect(state.filter).toBe('')
    expect(state.filterMode).toBe(false)
  })

  it('clears the filter on first Esc and exits filter mode on the second', () => {
    let state = createLogInkState(rows)
    state = applyInput(state, '/')
    state = applyInput(state, 'f')
    state = applyInput(state, 'i')
    expect(state.filter).toBe('fi')
    expect(state.filterMode).toBe(true)

    state = applyInput(state, '', { escape: true })
    expect(state.filter).toBe('')
    expect(state.filterMode).toBe(true)

    state = applyInput(state, '', { escape: true })
    expect(state.filterMode).toBe(false)
  })

  it('q on an unsaved compose draft prompts a discard confirmation instead of exiting', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, {
      type: 'commitCompose',
      action: { type: 'append', value: 'feat: in-flight summary' },
    })

    const events = applyInput(state, 'q')
    expect(events.pendingMutationConfirmation).toBe('discard-draft')

    // n cancels and keeps the draft
    state = applyInput(events, 'n')
    expect(state.pendingMutationConfirmation).toBeUndefined()
    expect(state.commitCompose.summary).toBe('feat: in-flight summary')
  })

  it('q with no compose draft exits immediately', () => {
    const events = getLogInkInputEvents(createLogInkState(rows), 'q')
    expect(events).toEqual([{ type: 'exit' }])
  })

  it('confirms discard-draft via y and emits exit', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, {
      type: 'commitCompose',
      action: { type: 'append', value: 'feat: ready to ship' },
    })
    state = applyInput(state, 'q')
    expect(state.pendingMutationConfirmation).toBe('discard-draft')

    const events = getLogInkInputEvents(state, 'y')
    expect(events.find((event) => event.type === 'exit')).toBeDefined()
  })

  it('snaps promoted-view selection to 0 when the filter changes', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'moveBranch', delta: 5, count: 10 })
    expect(state.selectedBranchIndex).toBe(5)

    state = applyLogInkAction(state, { type: 'setFilter', value: 'feature' })
    expect(state.selectedBranchIndex).toBe(0)
  })

  it('clearFilterText clears the filter input but keeps filterMode active', () => {
    let state = createLogInkState(rows)
    state = applyInput(state, '/')
    state = applyInput(state, 'f')
    state = applyInput(state, 'o')
    expect(state.filter).toBe('fo')
    expect(state.filterMode).toBe(true)

    state = applyLogInkAction(state, { type: 'clearFilterText' })
    expect(state.filter).toBe('')
    expect(state.filterMode).toBe(true)
  })

  it('toggles help, command palette, focus, and graph interactions', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, '?')
    expect(state.showHelp).toBe(true)

    state = applyInput(state, '', { escape: true })
    expect(state.showHelp).toBe(false)

    state = applyInput(state, ':')
    expect(state.showCommandPalette).toBe(true)

    state = applyInput(state, '', { escape: true })
    expect(state.showCommandPalette).toBe(false)

    state = applyInput(state, '', { tab: true })
    expect(state.focus).toBe('detail')

    state = applyInput(state, '', { tab: true, shift: true })
    expect(state.focus).toBe('commits')

    state = applyInput(state, '\\')
    expect(state.fullGraph).toBe(true)

    state = applyInput(state, '\\')
    expect(state.fullGraph).toBe(false)

    // gg jump to top: first 'g' is a pure prefix, second 'g' fires moveToTop.
    state = applyLogInkAction(state, { type: 'move', delta: 2 })
    expect(state.selectedIndex).toBeGreaterThan(0)

    state = applyInput(state, 'g')
    expect(state.pendingKey).toBe('g')

    state = applyInput(state, 'g')
    expect(state.selectedIndex).toBe(0)
    expect(state.statusMessage).toBe('jumped to first commit')
  })

  it('moves commits and sidebar tabs with arrows, vim keys, and direct jumps', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, 'j')
    expect(state.selectedIndex).toBe(1)

    state = applyInput(state, 'k')
    expect(state.selectedIndex).toBe(0)

    state = applyLogInkAction(state, { type: 'setFocus', value: 'sidebar' })
    state = applyInput(state, '', { downArrow: true })
    expect(state.sidebarTab).toBe('branches')

    state = applyInput(state, '', { upArrow: true })
    expect(state.sidebarTab).toBe('status')

    state = applyInput(state, ']')
    expect(state.sidebarTab).toBe('branches')

    state = applyInput(state, '[')
    expect(state.sidebarTab).toBe('status')

    state = applyInput(state, '5')
    expect(state.sidebarTab).toBe('worktrees')
    expect(state.focus).toBe('sidebar')
  })

  it('focuses the synthetic pending-commit row on k from index 0 when worktree is dirty', () => {
    let state = createLogInkState(rows)
    expect(state.selectedIndex).toBe(0)
    expect(state.pendingCommitFocused).toBeFalsy()

    // Without worktreeDirty in context, k at index 0 must remain a no-op.
    state = applyInput(state, 'k')
    expect(state.pendingCommitFocused).toBeFalsy()
    expect(state.selectedIndex).toBe(0)

    state = applyInput(state, 'k', {}, { worktreeDirty: true })
    expect(state.pendingCommitFocused).toBe(true)
    expect(state.selectedIndex).toBe(0)

    state = applyInput(state, 'j', {}, { worktreeDirty: true })
    expect(state.pendingCommitFocused).toBeFalsy()
    expect(state.selectedIndex).toBe(0)
  })

  it('Enter on the pending-commit row pushes the status view', () => {
    let state = createLogInkState(rows)
    state = applyInput(state, 'k', {}, { worktreeDirty: true })
    expect(state.pendingCommitFocused).toBe(true)

    state = applyInput(state, '', { return: true }, { worktreeDirty: true })
    expect(state.activeView).toBe('status')
    // Pending flag clears on view push so popping back lands on real commit 0.
    expect(state.pendingCommitFocused).toBeFalsy()
  })

  it('supports next/previous match and top/bottom navigation conventions', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, 'G')
    expect(state.selectedIndex).toBe(2)
    expect(state.statusMessage).toBe('jumped to last commit')

    state = applyInput(state, 'N')
    expect(state.selectedIndex).toBe(1)

    state = applyInput(state, 'n')
    expect(state.selectedIndex).toBe(2)

    state = applyInput(state, 'g')
    state = applyInput(state, 'g')
    expect(state.selectedIndex).toBe(0)
  })

  it('moves detail file selection and diff preview pages when detail is focused', () => {
    let state = createLogInkState(rows)

    state = applyLogInkAction(state, { type: 'setFocus', value: 'detail' })
    state = applyInput(state, 'j', {}, { detailFileCount: 3, previewLineCount: 30 })
    expect(state.selectedFileIndex).toBe(1)

    state = applyInput(state, '', { pageDown: true }, { detailFileCount: 3, previewLineCount: 30 })
    expect(state.diffPreviewOffset).toBe(8)

    state = applyInput(state, 'k', {}, { detailFileCount: 3, previewLineCount: 30 })
    expect(state.selectedFileIndex).toBe(0)
    expect(state.diffPreviewOffset).toBe(0)
  })

  it('opens and scrolls the worktree diff surface from status view', () => {
    let state = createLogInkState(rows, { activeView: 'status' })

    state = applyInput(state, 'j', {}, { worktreeFileCount: 3 })
    expect(state.selectedWorktreeFileIndex).toBe(1)

    state = applyInput(state, '', { return: true }, { worktreeFileCount: 3 })
    expect(state.activeView).toBe('diff')

    state = applyInput(state, '', { pageDown: true }, { worktreeDiffLineCount: 30 })
    expect(state.worktreeDiffOffset).toBe(8)

    // j now scrolls the diff one line at a time (line-level scroll), so
    // after pageDown(+8) a single j advances to offset 9. Hunk navigation
    // moved to ]/[.
    state = applyInput(state, 'j', {}, {
      worktreeDiffLineCount: 30,
      worktreeHunkOffsets: [2, 12, 20],
    })
    expect(state.worktreeDiffOffset).toBe(9)

    state = applyInput(state, ']', {}, {
      worktreeDiffLineCount: 30,
      worktreeHunkOffsets: [2, 12, 20],
    })
    expect(state.worktreeDiffOffset).toBe(12)
    expect(state.selectedWorktreeHunkIndex).toBe(1)

    state = applyInput(state, '', { escape: true })
    expect(state.activeView).toBe('status')
  })

  it('scrolls the commit-diff preview line-by-line on j/k in diff view', () => {
    let state = createLogInkState(rows, { activeView: 'diff' })
    const context = { commitDiffHunkOffsets: [2, 8, 14], previewLineCount: 30 }

    // k from offset 0 is a no-op (not a forward jump).
    state = applyInput(state, 'k', {}, context)
    expect(state.diffPreviewOffset).toBe(0)

    state = applyInput(state, 'j', {}, context)
    expect(state.diffPreviewOffset).toBe(1)

    state = applyInput(state, 'j', {}, context)
    expect(state.diffPreviewOffset).toBe(2)

    state = applyInput(state, 'k', {}, context)
    expect(state.diffPreviewOffset).toBe(1)
  })

  it('jumps commit-diff hunks bidirectionally on ]/[ in diff view', () => {
    let state = createLogInkState(rows, { activeView: 'diff' })
    const context = { commitDiffHunkOffsets: [2, 8, 14], previewLineCount: 30 }

    state = applyInput(state, ']', {}, context)
    expect(state.diffPreviewOffset).toBe(2)

    state = applyInput(state, ']', {}, context)
    expect(state.diffPreviewOffset).toBe(8)

    state = applyInput(state, '[', {}, context)
    expect(state.diffPreviewOffset).toBe(2)

    // Past the last hunk, ] stays put; before the first hunk, [ stays put.
    state = applyInput(state, ']', {}, context)
    state = applyInput(state, ']', {}, context)
    expect(state.diffPreviewOffset).toBe(14)
    state = applyInput(state, ']', {}, context)
    expect(state.diffPreviewOffset).toBe(14)
  })

  it('routes PageUp/PageDown in diff view to detail-preview paging when no worktree file is in scope', () => {
    let state = createLogInkState(rows, { activeView: 'diff' })
    const context = { previewLineCount: 30 }

    state = applyInput(state, '', { pageDown: true }, context)
    expect(state.diffPreviewOffset).toBe(8)

    state = applyInput(state, '', { pageUp: true }, context)
    expect(state.diffPreviewOffset).toBe(0)
  })

  it('opens the commit-diff view from detail focus, preserving the selected file', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'setFocus', value: 'detail' })
    state = applyLogInkAction(state, {
      type: 'moveDetailFile',
      delta: 2,
      fileCount: 5,
    })

    const events = getLogInkInputEvents(state, '', { return: true }, { detailFileCount: 5 })
    const navigateEvent = events.find((event) =>
      event.type === 'action' && event.action.type === 'navigateOpenDiffForCommit'
    )
    expect(navigateEvent).toBeDefined()
    if (navigateEvent && navigateEvent.type === 'action' &&
        navigateEvent.action.type === 'navigateOpenDiffForCommit') {
      expect(navigateEvent.action.fileIndex).toBe(2)
      expect(navigateEvent.action.sha).toBe(state.filteredCommits[state.selectedIndex].hash)
    }
  })

  it('falls back to sidebar tab navigation when ]/[ is pressed outside diff view', () => {
    const stateHistory = createLogInkState(rows)

    expect(getLogInkInputEvents(stateHistory, ']', {})).toEqual([
      { type: 'action', action: { type: 'nextSidebarTab' } },
    ])
    expect(getLogInkInputEvents(stateHistory, '[', {})).toEqual([
      { type: 'action', action: { type: 'previousSidebarTab' } },
    ])
  })

  it('emits worktree file and hunk mutation events from status and diff views', () => {
    expect(getLogInkInputEvents(
      createLogInkState(rows, { activeView: 'status' }),
      ' ',
      {},
      { worktreeFileCount: 1 }
    )).toEqual([{ type: 'toggleSelectedFileStage' }])

    expect(getLogInkInputEvents(
      createLogInkState(rows, { activeView: 'diff' }),
      ' ',
      {},
      { worktreeHunkOffsets: [2] }
    )).toEqual([{ type: 'toggleSelectedHunkStage' }])

    expect(getLogInkInputEvents(
      createLogInkState(rows, { activeView: 'status' }),
      'z',
      {},
      { worktreeFileCount: 1 }
    )).toEqual([
      {
        type: 'action',
        action: { type: 'setPendingMutationConfirmation', value: 'revert-file' },
      },
    ])

    expect(getLogInkInputEvents(
      createLogInkState(rows, { activeView: 'diff' }),
      'z',
      {},
      { worktreeHunkOffsets: [2] }
    )).toEqual([
      {
        type: 'action',
        action: { type: 'setPendingMutationConfirmation', value: 'revert-hunk' },
      },
    ])
  })

  it('confirms or cancels worktree revert actions explicitly', () => {
    const filePending = applyLogInkAction(createLogInkState(rows), {
      type: 'setPendingMutationConfirmation',
      value: 'revert-file',
    })
    const hunkPending = applyLogInkAction(createLogInkState(rows), {
      type: 'setPendingMutationConfirmation',
      value: 'revert-hunk',
    })

    expect(getLogInkInputEvents(filePending, 'y')).toEqual([
      { type: 'revertSelectedFile' },
      {
        type: 'action',
        action: { type: 'setPendingMutationConfirmation', value: undefined },
      },
    ])
    expect(getLogInkInputEvents(hunkPending, 'y')).toEqual([
      { type: 'revertSelectedHunk' },
      {
        type: 'action',
        action: { type: 'setPendingMutationConfirmation', value: undefined },
      },
    ])
    expect(getLogInkInputEvents(filePending, 'n')).toEqual([
      {
        type: 'action',
        action: { type: 'setPendingMutationConfirmation', value: undefined },
      },
      { type: 'action', action: { type: 'setStatus', value: 'revert cancelled' } },
    ])
  })

  it('edits commit compose fields and emits commit events', () => {
    let state = createLogInkState(rows, { activeView: 'status' })

    state = applyInput(state, 'e')
    expect(state.commitCompose.editing).toBe(true)

    state = applyInput(state, 'f')
    state = applyInput(state, 'e')
    state = applyInput(state, 'a')
    state = applyInput(state, 't')
    expect(state.commitCompose.summary).toBe('feat')

    state = applyInput(state, '', { return: true })
    expect(state.commitCompose.field).toBe('body')

    state = applyInput(state, 'body')
    expect(state.commitCompose.body).toBe('body')

    state = applyInput(state, '', { escape: true })
    expect(state.commitCompose.editing).toBe(false)

    expect(getLogInkInputEvents(state, 'c')).toEqual([{ type: 'createManualCommit' }])
  })

  it('clears pending key chords after unrelated actions', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, 'g')
    expect(state.pendingKey).toBe('g')

    state = applyInput(state, '?')
    expect(state.showHelp).toBe(true)
    expect(state.pendingKey).toBeUndefined()
  })

  it('emits refresh event separately from state actions', () => {
    expect(getLogInkInputEvents(createLogInkState(rows), 'r')).toEqual([
      { type: 'refreshContext' },
    ])
  })

  it('jumps to history with the gh chord and clears the navigation stack', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'status' })
    state = applyLogInkAction(state, { type: 'pushView', value: 'diff' })

    state = applyInput(state, 'g')
    expect(state.pendingKey).toBe('g')

    state = applyInput(state, 'h')
    expect(state.viewStack).toEqual(['history'])
    expect(state.activeView).toBe('history')
    expect(state.statusMessage).toBe('jumped to history')
  })

  it('pushes the status view with the gs chord', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, 'g')
    state = applyInput(state, 's')

    expect(state.viewStack).toEqual(['history', 'status'])
    expect(state.activeView).toBe('status')
    expect(state.statusMessage).toBe('jumped to status')
  })

  it('pushes the diff view with the gd chord', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, 'g')
    state = applyInput(state, 'd')

    expect(state.viewStack).toEqual(['history', 'diff'])
    expect(state.activeView).toBe('diff')
    expect(state.statusMessage).toBe('jumped to diff')
  })

  it('pushes branches with the gb chord', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, 'g')
    state = applyInput(state, 'b')

    expect(state.viewStack).toEqual(['history', 'branches'])
    expect(state.activeView).toBe('branches')
    expect(state.statusMessage).toBe('jumped to branches')
  })

  it('pushes tags with the gt chord', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, 'g')
    state = applyInput(state, 't')

    expect(state.viewStack).toEqual(['history', 'tags'])
    expect(state.activeView).toBe('tags')
    expect(state.statusMessage).toBe('jumped to tags')
  })

  it('pushes stash with the gz chord (gs is reserved for status)', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, 'g')
    state = applyInput(state, 'z')

    expect(state.viewStack).toEqual(['history', 'stash'])
    expect(state.activeView).toBe('stash')
    expect(state.statusMessage).toBe('jumped to stash')
  })

  it('moves the selected branch with arrow keys when in branches view', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'branches' })

    state = applyInput(state, 'j', {}, { branchCount: 5 })
    expect(state.selectedBranchIndex).toBe(1)

    state = applyInput(state, '', { downArrow: true }, { branchCount: 5 })
    expect(state.selectedBranchIndex).toBe(2)

    state = applyInput(state, 'k', {}, { branchCount: 5 })
    expect(state.selectedBranchIndex).toBe(1)
  })

  it('moves the selected tag with arrow keys when in tags view', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'tags' })

    state = applyInput(state, 'j', {}, { tagCount: 4 })
    state = applyInput(state, 'j', {}, { tagCount: 4 })
    expect(state.selectedTagIndex).toBe(2)
  })

  it('moves the selected stash with arrow keys when in stash view', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'stash' })

    state = applyInput(state, 'j', {}, { stashCount: 3 })
    state = applyInput(state, 'j', {}, { stashCount: 3 })
    expect(state.selectedStashIndex).toBe(2)

    // Clamped at the count boundary.
    state = applyInput(state, 'j', {}, { stashCount: 3 })
    expect(state.selectedStashIndex).toBe(2)
  })

  it('preserves per-view selection across navigation', () => {
    let state = createLogInkState(rows)

    // Move within branches.
    state = applyLogInkAction(state, { type: 'pushView', value: 'branches' })
    state = applyInput(state, 'j', {}, { branchCount: 5 })
    state = applyInput(state, 'j', {}, { branchCount: 5 })
    expect(state.selectedBranchIndex).toBe(2)

    // Pop to history, push tags, move there.
    state = applyInput(state, '<')
    state = applyLogInkAction(state, { type: 'pushView', value: 'tags' })
    state = applyInput(state, 'j', {}, { tagCount: 4 })
    expect(state.selectedTagIndex).toBe(1)

    // Selection state for branches should be preserved.
    expect(state.selectedBranchIndex).toBe(2)

    // Round-trip back to branches and confirm.
    state = applyInput(state, '<')
    state = applyLogInkAction(state, { type: 'pushView', value: 'branches' })
    expect(state.selectedBranchIndex).toBe(2)
  })

  it('pops the navigation stack with < (back)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'status' })
    state = applyLogInkAction(state, { type: 'pushView', value: 'diff' })

    state = applyInput(state, '<')
    expect(state.viewStack).toEqual(['history', 'status'])
    expect(state.activeView).toBe('status')

    state = applyInput(state, '<')
    expect(state.viewStack).toEqual(['history'])
    expect(state.activeView).toBe('history')

    // No-op when the stack is at the root.
    state = applyInput(state, '<')
    expect(state.viewStack).toEqual(['history'])
  })

  it('uses escape as back when the navigation stack has been pushed onto', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'diff' })

    state = applyInput(state, '', { escape: true })
    expect(state.viewStack).toEqual(['history'])
    expect(state.activeView).toBe('history')
  })

  it('opens diff for the selected commit with enter from history view', () => {
    let state = createLogInkState(rows)
    state = applyInput(state, 'j') // move to def5678
    expect(state.selectedIndex).toBe(1)

    state = applyInput(state, '', { return: true })

    expect(state.viewStack).toEqual(['history', 'diff'])
    expect(state.activeView).toBe('diff')
    expect(state.statusMessage).toBe('viewing diff for def5678')
  })

  it('opens diff for the selected file with enter from status view, preserving stack depth', () => {
    let state = createLogInkState(rows, { activeView: 'status' })

    state = applyInput(state, 'j', {}, { worktreeFileCount: 3 })
    expect(state.selectedWorktreeFileIndex).toBe(1)

    state = applyInput(state, '', { return: true }, { worktreeFileCount: 3 })

    expect(state.viewStack).toEqual(['status', 'diff'])
    expect(state.activeView).toBe('diff')
    expect(state.selectedWorktreeFileIndex).toBe(1)

    // Escape pops back to status (where we came from).
    state = applyInput(state, '', { escape: true })
    expect(state.activeView).toBe('status')
  })

  it('jumps to compose with the gc chord', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, 'g')
    expect(state.pendingKey).toBe('g')

    state = applyInput(state, 'c')
    expect(state.viewStack).toEqual(['history', 'compose'])
    expect(state.activeView).toBe('compose')
    expect(state.statusMessage).toBe('jumped to compose')
  })

  it('routes e from status to compose with editing started', () => {
    let state = createLogInkState(rows, { activeView: 'status' })

    const events = getLogInkInputEvents(state, 'e', {}, { worktreeFileCount: 1 })
    expect(events).toEqual([
      { type: 'action', action: { type: 'pushView', value: 'compose' } },
      {
        type: 'action',
        action: { type: 'commitCompose', action: { type: 'setEditing', value: true } },
      },
    ])

    state = events
      .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
      .reduce((current, event) => applyLogInkAction(current, event.action), state)

    expect(state.viewStack).toEqual(['status', 'compose'])
    expect(state.activeView).toBe('compose')
    expect(state.commitCompose.editing).toBe(true)
  })

  it('routes c from diff to compose then commits', () => {
    const state = createLogInkState(rows, { activeView: 'diff' })

    expect(getLogInkInputEvents(state, 'c', {}, { worktreeFileCount: 1 })).toEqual([
      { type: 'action', action: { type: 'pushView', value: 'compose' } },
      { type: 'createManualCommit' },
    ])
  })

  it('e from compose toggles editing without re-pushing the view', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'compose' })

    expect(getLogInkInputEvents(state, 'e')).toEqual([
      {
        type: 'action',
        action: { type: 'commitCompose', action: { type: 'setEditing', value: true } },
      },
    ])
  })

  it('c from compose commits without re-pushing the view', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'compose' })

    expect(getLogInkInputEvents(state, 'c')).toEqual([{ type: 'createManualCommit' }])
  })

  it('preserves draft state across compose → history → compose round-trips', () => {
    let state = createLogInkState(rows)

    // gc → push compose
    state = applyInput(state, 'g')
    state = applyInput(state, 'c')
    expect(state.activeView).toBe('compose')

    // e → start editing, then type "hello" into the summary.
    state = applyInput(state, 'e')
    expect(state.commitCompose.editing).toBe(true)
    state = applyInput(state, 'h')
    state = applyInput(state, 'e')
    state = applyInput(state, 'l')
    state = applyInput(state, 'l')
    state = applyInput(state, 'o')
    expect(state.commitCompose.summary).toBe('hello')

    // Leave editing, then jump home.
    state = applyInput(state, '', { escape: true })
    expect(state.commitCompose.editing).toBe(false)
    state = applyInput(state, 'g')
    state = applyInput(state, 'h')
    expect(state.activeView).toBe('history')

    // Round-trip back to compose. Draft must still be there.
    state = applyInput(state, 'g')
    state = applyInput(state, 'c')
    expect(state.activeView).toBe('compose')
    expect(state.commitCompose.summary).toBe('hello')
  })

  it('toggles graph with the relocated \\\\ key (g is now a pure prefix)', () => {
    let state = createLogInkState(rows)
    expect(state.fullGraph).toBe(false)

    // Single g press only sets a pending chord — no graph flicker.
    state = applyInput(state, 'g')
    expect(state.fullGraph).toBe(false)
    expect(state.pendingKey).toBe('g')

    // \\ is the new toggle.
    state = applyInput(state, '\\')
    expect(state.fullGraph).toBe(true)
  })

  describe('command palette', () => {
    function openPalette() {
      return applyLogInkAction(createLogInkState(rows), { type: 'toggleCommandPalette' })
    }

    it('intercepts every key while open — no leaks to normal handlers', () => {
      let state = openPalette()
      expect(state.showCommandPalette).toBe(true)

      // Pressing 'j' would normally move the commit cursor; while the palette
      // is open it must append to the filter instead.
      state = applyInput(state, 'j')
      expect(state.paletteFilter).toBe('j')
      expect(state.selectedIndex).toBe(0) // commit cursor untouched
    })

    it('appends, backspaces, and clears the palette filter', () => {
      let state = openPalette()

      state = applyInput(state, 'b')
      state = applyInput(state, 'r')
      state = applyInput(state, 'a')
      state = applyInput(state, 'n')
      state = applyInput(state, 'c')
      state = applyInput(state, 'h')
      expect(state.paletteFilter).toBe('branch')

      state = applyInput(state, '', { backspace: true })
      expect(state.paletteFilter).toBe('branc')

      state = applyInput(state, 'u', { ctrl: true })
      expect(state.paletteFilter).toBe('')
    })

    it('moves the palette selection with arrow keys and ctrl+n/ctrl+p', () => {
      let state = openPalette()

      state = applyInput(state, '', { downArrow: true })
      expect(state.paletteSelectedIndex).toBe(1)

      state = applyInput(state, 'n', { ctrl: true })
      expect(state.paletteSelectedIndex).toBe(2)

      state = applyInput(state, '', { upArrow: true })
      expect(state.paletteSelectedIndex).toBe(1)

      state = applyInput(state, 'p', { ctrl: true })
      expect(state.paletteSelectedIndex).toBe(0)
    })

    it('closes on escape without executing anything', () => {
      let state = openPalette()
      expect(state.showCommandPalette).toBe(true)

      state = applyInput(state, '', { escape: true })
      expect(state.showCommandPalette).toBe(false)
      expect(state.paletteFilter).toBe('')
      expect(state.paletteSelectedIndex).toBe(0)
    })

    it('executes the selected command on enter and closes', () => {
      let state = openPalette()

      // Filter to the home navigation, then run.
      state = applyInput(state, 'h')
      state = applyInput(state, 'o')
      state = applyInput(state, 'm')
      state = applyInput(state, 'e')

      const events = getLogInkInputEvents(state, '', { return: true })
      // First the palette records the recent command, then closes, then
      // dispatches the command's events.
      expect(events.length).toBeGreaterThan(0)
      const types = events
        .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
        .map((event) => event.action.type)
      expect(types).toContain('recordPaletteRecent')
      expect(types).toContain('toggleCommandPalette')
      expect(types).toContain('navigateHome')
    })

    it('records executed commands in paletteRecent (most recent first, dedup)', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'recordPaletteRecent', value: 'navigateStatus' })
      state = applyLogInkAction(state, { type: 'recordPaletteRecent', value: 'navigateDiff' })
      state = applyLogInkAction(state, { type: 'recordPaletteRecent', value: 'navigateStatus' })

      // navigateStatus moves to the front; no duplicate.
      expect(state.paletteRecent).toEqual(['navigateStatus', 'navigateDiff'])
    })

    it('does not move the palette selection past the filtered command count', () => {
      let state = openPalette()

      // Filter to a unique substring that ONLY matches toggleGraph.
      // Earlier the test typed `graph` letter-by-letter, but the
      // fuzzy-match scorer also accepts long-distance matches like
      // `Merge ... current ... branch's ... pull ... squash` which
      // collide with the new PR-panel workflows added in #783.
      // `togglegr` is a substring of the toggleGraph id and lives
      // nowhere else in the command set.
      'togglegr'.split('').forEach((c) => { state = applyInput(state, c) })

      // Only one match (toggleGraph). Down-arrow should clamp at index 0.
      state = applyInput(state, '', { downArrow: true })
      expect(state.paletteSelectedIndex).toBe(0)
    })
  })

  it('gates destructive and AI workflow actions behind confirmation', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, 'D')
    expect(state.pendingConfirmationId).toBe('delete-branch')

    state = applyInput(state, 'n')
    expect(state.pendingConfirmationId).toBeUndefined()
    expect(state.statusMessage).toBe('workflow action cancelled')

    state = applyInput(state, 'I')
    expect(state.pendingConfirmationId).toBe('ai-commit-summary')

    expect(getLogInkInputEvents(state, 'y')).toEqual([
      { type: 'runAiCommitDraft' },
      {
        type: 'action',
        action: { type: 'setPendingConfirmation', value: undefined },
      },
    ])
  })

  describe('s cycles sort modes (P4.2)', () => {
    it('cycles branch sort when active view is branches', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'branches' })
      expect(state.branchSort).toBe('name')

      state = applyInput(state, 's')
      expect(state.branchSort).toBe('recent')

      state = applyInput(state, 's')
      expect(state.branchSort).toBe('ahead')
    })

    it('cycles tag sort when active view is tags', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'tags' })
      expect(state.tagSort).toBe('recent')

      state = applyInput(state, 's')
      expect(state.tagSort).toBe('name')
    })

    it('does not cycle sort outside branches/tags views', () => {
      let state = createLogInkState(rows)
      // history view: `s` is unbound; reducer should not touch sort modes.
      state = applyInput(state, 's')
      expect(state.branchSort).toBe('name')
      expect(state.tagSort).toBe('recent')
    })
  })

  describe('y / Y yank to clipboard (#778)', () => {
    it('emits yankFromActiveView from history view (y full hash, Y short hash)', () => {
      const state = createLogInkState(rows)

      expect(getLogInkInputEvents(state, 'y')).toEqual([
        { type: 'yankFromActiveView', short: false },
      ])
      expect(getLogInkInputEvents(state, 'Y')).toEqual([
        { type: 'yankFromActiveView', short: true },
      ])
    })

    it('does not emit a short flag for views where it is meaningless', () => {
      // Branches/tags/stash/status only have one identifier per row — short
      // is reserved for hash-bearing views (history + commit-diff).
      let state = createLogInkState(rows)

      state = applyLogInkAction(state, { type: 'pushView', value: 'branches' })
      expect(getLogInkInputEvents(state, 'y', {}, { branchCount: 1 })).toEqual([
        { type: 'yankFromActiveView' },
      ])

      state = applyLogInkAction(state, { type: 'popView' })
      state = applyLogInkAction(state, { type: 'pushView', value: 'status' })
      expect(
        getLogInkInputEvents(state, 'y', {}, { worktreeFileCount: 1, worktreeSelectedPath: 'a.ts' })
      ).toEqual([{ type: 'yankFromActiveView' }])
    })

    it('emits yankFromActiveView from branches when there is a selectable branch', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'branches' })

      expect(getLogInkInputEvents(state, 'y', {}, { branchCount: 3 })).toEqual([
        { type: 'yankFromActiveView' },
      ])
      // Empty branches list — no event, falls through to existing handlers.
      expect(getLogInkInputEvents(state, 'y', {}, { branchCount: 0 })).toEqual([])
    })

    it('emits yankFromActiveView from tags and stash when those views have a selection', () => {
      let state = createLogInkState(rows)

      state = applyLogInkAction(state, { type: 'pushView', value: 'tags' })
      expect(getLogInkInputEvents(state, 'y', {}, { tagCount: 2 })).toEqual([
        { type: 'yankFromActiveView' },
      ])

      state = applyLogInkAction(state, { type: 'popView' })
      state = applyLogInkAction(state, { type: 'pushView', value: 'stash' })
      expect(
        getLogInkInputEvents(state, 'y', {}, { stashCount: 1, stashSelectedRef: 'stash@{0}' })
      ).toEqual([{ type: 'yankFromActiveView' }])
      // No stashSelectedRef → can't yank.
      expect(getLogInkInputEvents(state, 'y', {}, { stashCount: 1 })).toEqual([])
    })

    it('emits yankFromActiveView from status only when a worktree path is selected', () => {
      const state = createLogInkState(rows, { activeView: 'status' })

      expect(getLogInkInputEvents(state, 'y', {}, { worktreeFileCount: 1, worktreeSelectedPath: 'src/foo.ts' })).toEqual([
        { type: 'yankFromActiveView' },
      ])
      // Empty worktree → fall through.
      expect(getLogInkInputEvents(state, 'y', {}, { worktreeFileCount: 0 })).toEqual([])
    })

    it('emits yankFromActiveView from diff view across worktree/stash/commit sources', () => {
      const state = createLogInkState(rows, { activeView: 'diff' })

      expect(getLogInkInputEvents(state, 'y', {}, { worktreeSelectedPath: 'src/foo.ts' })).toEqual([
        { type: 'yankFromActiveView', short: false },
      ])
      expect(getLogInkInputEvents(state, 'y', {}, { stashDiffSelectedPath: 'src/bar.ts' })).toEqual([
        { type: 'yankFromActiveView', short: false },
      ])
      expect(
        getLogInkInputEvents(state, 'Y', {}, { commitDiffSelectedSha: 'abc123', commitDiffSelectedPath: 'src/baz.ts' })
      ).toEqual([{ type: 'yankFromActiveView', short: true }])
      // No diff context → fall through.
      expect(getLogInkInputEvents(state, 'y', {}, {})).toEqual([])
    })

    it('palette execute for yankClipboard fires yankFromActiveView', () => {
      const events = getLogInkPaletteExecuteEvents(
        {
          id: 'yankClipboard',
          kind: 'binding',
          keys: 'y/Y',
          label: 'yank',
          description: 'Copy the cursored identifier to the clipboard.',
        },
        createLogInkState(rows)
      )
      expect(events).toEqual([{ type: 'yankFromActiveView' }])
    })
  })

  describe('status filter mask 1/2/3 (#776)', () => {
    it('toggles the mask bits when the active view is status', () => {
      let state = createLogInkState(rows, { activeView: 'status' })
      expect(state.statusFilterMask).toEqual({ staged: true, unstaged: true, untracked: true })

      state = applyInput(state, '1')
      expect(state.statusFilterMask).toEqual({ staged: false, unstaged: true, untracked: true })

      state = applyInput(state, '2')
      expect(state.statusFilterMask).toEqual({ staged: false, unstaged: false, untracked: true })

      state = applyInput(state, '3')
      // Snap-back to all-on rather than a fully empty mask.
      expect(state.statusFilterMask).toEqual({ staged: true, unstaged: true, untracked: true })
    })

    it('still drives sidebar tab numeric jumps from outside the status view', () => {
      let state = createLogInkState(rows)
      state = applyInput(state, '5')
      expect(state.sidebarTab).toBe('worktrees')
      expect(state.statusFilterMask).toEqual({ staged: true, unstaged: true, untracked: true })
    })
  })

  describe('history server-side filter prefix (#776)', () => {
    it('Enter on path:<value> dispatches setHistoryFetchArgs and clears the textual filter', () => {
      let state = createLogInkState(rows)
      state = applyInput(state, '/')
      state = applyInput(state, 'p')
      state = applyInput(state, 'a')
      state = applyInput(state, 't')
      state = applyInput(state, 'h')
      state = applyInput(state, ':')
      state = applyInput(state, 'f')
      state = applyInput(state, 'o')
      state = applyInput(state, 'o')
      expect(state.filter).toBe('path:foo')
      expect(state.filterMode).toBe(true)

      state = applyInput(state, '', { return: true })
      expect(state.historyFetchArgs).toEqual({ path: 'foo' })
      expect(state.filter).toBe('')
      expect(state.filterMode).toBe(false)
    })

    it('Enter on author:<value> sets the matching arg', () => {
      let state = createLogInkState(rows, { activeView: 'history' })
      state = applyInput(state, '/')
      'author:alice'.split('').forEach((c) => {
        state = applyInput(state, c)
      })
      state = applyInput(state, '', { return: true })
      expect(state.historyFetchArgs).toEqual({ author: 'alice' })
    })

    it('Enter on a non-prefix filter still just exits filter mode (no fetch args)', () => {
      let state = createLogInkState(rows)
      state = applyInput(state, '/')
      state = applyInput(state, 'f')
      state = applyInput(state, 'i')
      state = applyInput(state, 'x')

      state = applyInput(state, '', { return: true })
      expect(state.historyFetchArgs).toBeUndefined()
      expect(state.filter).toBe('fix')
      expect(state.filterMode).toBe(false)
    })

    it('Ctrl+U inside filter mode clears both the textual filter and active fetch args', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setHistoryFetchArgs', value: { author: 'alice' } })
      state = applyInput(state, '/')
      state = applyInput(state, 'a')
      state = applyInput(state, 'b')
      expect(state.filter).toBe('ab')

      state = applyInput(state, 'u', { ctrl: true })
      expect(state.filter).toBe('')
      expect(state.filterMode).toBe(false)
      expect(state.historyFetchArgs).toBeUndefined()
    })

    it('Enter on a path: prefix from a non-history view does not dispatch fetch args', () => {
      let state = createLogInkState(rows, { activeView: 'branches' })
      state = applyInput(state, '/')
      'path:foo'.split('').forEach((c) => {
        state = applyInput(state, c)
      })
      state = applyInput(state, '', { return: true })
      expect(state.historyFetchArgs).toBeUndefined()
    })
  })

  // #791 follow-up — in-sidebar selection. When the sidebar is focused
  // on a content tab, ↑/↓ navigates the items, ←/→ switches between
  // tabs, and per-entity keys (Enter checkout for branches, Enter diff
  // / a / p / X for stashes) act on the cursored item without leaving
  // the workstation view. Empty content tabs and the status tab keep
  // the legacy "Enter drills in" behavior.
  describe('in-sidebar selection (sidebar focus + content tab)', () => {
    function sidebarBranchesState() {
      const state = createLogInkState(rows)
      return { ...state, focus: 'sidebar' as const, sidebarTab: 'branches' as const }
    }

    function sidebarStashesState() {
      const state = createLogInkState(rows)
      return { ...state, focus: 'sidebar' as const, sidebarTab: 'stashes' as const }
    }

    it('←/→ on the sidebar switches between tabs', () => {
      const events = getLogInkInputEvents(sidebarBranchesState(), '', { rightArrow: true })
      expect(events).toEqual([{ type: 'action', action: { type: 'nextSidebarTab' } }])

      const left = getLogInkInputEvents(sidebarBranchesState(), '', { leftArrow: true })
      expect(left).toEqual([{ type: 'action', action: { type: 'previousSidebarTab' } }])
    })

    it('↑/↓ on a sidebar branches tab with items moves the branch cursor', () => {
      // The action is `moveBranch` (not previousSidebarTab) because the
      // branches tab has items the user is cursoring through. Without
      // items, the dispatch falls through to tab cycling — see next test.
      const events = getLogInkInputEvents(
        sidebarBranchesState(),
        '',
        { downArrow: true },
        { branchCount: 5 }
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'moveBranch', delta: 1, count: 5 } },
      ])
    })

    it('↑/↓ on an empty sidebar content tab falls back to cycling tabs', () => {
      // No branches → no entity-list claim → fall back to the previous
      // tab-cycle behavior so the user always has navigation. Matches
      // status tab too.
      const events = getLogInkInputEvents(
        sidebarBranchesState(),
        '',
        { downArrow: true },
        { branchCount: 0 }
      )
      expect(events).toEqual([{ type: 'action', action: { type: 'nextSidebarTab' } }])
    })

    it('Enter on sidebar branches with items checks out the cursored branch', () => {
      const events = getLogInkInputEvents(
        sidebarBranchesState(),
        '',
        { return: true },
        { branchCount: 3 }
      )
      // Per-entity Enter handler claims this — pushView stays out of
      // the way because the user is cursoring through items.
      expect(events).toContainEqual({ type: 'runWorkflowAction', id: 'checkout-branch' })
      expect(events.find((e) =>
        e.type === 'action' && e.action.type === 'pushView'
      )).toBeUndefined()
    })

    it('Enter on an empty sidebar branches tab still drills into the dedicated view', () => {
      const events = getLogInkInputEvents(
        sidebarBranchesState(),
        '',
        { return: true },
        { branchCount: 0 }
      )
      // Empty list → drill in so the user sees the dedicated view's
      // empty-state message and can act on it (e.g., create a branch).
      expect(events).toEqual([
        { type: 'action', action: { type: 'pushView', value: 'branches' } },
        { type: 'action', action: { type: 'setFocus', value: 'commits' } },
      ])
    })

    it('Enter on sidebar stashes opens the diff for the cursored stash', () => {
      const events = getLogInkInputEvents(
        sidebarStashesState(),
        '',
        { return: true },
        { stashCount: 2, stashSelectedRef: 'stash@{0}' }
      )
      expect(events).toContainEqual({
        type: 'action',
        action: { type: 'navigateOpenDiffForStash', ref: 'stash@{0}', stashIndex: 0 },
      })
    })

    it('a / p / X work on sidebar stashes (apply / pop / drop)', () => {
      const apply = getLogInkInputEvents(sidebarStashesState(), 'a', {}, { stashCount: 2 })
      expect(apply).toEqual([{ type: 'runWorkflowAction', id: 'apply-stash' }])

      const pop = getLogInkInputEvents(sidebarStashesState(), 'p', {}, { stashCount: 2 })
      expect(pop).toEqual([{ type: 'runWorkflowAction', id: 'pop-stash' }])
    })

    it('R / u work on sidebar branches (rename / set-upstream)', () => {
      const rename = getLogInkInputEvents(sidebarBranchesState(), 'R', {}, { branchCount: 3 })
      expect(rename[0]).toMatchObject({
        type: 'action',
        action: { type: 'openInputPrompt', kind: 'rename-branch' },
      })

      const upstream = getLogInkInputEvents(sidebarBranchesState(), 'u', {}, { branchCount: 3 })
      expect(upstream[0]).toMatchObject({
        type: 'action',
        action: { type: 'openInputPrompt', kind: 'set-upstream' },
      })
    })

    it('Enter on the status sidebar tab still drills in (no in-sidebar primary action)', () => {
      const state = createLogInkState(rows)
      const sidebar = { ...state, focus: 'sidebar' as const, sidebarTab: 'status' as const }
      const events = getLogInkInputEvents(sidebar, '', { return: true })
      expect(events).toEqual([
        { type: 'action', action: { type: 'pushView', value: 'status' } },
        { type: 'action', action: { type: 'setFocus', value: 'commits' } },
      ])
    })
  })
})
