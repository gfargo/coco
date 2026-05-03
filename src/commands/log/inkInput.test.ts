import { GitLogRow } from './data'
import { getLogInkInputEvents, getLogInkPaletteExecuteEvents } from './inkInput'
import { LogInkState, applyLogInkAction, createLogInkState } from './inkViewModel'

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
      // The fuzzy-match scorer accepts long-distance character chains,
      // so the original `graph` filter started colliding with new
      // commands as the registry grew (e.g., #783's PR-panel
      // workflows, #785's toggleDiffViewMode description). The full
      // id substring `togglegraph` is unique to toggleGraph because
      // toggleDiffViewMode lacks the `p` after `togglegra` in any of
      // its searchable fields.
      'togglegraph'.split('').forEach((c) => { state = applyInput(state, c) })

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

  // Issue #777 — wire revert / reset / interactive-rebase to history
  // view keystrokes. R and `i` route through y-confirm via the existing
  // pendingConfirmation flow; Z opens a mode prompt first because the
  // soft / mixed / hard choice changes destructiveness.
  describe('history-view mutation bindings (#777)', () => {
    it('R on the history view sets pending confirmation for revert-commit', () => {
      const events = getLogInkInputEvents(createLogInkState(rows), 'R')
      expect(events).toEqual([
        { type: 'action', action: { type: 'setPendingConfirmation', value: 'revert-commit' } },
      ])
    })

    it('Z on the history view opens the reset-mode prompt', () => {
      const events = getLogInkInputEvents(createLogInkState(rows), 'Z')
      expect(events).toEqual([
        {
          type: 'action',
          action: {
            type: 'openInputPrompt',
            kind: 'reset-mode',
            label: 'Reset mode (soft / mixed / hard)',
          },
        },
      ])
    })

    it('i on the history view sets pending confirmation for interactive-rebase', () => {
      // Lowercase `i` keeps the existing global `I` ai-commit-summary
      // workflow reachable on the history view; matches `git rebase -i`.
      const events = getLogInkInputEvents(createLogInkState(rows), 'i')
      expect(events).toEqual([
        { type: 'action', action: { type: 'setPendingConfirmation', value: 'interactive-rebase' } },
      ])
    })

    it('R / Z / i are scoped to the history view — branches view sees them differently', () => {
      // Branches view has its own R (rename-branch). Z and i are unbound
      // there — they fall through silently.
      const branches = createLogInkState(rows, { activeView: 'branches' })
      const r = getLogInkInputEvents(branches, 'R', {}, { branchCount: 3 })
      expect(r[0]).toMatchObject({
        type: 'action',
        action: { type: 'openInputPrompt', kind: 'rename-branch' },
      })
    })

    it('reset-mode prompt submission forwards the mode to reset-to-commit', () => {
      let state = createLogInkState(rows)
      state = applyInput(state, 'Z')
      expect(state.inputPrompt?.kind).toBe('reset-mode')

      // Simulate typing "soft" then Enter.
      state = applyInput(state, 's')
      state = applyInput(state, 'o')
      state = applyInput(state, 'f')
      state = applyInput(state, 't')
      const events = getLogInkInputEvents(state, '', { return: true })
      expect(events).toContainEqual({
        type: 'runWorkflowAction',
        id: 'reset-to-commit',
        payload: 'soft',
      })
    })

    it('reset-mode prompt rejects unknown modes with a status message', () => {
      let state = createLogInkState(rows)
      state = applyInput(state, 'Z')
      'extreme'.split('').forEach((c) => { state = applyInput(state, c) })
      const events = getLogInkInputEvents(state, '', { return: true })
      // Status message + no workflow run.
      expect(events.find((e) => e.type === 'runWorkflowAction')).toBeUndefined()
      expect(events).toContainEqual({
        type: 'action',
        action: { type: 'setStatus', value: 'Unknown reset mode: extreme. Use soft, mixed, or hard.' },
      })
    })

    it('reset-mode prompt accepts mixed and hard modes case-insensitively', () => {
      let state = createLogInkState(rows)
      state = applyInput(state, 'Z')
      'HARD'.split('').forEach((c) => { state = applyInput(state, c) })
      const events = getLogInkInputEvents(state, '', { return: true })
      expect(events).toContainEqual({
        type: 'runWorkflowAction',
        id: 'reset-to-commit',
        payload: 'hard',
      })
    })

    it('R / Z / i no-op when the history list is empty', () => {
      const empty = createLogInkState([])
      expect(getLogInkInputEvents(empty, 'R')).toEqual([])
      expect(getLogInkInputEvents(empty, 'Z')).toEqual([])
      expect(getLogInkInputEvents(empty, 'i')).toEqual([])
    })
  })

  // GitKraken-style "create branch / tag from cursored commit" — the
  // user types the name into an input prompt; submitting forwards the
  // typed name as the workflow payload. The prompt itself is the
  // affirmative gate (no extra y-confirm).
  describe('create-branch-here (B) / create-tag-here (gT) bindings', () => {
    it('B on the history view opens the create-branch-here prompt', () => {
      const events = getLogInkInputEvents(createLogInkState(rows), 'B')
      expect(events).toEqual([
        {
          type: 'action',
          action: {
            type: 'openInputPrompt',
            kind: 'create-branch-here',
            label: 'New branch name (at cursored commit)',
          },
        },
      ])
    })

    it('B is scoped to the history view — does not fire elsewhere', () => {
      const branches = createLogInkState(rows, { activeView: 'branches' })
      // Branches view doesn't bind `B`; it falls through to the default
      // workflow lookup which has no entry for `B`.
      expect(getLogInkInputEvents(branches, 'B', {}, { branchCount: 3 })).toEqual([])
    })

    it('B no-ops when the history list is empty', () => {
      const empty = createLogInkState([])
      expect(getLogInkInputEvents(empty, 'B')).toEqual([])
    })

    it('gT chord on the history view opens the create-tag-here prompt', () => {
      let state = createLogInkState(rows)
      // First press `g` to set the chord prefix.
      state = applyInput(state, 'g')
      expect(state.pendingKey).toBe('g')

      const events = getLogInkInputEvents(state, 'T')
      expect(events).toEqual([
        { type: 'action', action: { type: 'setPendingKey', value: undefined } },
        {
          type: 'action',
          action: {
            type: 'openInputPrompt',
            kind: 'create-tag-here',
            label: 'New tag name (at cursored commit)',
          },
        },
      ])
    })

    it('gT outside the history view surfaces a hint instead of opening the prompt', () => {
      let state = createLogInkState(rows, { activeView: 'branches' })
      state = applyInput(state, 'g', {}, { branchCount: 3 })
      expect(state.pendingKey).toBe('g')

      const events = getLogInkInputEvents(state, 'T', {}, { branchCount: 3 })
      expect(events).toContainEqual({
        type: 'action',
        action: { type: 'setPendingKey', value: undefined },
      })
      expect(events.find((e) => e.type === 'action' && (e.action as { type: string }).type === 'openInputPrompt')).toBeUndefined()
    })

    it('gT does not collide with gt (lowercase jumps to tags view)', () => {
      let state = createLogInkState(rows)
      state = applyInput(state, 'g')
      // Lowercase t still routes to the tags view.
      const events = getLogInkInputEvents(state, 't')
      expect(events).toContainEqual({
        type: 'action',
        action: { type: 'pushView', value: 'tags' },
      })
    })

    it('submitting create-branch-here forwards the typed name as the workflow payload', () => {
      let state = applyLogInkAction(createLogInkState(rows), {
        type: 'openInputPrompt',
        kind: 'create-branch-here',
        label: 'New branch name (at cursored commit)',
      })
      'feature/release'.split('').forEach((c) => { state = applyInput(state, c) })
      const events = getLogInkInputEvents(state, '', { return: true })
      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'create-branch-here', payload: 'feature/release' },
        { type: 'action', action: { type: 'closeInputPrompt' } },
      ])
    })

    it('submitting create-tag-here forwards the typed name as the workflow payload', () => {
      let state = applyLogInkAction(createLogInkState(rows), {
        type: 'openInputPrompt',
        kind: 'create-tag-here',
        label: 'New tag name (at cursored commit)',
      })
      'v1.2.3'.split('').forEach((c) => { state = applyInput(state, c) })
      const events = getLogInkInputEvents(state, '', { return: true })
      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'create-tag-here', payload: 'v1.2.3' },
        { type: 'action', action: { type: 'closeInputPrompt' } },
      ])
    })

    it('submitting an empty name surfaces a hint instead of running the workflow', () => {
      const state = applyLogInkAction(createLogInkState(rows), {
        type: 'openInputPrompt',
        kind: 'create-branch-here',
        label: 'New branch name (at cursored commit)',
      })
      const events = getLogInkInputEvents(state, '', { return: true })
      expect(events.find((e) => e.type === 'runWorkflowAction')).toBeUndefined()
      expect(events).toContainEqual({
        type: 'action',
        action: { type: 'setStatus', value: 'enter a value or press esc to cancel' },
      })
    })
  })

  describe('d toggles diff view mode (#785)', () => {
    it('emits toggleDiffViewMode + a status hint when pressed in the diff view', () => {
      const state = { ...createLogInkState(rows), activeView: 'diff' as const }
      const events = getLogInkInputEvents(state, 'd')

      expect(events).toEqual([
        { type: 'action', action: { type: 'toggleDiffViewMode' } },
        {
          type: 'action',
          action: { type: 'setStatus', value: 'Switched to side-by-side diff' },
        },
      ])
    })

    it('labels the status hint with the next mode (split → unified)', () => {
      const state = {
        ...createLogInkState(rows),
        activeView: 'diff' as const,
        diffViewMode: 'split' as const,
      }
      const events = getLogInkInputEvents(state, 'd')

      expect(events).toContainEqual({
        type: 'action',
        action: { type: 'setStatus', value: 'Switched to unified diff' },
      })
    })

    it('does not toggle the mode when pressed outside the diff view', () => {
      const state = createLogInkState(rows)
      // history view (default)
      const historyEvents = getLogInkInputEvents(state, 'd')
      expect(historyEvents).not.toContainEqual({
        type: 'action',
        action: { type: 'toggleDiffViewMode' },
      })

      const statusEvents = getLogInkInputEvents(
        { ...state, activeView: 'status' as const },
        'd'
      )
      expect(statusEvents).not.toContainEqual({
        type: 'action',
        action: { type: 'toggleDiffViewMode' },
      })
    })

    it('does not collide with the gd chord — gd still pushes the diff view', () => {
      const state = createLogInkState(rows)
      // First press starts the chord
      const startChord = getLogInkInputEvents(state, 'g')
      expect(startChord).toContainEqual({
        type: 'action',
        action: { type: 'setPendingKey', value: 'g' },
      })

      // Second press completes gd → pushView 'diff', not toggleDiffViewMode
      const chordState = applyLogInkAction(state, { type: 'setPendingKey', value: 'g' })
      const completeChord = getLogInkInputEvents(chordState, 'd')
      expect(completeChord).toContainEqual({
        type: 'action',
        action: { type: 'pushView', value: 'diff' },
      })
      expect(completeChord).not.toContainEqual({
        type: 'action',
        action: { type: 'toggleDiffViewMode' },
      })
    })
  })

  describe('hunk-level apply (#782)', () => {
    const COMMIT_DIFF_LINES = [
      '@@ -1,3 +1,4 @@',
      ' const a = 1',
      '+const b = 2',
      ' const c = 3',
      ' const d = 4',
    ]

    const STASH_DIFF_LINES = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,2 +1,3 @@',
      ' const a = 1',
      '+const b = 2',
      ' const c = 3',
    ]

    function commitDiffState() {
      const state = createLogInkState(rows, { activeView: 'diff' })
      return {
        ...state,
        diffSource: 'commit' as const,
        diffPreviewOffset: 1,
      }
    }

    function stashDiffState() {
      const state = createLogInkState(rows, { activeView: 'diff' })
      return {
        ...state,
        diffSource: 'stash' as const,
        stashDiffRef: 'stash@{0}',
        diffPreviewOffset: 5,
      }
    }

    it('H on commit-diff dispatches apply-hunk-worktree with the synthesized patch', () => {
      const events = getLogInkInputEvents(commitDiffState(), 'H', {}, {
        diffLinesForHunkApply: COMMIT_DIFF_LINES,
        commitDiffSelectedPath: 'src/foo.ts',
        commitDiffSelectedSha: 'abc1234',
      })
      expect(events).toHaveLength(1)
      const event = events[0]
      expect(event.type).toBe('runWorkflowAction')
      if (event.type !== 'runWorkflowAction') throw new Error('expected workflow event')
      expect(event.id).toBe('apply-hunk-worktree')
      expect(event.payload?.startsWith('worktree\n')).toBe(true)
      expect(event.payload).toContain('diff --git a/src/foo.ts b/src/foo.ts')
      expect(event.payload).toContain('+const b = 2')
    })

    it('H on stash-diff dispatches apply-hunk-worktree with the synthesized patch', () => {
      const events = getLogInkInputEvents(stashDiffState(), 'H', {}, {
        diffLinesForHunkApply: STASH_DIFF_LINES,
        stashDiffSelectedPath: 'src/foo.ts',
      })
      expect(events).toHaveLength(1)
      const event = events[0]
      expect(event.type).toBe('runWorkflowAction')
      if (event.type !== 'runWorkflowAction') throw new Error('expected workflow event')
      expect(event.id).toBe('apply-hunk-worktree')
      expect(event.payload?.startsWith('worktree\n')).toBe(true)
      expect(event.payload).toContain('diff --git a/src/foo.ts b/src/foo.ts')
    })

    it('gH chord dispatches apply-hunk-index instead of worktree', () => {
      let state: ReturnType<typeof createLogInkState> = commitDiffState()
      state = applyLogInkAction(state, { type: 'setPendingKey', value: 'g' })
      const events = getLogInkInputEvents(state, 'H', {}, {
        diffLinesForHunkApply: COMMIT_DIFF_LINES,
        commitDiffSelectedPath: 'src/foo.ts',
        commitDiffSelectedSha: 'abc1234',
      })
      // First event clears pendingKey, second event dispatches the workflow.
      const workflowEvent = events.find((e) => e.type === 'runWorkflowAction')
      expect(workflowEvent).toBeDefined()
      if (!workflowEvent || workflowEvent.type !== 'runWorkflowAction') {
        throw new Error('expected workflow event')
      }
      expect(workflowEvent.id).toBe('apply-hunk-index')
      expect(workflowEvent.payload?.startsWith('index\n')).toBe(true)
    })

    it('H without a hunk-extractable cursor surfaces a status hint', () => {
      const events = getLogInkInputEvents(stashDiffState(), 'H', {}, {
        diffLinesForHunkApply: ['diff --git a/x b/x'], // no @@ header
        stashDiffSelectedPath: 'x',
      })
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: 'action',
        action: { type: 'setStatus', value: expect.stringContaining('no hunk under cursor') },
      })
    })

    it('H outside of commit-diff / stash-diff is a no-op', () => {
      // History view: H is unbound and should fall through to subsequent
      // handlers. Empty events == nothing matched.
      const events = getLogInkInputEvents(createLogInkState(rows), 'H')
      expect(events).toEqual([])
    })

    it('gH chord without diff context shows a discoverability hint', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setPendingKey', value: 'g' })
      const events = getLogInkInputEvents(state, 'H')
      expect(events).toContainEqual({
        type: 'action',
        action: { type: 'setStatus', value: expect.stringContaining('gH applies a hunk') },
      })
    })
  })

  // Issue #806 — multi-line input prompt for free-form text. Enter
  // inserts a newline; Ctrl+D submits (Unix EOF convention, more
  // reliable than Ctrl+Enter across terminals/Ink). Esc and the
  // existing backspace / Ctrl+U keys still work the same way.
  describe('multi-line input prompt (#806)', () => {
    function openMultilinePrompt(state = createLogInkState(rows)) {
      return applyLogInkAction(state, {
        type: 'openInputPrompt',
        kind: 'pr-comment',
        label: 'Comment body',
        multiline: true,
      })
    }

    it('Enter on a multi-line prompt inserts a newline instead of submitting', () => {
      let state = openMultilinePrompt()
      'lgtm'.split('').forEach((c) => { state = applyInput(state, c) })
      const events = getLogInkInputEvents(state, '', { return: true })

      // Enter dispatches an append-newline, not a submit. The prompt
      // stays open so the user can keep typing.
      expect(events).toEqual([
        { type: 'action', action: { type: 'appendInputPrompt', value: '\n' } },
      ])
      const next = applyInput(state, '', { return: true })
      expect(next.inputPrompt).toBeDefined()
      expect(next.inputPrompt?.value).toBe('lgtm\n')
    })

    it('Ctrl+D on a multi-line prompt submits the buffered text including newlines', () => {
      let state = openMultilinePrompt()
      'first line'.split('').forEach((c) => { state = applyInput(state, c) })
      state = applyInput(state, '', { return: true })
      'second line'.split('').forEach((c) => { state = applyInput(state, c) })

      const events = getLogInkInputEvents(state, 'd', { ctrl: true })
      expect(events).toEqual([
        {
          type: 'runWorkflowAction',
          id: 'comment-pr',
          payload: 'first line\nsecond line',
        },
        { type: 'action', action: { type: 'closeInputPrompt' } },
      ])
    })

    it('Esc on a multi-line prompt cancels the same way as single-line', () => {
      let state = openMultilinePrompt()
      'wip'.split('').forEach((c) => { state = applyInput(state, c) })
      const events = getLogInkInputEvents(state, '', { escape: true })
      expect(events).toContainEqual({ type: 'action', action: { type: 'closeInputPrompt' } })
      expect(events).toContainEqual({
        type: 'action',
        action: { type: 'setStatus', value: 'cancelled' },
      })
    })

    it('Backspace on a multi-line prompt deletes a newline cleanly', () => {
      let state = openMultilinePrompt()
      'line1'.split('').forEach((c) => { state = applyInput(state, c) })
      state = applyInput(state, '', { return: true })
      expect(state.inputPrompt?.value).toBe('line1\n')
      state = applyInput(state, '', { backspace: true })
      // Backspace removes the trailing `\n`; the user is back to
      // editing line 1.
      expect(state.inputPrompt?.value).toBe('line1')
    })

    it('Ctrl+U on a multi-line prompt clears the entire buffer', () => {
      let state = openMultilinePrompt()
      'first\nsecond\nthird'.split('').forEach((c) => {
        state = c === '\n'
          ? applyInput(state, '', { return: true })
          : applyInput(state, c)
      })
      expect(state.inputPrompt?.value).toBe('first\nsecond\nthird')
      state = applyInput(state, 'u', { ctrl: true })
      expect(state.inputPrompt?.value).toBe('')
    })

    it('Ctrl+D on an empty multi-line prompt surfaces the same hint as Enter on a single-line prompt', () => {
      const state = openMultilinePrompt()
      const events = getLogInkInputEvents(state, 'd', { ctrl: true })
      expect(events).toEqual([
        { type: 'action', action: { type: 'setStatus', value: 'enter a value or press esc to cancel' } },
      ])
    })

    it('PR comment + PR request-changes open the prompt in multi-line mode', () => {
      // Comment body — c on the pull-request view.
      const prState = createLogInkState(rows, { activeView: 'pull-request' })
      const commentEvents = getLogInkInputEvents(prState, 'c')
      expect(commentEvents[0]).toMatchObject({
        type: 'action',
        action: {
          type: 'openInputPrompt',
          kind: 'pr-comment',
          multiline: true,
        },
      })

      // Request-changes review — R on the pull-request view.
      const requestEvents = getLogInkInputEvents(prState, 'R')
      expect(requestEvents[0]).toMatchObject({
        type: 'action',
        action: {
          type: 'openInputPrompt',
          kind: 'pr-request-changes',
          multiline: true,
        },
      })
    })

    it('keeps single-line prompts (create-branch, reset-mode, etc.) untouched', () => {
      // Sanity check: opening a non-multiline prompt and pressing
      // Enter still submits as before — the new dispatch path is
      // strictly opt-in.
      let state = applyLogInkAction(createLogInkState(rows), {
        type: 'openInputPrompt',
        kind: 'create-branch',
        label: 'New branch name',
      })
      'feature/x'.split('').forEach((c) => { state = applyInput(state, c) })
      const events = getLogInkInputEvents(state, '', { return: true })
      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'create-branch', payload: 'feature/x' },
        { type: 'action', action: { type: 'closeInputPrompt' } },
      ])
    })

    it('Ctrl+D on a single-line prompt does NOT submit (only multi-line uses it)', () => {
      let state = applyLogInkAction(createLogInkState(rows), {
        type: 'openInputPrompt',
        kind: 'create-branch',
        label: 'New branch name',
      })
      'feature/x'.split('').forEach((c) => { state = applyInput(state, c) })
      const events = getLogInkInputEvents(state, 'd', { ctrl: true })
      // Falls through to the `inputValue && !key.ctrl` guard which
      // rejects ctrl-modified chars — empty events == nothing claimed.
      expect(events).toEqual([])
    })
  })

  // Sidebar header focus (#806 follow-up) — the cursor escapes the
  // top of the items list onto the active tab's header. Enter on the
  // header drills into the dedicated view; ↓ re-enters the list at
  // index 0. ←/→ tab switching preserves the header focus so the
  // user can scan tab → tab → drill.
  describe('sidebar header focus', () => {
    function sidebarBranchesState() {
      const state = createLogInkState(rows)
      return { ...state, focus: 'sidebar' as const, sidebarTab: 'branches' as const }
    }

    it('↑ at branches index 0 promotes cursor onto the tab header', () => {
      const events = getLogInkInputEvents(
        sidebarBranchesState(),
        '',
        { upArrow: true },
        { branchCount: 5 },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'setSidebarHeaderFocused', value: true } },
      ])
    })

    it('↑ when already on the header is a no-op', () => {
      const state = { ...sidebarBranchesState(), sidebarHeaderFocused: true }
      const events = getLogInkInputEvents(state, '', { upArrow: true }, { branchCount: 5 })
      expect(events).toEqual([])
    })

    it('↓ from the header re-enters the items list at index 0', () => {
      const state = { ...sidebarBranchesState(), sidebarHeaderFocused: true }
      const events = getLogInkInputEvents(state, '', { downArrow: true }, { branchCount: 5 })
      expect(events).toEqual([
        { type: 'action', action: { type: 'setSidebarHeaderFocused', value: false } },
      ])
    })

    it('↑ at items index 0 promotes onto the header for tags / stashes / worktrees too', () => {
      const tags = { ...createLogInkState(rows), focus: 'sidebar' as const, sidebarTab: 'tags' as const }
      expect(getLogInkInputEvents(tags, '', { upArrow: true }, { tagCount: 3 })).toEqual([
        { type: 'action', action: { type: 'setSidebarHeaderFocused', value: true } },
      ])

      const stashes = { ...createLogInkState(rows), focus: 'sidebar' as const, sidebarTab: 'stashes' as const }
      expect(getLogInkInputEvents(stashes, '', { upArrow: true }, { stashCount: 2 })).toEqual([
        { type: 'action', action: { type: 'setSidebarHeaderFocused', value: true } },
      ])

      const worktrees = { ...createLogInkState(rows), focus: 'sidebar' as const, sidebarTab: 'worktrees' as const }
      expect(getLogInkInputEvents(worktrees, '', { upArrow: true }, { worktreeListCount: 1 })).toEqual([
        { type: 'action', action: { type: 'setSidebarHeaderFocused', value: true } },
      ])
    })

    it('does not promote onto the header when the cursor is past index 0', () => {
      // selectedBranchIndex = 2 — ↑ should still dispatch moveBranch
      // toward index 1, not jump to the header.
      const state = { ...sidebarBranchesState(), selectedBranchIndex: 2 }
      const events = getLogInkInputEvents(state, '', { upArrow: true }, { branchCount: 5 })
      expect(events).toEqual([
        { type: 'action', action: { type: 'moveBranch', delta: -1, count: 5 } },
      ])
    })

    it('Enter on a header-focused sidebar drills into the dedicated view', () => {
      // Even when the tab has items + a primary action, header focus
      // overrides — Enter explicitly opens the dedicated view.
      const state = { ...sidebarBranchesState(), sidebarHeaderFocused: true }
      const events = getLogInkInputEvents(
        state,
        '',
        { return: true },
        { branchCount: 5 },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'pushView', value: 'branches' } },
        { type: 'action', action: { type: 'setFocus', value: 'commits' } },
      ])
    })

    it('Enter on items (not header-focused) still fires the per-entity action', () => {
      // Sanity check: the existing per-entity Enter path still wins
      // when the cursor is on items.
      const events = getLogInkInputEvents(
        sidebarBranchesState(),
        '',
        { return: true },
        { branchCount: 5 },
      )
      expect(events).toContainEqual({ type: 'runWorkflowAction', id: 'checkout-branch' })
    })

    it('does not promote onto the header on empty content tabs', () => {
      // No items → ↑ falls through to the existing tab-cycle fallback
      // (no header to escape to in the items-less case; user can use
      // ←/→ for tab switching anyway).
      const empty = { ...sidebarBranchesState(), selectedBranchIndex: 0 }
      const events = getLogInkInputEvents(empty, '', { upArrow: true }, { branchCount: 0 })
      expect(events.find((e) =>
        e.type === 'action' && e.action.type === 'setSidebarHeaderFocused'
      )).toBeUndefined()
    })
  })

  // Status surface three-tier nav (#791 follow-up). ←/→ jumps between
  // staged / unstaged / untracked groups; ↑ at the top of a group
  // promotes onto the header; Enter on the header fires the group's
  // batch workflow.
  describe('status group three-tier navigation', () => {
    function statusState(overrides: Partial<LogInkState> = {}) {
      const base = createLogInkState(rows)
      return {
        ...base,
        focus: 'commits' as const,
        activeView: 'status' as const,
        viewStack: ['status'] as LogInkState['viewStack'],
        ...overrides,
      }
    }

    const groups = [
      { state: 'staged' as const, count: 2, startIndex: 0 },
      { state: 'unstaged' as const, count: 3, startIndex: 2 },
      { state: 'untracked' as const, count: 1, startIndex: 5 },
    ]

    it('→ jumps to the next group\'s first file', () => {
      const events = getLogInkInputEvents(
        statusState({ selectedWorktreeFileIndex: 0 }),
        '',
        { rightArrow: true },
        { worktreeFileCount: 6, statusGroups: groups },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'jumpToStatusGroup', targetIndex: 2 } },
      ])
    })

    it('← from the unstaged group jumps back to staged', () => {
      const events = getLogInkInputEvents(
        statusState({ selectedWorktreeFileIndex: 3 }),
        '',
        { leftArrow: true },
        { worktreeFileCount: 6, statusGroups: groups },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'jumpToStatusGroup', targetIndex: 0 } },
      ])
    })

    it('→ at the last group is a no-op', () => {
      const events = getLogInkInputEvents(
        statusState({ selectedWorktreeFileIndex: 5 }),
        '',
        { rightArrow: true },
        { worktreeFileCount: 6, statusGroups: groups },
      )
      expect(events).toEqual([])
    })

    it('↑ at the first file of the unstaged group promotes onto the header', () => {
      const events = getLogInkInputEvents(
        statusState({ selectedWorktreeFileIndex: 2 }),
        '',
        { upArrow: true },
        { worktreeFileCount: 6, statusGroups: groups },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'setStatusGroupHeaderFocused', value: true } },
      ])
    })

    it('↑ in the middle of a group falls through to moveWorktreeFile', () => {
      const events = getLogInkInputEvents(
        statusState({ selectedWorktreeFileIndex: 3 }),
        '',
        { upArrow: true },
        { worktreeFileCount: 6, statusGroups: groups },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'moveWorktreeFile', delta: -1, fileCount: 6 } },
      ])
    })

    it('↑ when header focused is a no-op', () => {
      const events = getLogInkInputEvents(
        statusState({ selectedWorktreeFileIndex: 2, statusGroupHeaderFocused: true }),
        '',
        { upArrow: true },
        { worktreeFileCount: 6, statusGroups: groups },
      )
      expect(events).toEqual([])
    })

    it('↓ when header focused clears the flag (cursor stays on first file)', () => {
      const events = getLogInkInputEvents(
        statusState({ selectedWorktreeFileIndex: 2, statusGroupHeaderFocused: true }),
        '',
        { downArrow: true },
        { worktreeFileCount: 6, statusGroups: groups },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'setStatusGroupHeaderFocused', value: false } },
      ])
    })

    it('Enter on staged-group header fires unstage-all-staged', () => {
      const events = getLogInkInputEvents(
        statusState({ selectedWorktreeFileIndex: 0, statusGroupHeaderFocused: true }),
        '',
        { return: true },
        { worktreeFileCount: 6, statusGroups: groups },
      )
      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'unstage-all-staged', payload: 'staged' },
      ])
    })

    it('Enter on unstaged-group header fires stage-all-unstaged', () => {
      const events = getLogInkInputEvents(
        statusState({ selectedWorktreeFileIndex: 3, statusGroupHeaderFocused: true }),
        '',
        { return: true },
        { worktreeFileCount: 6, statusGroups: groups },
      )
      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'stage-all-unstaged', payload: 'unstaged' },
      ])
    })

    it('Enter on untracked-group header fires stage-all-untracked', () => {
      const events = getLogInkInputEvents(
        statusState({ selectedWorktreeFileIndex: 5, statusGroupHeaderFocused: true }),
        '',
        { return: true },
        { worktreeFileCount: 6, statusGroups: groups },
      )
      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'stage-all-untracked', payload: 'untracked' },
      ])
    })

    it('Enter on a file (not header focused) still opens the diff', () => {
      const events = getLogInkInputEvents(
        statusState({ selectedWorktreeFileIndex: 1 }),
        '',
        { return: true },
        { worktreeFileCount: 6, statusGroups: groups },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'navigateOpenDiffForWorktreeFile', fileIndex: 1 } },
      ])
    })

    it('←/→ does nothing when only one group is visible (mask narrowed)', () => {
      const onlyStaged = [{ state: 'staged' as const, count: 2, startIndex: 0 }]
      const events = getLogInkInputEvents(
        statusState({ selectedWorktreeFileIndex: 0 }),
        '',
        { rightArrow: true },
        { worktreeFileCount: 2, statusGroups: onlyStaged },
      )
      // Falls through to the next handler — no jumpToStatusGroup
      // event in the dispatch list.
      expect(events.find((e) =>
        e.type === 'action' && e.action.type === 'jumpToStatusGroup'
      )).toBeUndefined()
    })
  })

  // Inspector Actions cursor (#791 follow-up). When focus=detail and
  // inspectorTab=actions, ↑/↓ navigates the actions list; Enter on
  // the cursored action fires its event. Cursor model only kicks in
  // when actions exist for the current entity context.
  describe('inspector actions cursor', () => {
    function actionsFocusState(overrides: Partial<LogInkState> = {}) {
      const base = createLogInkState(rows)
      return {
        ...base,
        focus: 'detail' as const,
        inspectorTab: 'actions' as const,
        ...overrides,
      }
    }

    it('↑ moves the cursor up through the actions list', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorActionIndex: 3 }),
        '',
        { upArrow: true },
        { inspectorActionCount: 8 },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'moveInspectorAction', delta: -1, actionCount: 8 } },
      ])
    })

    it('↓ moves the cursor down through the actions list', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorActionIndex: 0 }),
        '',
        { downArrow: true },
        { inspectorActionCount: 8 },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'moveInspectorAction', delta: 1, actionCount: 8 } },
      ])
    })

    it('↑/↓ falls through to moveDetailFile when inspectorTab=inspector', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorTab: 'inspector', inspectorActionIndex: 0 }),
        '',
        { upArrow: true },
        { inspectorActionCount: 8, detailFileCount: 5 },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'moveDetailFile', delta: -1, fileCount: 5 } },
      ])
    })

    it('Enter on the first action (open diff) navigates to the diff', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorActionIndex: 0 }),
        '',
        { return: true },
        { inspectorActionCount: 8 },
      )
      const firstCommit = rows.find((r) => r.type === 'commit')
      const sha = firstCommit && firstCommit.type === 'commit' ? firstCommit.hash : ''
      expect(events).toEqual([
        { type: 'action', action: { type: 'navigateOpenDiffForCommit', sha, commitIndex: 0 } },
      ])
    })

    it('Enter on cherry-pick (index 1) opens the y-confirm', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorActionIndex: 1 }),
        '',
        { return: true },
        { inspectorActionCount: 8 },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'setPendingConfirmation', value: 'cherry-pick-commit' } },
      ])
    })

    it('Enter on revert (index 2) opens the y-confirm for revert-commit', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorActionIndex: 2 }),
        '',
        { return: true },
        { inspectorActionCount: 8 },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'setPendingConfirmation', value: 'revert-commit' } },
      ])
    })

    it('Enter on reset (index 3) opens the reset-mode prompt', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorActionIndex: 3 }),
        '',
        { return: true },
        { inspectorActionCount: 8 },
      )
      expect(events).toEqual([
        {
          type: 'action',
          action: {
            type: 'openInputPrompt',
            kind: 'reset-mode',
            label: 'Reset mode (soft / mixed / hard)',
          },
        },
      ])
    })

    it('Enter on yank (index 5) fires yankFromActiveView', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorActionIndex: 5 }),
        '',
        { return: true },
        { inspectorActionCount: 8 },
      )
      expect(events).toEqual([{ type: 'yankFromActiveView' }])
    })

    it('Enter on yank short (index 6) fires yankFromActiveView with short=true', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorActionIndex: 6 }),
        '',
        { return: true },
        { inspectorActionCount: 8 },
      )
      expect(events).toEqual([{ type: 'yankFromActiveView', short: true }])
    })

    it('Enter on open in browser (index 7) fires open-pr workflow', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorActionIndex: 7 }),
        '',
        { return: true },
        { inspectorActionCount: 8 },
      )
      expect(events).toEqual([{ type: 'runWorkflowAction', id: 'open-pr' }])
    })

    it('Enter on inspector tab (not actions) falls through to existing diff handler', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorTab: 'inspector' }),
        '',
        { return: true },
        { inspectorActionCount: 8, detailFileCount: 3 },
      )
      // Diff-for-file path, not an action invoke.
      const types = events.map((e) =>
        e.type === 'action' ? e.action.type : e.type
      )
      expect(types).toEqual(['navigateOpenDiffForCommit'])
    })

    it('Enter on actions tab when no commit selected emits a status hint', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorActionIndex: 1, selectedIndex: 99 }),
        '',
        { return: true },
        { inspectorActionCount: 8 },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'setStatus', value: 'No commit selected' } },
      ])
    })

    // ←/→ for inspector tab switching mirrors the sidebar pattern. The
    // bracketed `[/]` notation that previously appeared in the chrome
    // hint read as "press the / key" — which collides with the global
    // filter trigger and was confusing users. Arrow keys are
    // unambiguous + match the sidebar's existing left/right tab axis.
    it('← on detail focus switches to the Inspector tab', () => {
      const events = getLogInkInputEvents(
        actionsFocusState(),
        '',
        { leftArrow: true },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'setInspectorTab', value: 'inspector' } },
      ])
    })

    it('→ on detail focus switches to the Actions tab', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorTab: 'inspector' }),
        '',
        { rightArrow: true },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'setInspectorTab', value: 'actions' } },
      ])
    })

    it('←/→ on detail focus does not affect the global filter trigger', () => {
      // The original `[/] switch` chrome hint suggested pressing `/` —
      // which fires the global filter, not the inspector tab swap.
      // ←/→ should fire setInspectorTab and nothing else; the global
      // filter event (`toggleFilterMode`) must not appear in the
      // dispatch list.
      const left = getLogInkInputEvents(actionsFocusState(), '', { leftArrow: true })
      const right = getLogInkInputEvents(actionsFocusState({ inspectorTab: 'inspector' }), '', { rightArrow: true })
      for (const events of [left, right]) {
        expect(events.find((e) =>
          e.type === 'action' && e.action.type === 'toggleFilterMode'
        )).toBeUndefined()
      }
    })

    it('[/] keep working as alternates', () => {
      // Existing keyboard alternates stay so muscle memory carries.
      const lbracket = getLogInkInputEvents(actionsFocusState(), '[', {})
      const rbracket = getLogInkInputEvents(actionsFocusState({ inspectorTab: 'inspector' }), ']', {})
      expect(lbracket).toEqual([
        { type: 'action', action: { type: 'cycleInspectorTab', delta: -1 } },
      ])
      expect(rbracket).toEqual([
        { type: 'action', action: { type: 'cycleInspectorTab', delta: 1 } },
      ])
    })
  })
})
