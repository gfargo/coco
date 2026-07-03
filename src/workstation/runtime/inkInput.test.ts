import { GitLogRow } from '../../commands/log/data'
import {
  getLogInkInputEvents,
  getLogInkPaletteExecuteEvents,
  isCreatePrView,
  isCreateStashView,
} from './inkInput'
import { getLogInkPaletteCommands } from './inkKeymap'
import { LogInkState, LogInkView, applyLogInkAction, createLogInkState } from './inkViewModel'
import { getLogInkLayout } from '../chrome/layout'

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

  describe('view-keys which-key strip (g?, #1137)', () => {
    it('opens the strip from the g? chord, leaving bare ? as full help', () => {
      let state = createLogInkState(rows)

      // Bare ? still toggles full help.
      state = applyInput(state, '?')
      expect(state.showHelp).toBe(true)
      expect(state.showViewKeys).toBe(false)
      state = applyInput(state, '?')
      expect(state.showHelp).toBe(false)

      // g then ? opens the per-view strip (not full help).
      state = applyInput(state, 'g')
      expect(state.pendingKey).toBe('g')
      state = applyInput(state, '?')
      expect(state.showViewKeys).toBe(true)
      expect(state.showHelp).toBe(false)
      expect(state.pendingKey).toBeUndefined()
    })

    it('Esc closes the strip; ? steps up to full help', () => {
      let state = createLogInkState(rows)

      state = applyInput(state, 'g')
      state = applyInput(state, '?')
      expect(state.showViewKeys).toBe(true)

      // Esc closes.
      state = applyInput(state, '', { escape: true })
      expect(state.showViewKeys).toBe(false)

      // Reopen, then ? expands to the full categorized help.
      state = applyInput(state, 'g')
      state = applyInput(state, '?')
      expect(state.showViewKeys).toBe(true)
      state = applyInput(state, '?')
      expect(state.showViewKeys).toBe(false)
      expect(state.showHelp).toBe(true)
    })

    it('swallows other keys while the strip is open and still quits on q', () => {
      let state = createLogInkState(rows)
      state = applyInput(state, 'g')
      state = applyInput(state, '?')
      expect(state.showViewKeys).toBe(true)

      // A per-view action key is swallowed — the strip stays open and no
      // selection moves (the user peeks, then dismisses).
      const before = state.selectedIndex
      state = applyInput(state, 'j')
      expect(state.showViewKeys).toBe(true)
      expect(state.selectedIndex).toBe(before)

      // q still quits (emits a non-action exit event).
      const events = getLogInkInputEvents(state, 'q')
      expect(events).toEqual([{ type: 'exit' }])
    })

    it('opens the strip from the command palette entry', () => {
      const command = getLogInkPaletteCommands().find((c) => c.id === 'viewKeys')
      expect(command).toBeDefined()
      const events = getLogInkPaletteExecuteEvents(command!, createLogInkState(rows))
      expect(events).toEqual([{ type: 'action', action: { type: 'toggleViewKeys' } }])
    })
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

    // Since 0.54.x the default `fullGraph` is true; first `\\` flips
    // to compact, second flips back to full.
    state = applyInput(state, '\\')
    expect(state.fullGraph).toBe(false)

    state = applyInput(state, '\\')
    expect(state.fullGraph).toBe(true)

    // gg jump to top: first 'g' is a pure prefix, second 'g' fires moveToTop.
    state = applyLogInkAction(state, { type: 'move', delta: 2 })
    expect(state.selectedIndex).toBeGreaterThan(0)

    state = applyInput(state, 'g')
    expect(state.pendingKey).toBe('g')

    state = applyInput(state, 'g')
    expect(state.selectedIndex).toBe(0)
    expect(state.statusMessage).toBe('jumped to first commit')
  })

  it('Tab/Shift+Tab cycles the visible pane in single-pane mode', () => {
    // On narrow terminals the visible pane is derived from focus, so
    // the existing focus-cycle binding drives the pane switch with no
    // new key. Cycle order (FOCUS_ORDER): sidebar → main → inspector.
    const paneFor = (state: LogInkState) =>
      getLogInkLayout({
        columns: 80,
        rows: 24,
        sidebarFocused: state.focus === 'sidebar',
        inspectorFocused: state.focus === 'detail',
      }).visiblePane

    let state = createLogInkState(rows)
    expect(state.focus).toBe('commits')
    expect(paneFor(state)).toBe('main')

    state = applyInput(state, '', { tab: true })
    expect(paneFor(state)).toBe('inspector')

    state = applyInput(state, '', { tab: true })
    expect(paneFor(state)).toBe('sidebar')

    state = applyInput(state, '', { tab: true })
    expect(paneFor(state)).toBe('main')

    // Shift+Tab walks the cycle the other way.
    state = applyInput(state, '', { tab: true, shift: true })
    expect(paneFor(state)).toBe('sidebar')
  })

  it('moves commits and sidebar tabs with arrows, vim keys, and direct jumps', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, 'j')
    expect(state.selectedIndex).toBe(1)

    state = applyInput(state, 'k')
    expect(state.selectedIndex).toBe(0)

    // Default sidebar tab is 'branches' — arrow / bracket navigation
    // starts from there.
    state = applyLogInkAction(state, { type: 'setFocus', value: 'sidebar' })
    state = applyInput(state, '', { downArrow: true })
    expect(state.sidebarTab).toBe('tags')

    state = applyInput(state, '', { upArrow: true })
    expect(state.sidebarTab).toBe('branches')

    state = applyInput(state, ']')
    expect(state.sidebarTab).toBe('tags')

    state = applyInput(state, '[')
    expect(state.sidebarTab).toBe('branches')

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

    // In the worktree (staging) diff, j/↓ scroll LINES — consistent with
    // the commit/stash diffs (#1185). `[`/`]` jump between hunks.
    state = applyInput(state, 'j', {}, {
      worktreeDiffLineCount: 30,
      worktreeHunkOffsets: [2, 12, 20],
    })
    expect(state.worktreeDiffOffset).toBe(9)

    // `]` jumps the offset onto the next hunk header (12, then 20).
    state = applyInput(state, ']', {}, {
      worktreeDiffLineCount: 30,
      worktreeHunkOffsets: [2, 12, 20],
    })
    expect(state.worktreeDiffOffset).toBe(12)

    state = applyInput(state, ']', {}, {
      worktreeDiffLineCount: 30,
      worktreeHunkOffsets: [2, 12, 20],
    })
    expect(state.worktreeDiffOffset).toBe(20)

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

  describe('per-branch F / U / P when branches sidebar is focused', () => {
    // When the cursor is on the branches sidebar with at least one branch,
    // F / U / P should fire the *-selected-branch workflows instead of
    // the global *-current-branch / fetch-remotes variants. The user's
    // attention is on the cursored row, so the keys should follow.

    function branchSidebarState(): ReturnType<typeof createLogInkState> {
      const state = createLogInkState(rows)
      return {
        ...state,
        focus: 'sidebar',
        sidebarTab: 'branches',
      }
    }

    it('routes F to fetch-selected-branch when branches sidebar focused with items', () => {
      const events = getLogInkInputEvents(
        branchSidebarState(), 'F', {}, { branchCount: 3 }
      )
      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'fetch-selected-branch' },
      ])
    })

    it('routes U to pull-selected-branch when branches sidebar focused with items', () => {
      const events = getLogInkInputEvents(
        branchSidebarState(), 'U', {}, { branchCount: 3 }
      )
      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'pull-selected-branch' },
      ])
    })

    it('routes P to push-selected-branch when branches sidebar focused with items', () => {
      const events = getLogInkInputEvents(
        branchSidebarState(), 'P', {}, { branchCount: 3 }
      )
      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'push-selected-branch' },
      ])
    })

    it('falls through to global fetch-remotes when branches sidebar has no items', () => {
      const events = getLogInkInputEvents(
        branchSidebarState(), 'F', {}, { branchCount: 0 }
      )
      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'fetch-remotes' },
      ])
    })

    it('falls through to global pull-current-branch when not on the branches sidebar', () => {
      // Focus on commits (history view), sidebar tab on branches but
      // not focused — global ops should run.
      const state = createLogInkState(rows)
      const events = getLogInkInputEvents(state, 'U', {}, { branchCount: 3 })
      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'pull-current-branch' },
      ])
    })

    it('also routes per-branch ops when the user is on the dedicated branches view', () => {
      // The branches view (`gb`) is the other target where the cursor
      // is on a branch row — `isBranchActionTarget` matches both.
      const state = createLogInkState(rows, { activeView: 'branches' })
      const events = getLogInkInputEvents(state, 'P', {}, { branchCount: 3 })
      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'push-selected-branch' },
      ])
    })
  })

  describe('r rebase-onto on the branches view (#0.71)', () => {
    // `r` is the global refresh everywhere — on the branches view it is
    // intercepted FIRST to mean "rebase current onto cursored ref",
    // routed through the y-confirm gate with a warning naming both
    // branches. Guards short-circuit a self-rebase / detached HEAD.

    it('routes r to the rebase-onto confirmation with a branch-naming warning', () => {
      const state = createLogInkState(rows, { activeView: 'branches' })
      const events = getLogInkInputEvents(state, 'r', {}, {
        branchCount: 3,
        currentBranch: 'feature',
        branchSelectedShortName: 'main',
      })
      expect(events).toEqual([
        {
          type: 'action',
          action: {
            type: 'setPendingConfirmation',
            value: 'rebase-onto-branch',
            payload: "Rebase feature onto main? This rewrites feature's history.",
          },
        },
      ])
    })

    it('blocks a self-rebase with a clear warning instead of confirming', () => {
      const state = createLogInkState(rows, { activeView: 'branches' })
      const events = getLogInkInputEvents(state, 'r', {}, {
        branchCount: 3,
        currentBranch: 'main',
        branchSelectedShortName: 'main',
      })
      expect(events).toEqual([
        {
          type: 'action',
          action: {
            type: 'setStatus',
            value: 'Cannot rebase a branch onto itself.',
            kind: 'warning',
          },
        },
      ])
    })

    it('blocks a rebase on detached HEAD (no current branch)', () => {
      const state = createLogInkState(rows, { activeView: 'branches' })
      const events = getLogInkInputEvents(state, 'r', {}, {
        branchCount: 3,
        currentBranch: undefined,
        branchSelectedShortName: 'main',
      })
      expect(events).toEqual([
        {
          type: 'action',
          action: {
            type: 'setStatus',
            value: 'Detached HEAD — checkout a branch before rebasing onto a ref.',
            kind: 'warning',
          },
        },
      ])
    })

    it('still falls through to the global refresh outside the branches view', () => {
      const state = createLogInkState(rows, { activeView: 'history' })
      expect(getLogInkInputEvents(state, 'r', {}, {
        branchCount: 3,
        currentBranch: 'feature',
        branchSelectedShortName: 'main',
      })).toEqual([{ type: 'refreshContext' }])
    })
  })

  describe('help overlay key handling', () => {
    it('j/k scroll the help overlay without changing focus', () => {
      let state = createLogInkState(rows)
      state = applyInput(state, '?')
      expect(state.showHelp).toBe(true)
      const focusBefore = state.focus

      state = applyInput(state, 'j')
      expect(state.helpScrollOffset).toBe(1)
      expect(state.focus).toBe(focusBefore)

      state = applyInput(state, 'j')
      expect(state.helpScrollOffset).toBe(2)

      state = applyInput(state, 'k')
      expect(state.helpScrollOffset).toBe(1)
      expect(state.focus).toBe(focusBefore)
    })

    it('arrow keys scroll the help overlay', () => {
      let state = createLogInkState(rows)
      state = applyInput(state, '?')
      state = applyInput(state, '', { downArrow: true })
      expect(state.helpScrollOffset).toBe(1)
      state = applyInput(state, '', { upArrow: true })
      expect(state.helpScrollOffset).toBe(0)
    })

    it('Ctrl-d / Ctrl-u half-page scroll', () => {
      let state = createLogInkState(rows)
      state = applyInput(state, '?')
      state = applyInput(state, 'd', { ctrl: true })
      expect(state.helpScrollOffset).toBe(10)
      state = applyInput(state, 'u', { ctrl: true })
      expect(state.helpScrollOffset).toBe(0)
    })

    it('swallows non-scroll keys instead of letting them fall through', () => {
      let state = createLogInkState(rows)
      const originalSelectedIndex = state.selectedIndex
      state = applyInput(state, '?')
      expect(state.showHelp).toBe(true)

      // Bracket keys would normally switch sidebar tabs — must be a no-op
      // here. The user can't accidentally walk into a different tab from
      // help and end up confused when they close it.
      const sidebarBefore = state.sidebarTab
      state = applyInput(state, ']')
      expect(state.sidebarTab).toBe(sidebarBefore)
      state = applyInput(state, '[')
      expect(state.sidebarTab).toBe(sidebarBefore)

      // gg would normally jump to top. Help is open, so it's a no-op.
      state = applyInput(state, 'g')
      state = applyInput(state, 'g')
      expect(state.selectedIndex).toBe(originalSelectedIndex)

      // /? would normally start filter mode. Help is open, so it's a no-op.
      state = applyInput(state, '/')
      expect(state.filterMode).toBe(false)
      expect(state.showHelp).toBe(true)
    })

    it('? toggles help closed from within help mode', () => {
      let state = createLogInkState(rows)
      state = applyInput(state, '?')
      state = applyInput(state, 'j')
      state = applyInput(state, '?')
      expect(state.showHelp).toBe(false)
    })
  })

  it('clears pending key chords after unrelated actions', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, 'g')
    expect(state.pendingKey).toBe('g')

    // `/` is not a `g`-continuation, so it resolves as the global filter
    // toggle and clears the stale chord. (`?` is no longer "unrelated" — it
    // forms the `g?` view-keys chord, covered separately below.)
    state = applyInput(state, '/')
    expect(state.filterMode).toBe(true)
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

  it('stashes all changes with the gZ chord — even from status, where bare S is the split flow', () => {
    let state = createLogInkState(rows)
    // status is one of the views where `S` is claimed by commit-split, so
    // the chord is the only single-gesture stash-create path here.
    state = applyLogInkAction(state, { type: 'pushView', value: 'status' })
    state = applyInput(state, 'g')

    const events = getLogInkInputEvents(state, 'Z')
    expect(events[0]).toMatchObject({
      type: 'action',
      action: { type: 'openInputPrompt', kind: 'create-stash' },
    })
  })

  it('opens the stash prompt from the createStash palette command', () => {
    const state = createLogInkState(rows)
    const command = getLogInkPaletteCommands().find((c) => c.id === 'createStash')
    if (!command) throw new Error('createStash palette command missing')

    const events = getLogInkPaletteExecuteEvents(command, state)
    expect(events[0]).toMatchObject({
      type: 'action',
      action: { type: 'openInputPrompt', kind: 'create-stash' },
    })
  })

  describe('stash view power actions', () => {
    function stashViewState() {
      return applyLogInkAction(createLogInkState(rows), { type: 'pushView', value: 'stash' })
    }

    it('R opens the rename-stash prompt', () => {
      const events = getLogInkInputEvents(stashViewState(), 'R', {}, { stashCount: 2 })
      expect(events[0]).toMatchObject({ type: 'action', action: { type: 'openInputPrompt', kind: 'rename-stash' } })
    })

    it('b opens the stash-branch prompt', () => {
      const events = getLogInkInputEvents(stashViewState(), 'b', {}, { stashCount: 2 })
      expect(events[0]).toMatchObject({ type: 'action', action: { type: 'openInputPrompt', kind: 'stash-branch' } })
    })

    it('A applies restoring the index', () => {
      const events = getLogInkInputEvents(stashViewState(), 'A', {}, { stashCount: 2 })
      expect(events).toEqual([{ type: 'runWorkflowAction', id: 'apply-stash-index' }])
    })

    it('u undoes the last drop — available even when the list is now empty', () => {
      const events = getLogInkInputEvents(stashViewState(), 'u', {}, { stashCount: 0 })
      expect(events).toEqual([{ type: 'runWorkflowAction', id: 'undo-drop-stash' }])
    })

    it('submitting an EMPTY create-stash prompt fires a WIP stash (does not bounce)', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, {
        type: 'openInputPrompt',
        kind: 'create-stash',
        label: 'Stash message (empty = WIP)',
      })
      const events = getLogInkInputEvents(state, '', { return: true })
      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'create-stash', payload: '' },
        { type: 'action', action: { type: 'closeInputPrompt' } },
      ])
    })
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

  it('pushes reflog with the gr chord (#781)', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, 'g')
    state = applyInput(state, 'r')

    expect(state.viewStack).toEqual(['history', 'reflog'])
    expect(state.activeView).toBe('reflog')
    expect(state.statusMessage).toBe('jumped to reflog')
  })

  it('moves the selected reflog entry with arrow keys when in reflog view (#781)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'reflog' })

    state = applyInput(state, 'j', {}, { reflogCount: 4 })
    state = applyInput(state, 'j', {}, { reflogCount: 4 })
    expect(state.selectedReflogIndex).toBe(2)

    state = applyInput(state, 'k', {}, { reflogCount: 4 })
    expect(state.selectedReflogIndex).toBe(1)

    // Clamped at the count boundary going up.
    state = applyInput(state, 'k', {}, { reflogCount: 4 })
    state = applyInput(state, 'k', {}, { reflogCount: 4 })
    expect(state.selectedReflogIndex).toBe(0)
  })

  it('moves the selected submodule with arrow keys when in submodules view (#932)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'submodules' })

    state = applyInput(state, 'j', {}, { submoduleCount: 3 })
    state = applyInput(state, 'j', {}, { submoduleCount: 3 })
    expect(state.selectedSubmoduleIndex).toBe(2)

    state = applyInput(state, 'k', {}, { submoduleCount: 3 })
    expect(state.selectedSubmoduleIndex).toBe(1)

    // Clamped at zero going up past the boundary.
    state = applyInput(state, 'k', {}, { submoduleCount: 3 })
    state = applyInput(state, 'k', {}, { submoduleCount: 3 })
    expect(state.selectedSubmoduleIndex).toBe(0)
  })

  it('Enter on a reflog row drills into the diff for that hash (#781)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'reflog' })

    const events = getLogInkInputEvents(state, '', { return: true }, {
      reflogCount: 5,
      reflogSelectedHash: 'abc1234',
    })

    const navigate = events.find((event) =>
      event.type === 'action' && event.action.type === 'navigateOpenDiffForCommit'
    )
    expect(navigate).toBeDefined()
    if (navigate && navigate.type === 'action' && navigate.action.type === 'navigateOpenDiffForCommit') {
      expect(navigate.action.sha).toBe('abc1234')
    }
  })

  it('Enter on a reflog row is a no-op when no entry is cursored (#781)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'reflog' })

    const events = getLogInkInputEvents(state, '', { return: true }, {
      reflogCount: 0,
      reflogSelectedHash: undefined,
    })

    expect(events.find((event) =>
      event.type === 'action' && event.action.type === 'navigateOpenDiffForCommit'
    )).toBeUndefined()
  })

  it('marks the cursored branch as compare base on m (#779)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'branches' })

    state = applyInput(state, 'm', {}, {
      branchCount: 3,
      branchSelectedShortName: 'main',
    })

    expect(state.compareBase).toEqual({ kind: 'branch', ref: 'main', label: 'main' })
    expect(state.statusMessage).toContain('Compare base: main')
  })

  it('toggles the compare base off when m is pressed on the same ref (#779)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'branches' })

    state = applyInput(state, 'm', {}, {
      branchCount: 3,
      branchSelectedShortName: 'main',
    })
    expect(state.compareBase?.ref).toBe('main')

    state = applyInput(state, 'm', {}, {
      branchCount: 3,
      branchSelectedShortName: 'main',
    })
    expect(state.compareBase).toBeUndefined()
    expect(state.statusMessage).toContain('Cleared compare base')
  })

  it('replaces the compare base when m is pressed on a different ref (#779)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'tags' })

    state = applyInput(state, 'm', {}, {
      tagCount: 3,
      tagSelectedName: 'v1.0',
    })
    expect(state.compareBase).toEqual({ kind: 'tag', ref: 'v1.0', label: 'v1.0' })

    state = applyInput(state, 'm', {}, {
      tagCount: 3,
      tagSelectedName: 'v2.0',
    })
    expect(state.compareBase).toEqual({ kind: 'tag', ref: 'v2.0', label: 'v2.0' })
  })

  it('Enter on a second ref dispatches navigateOpenDiffForCompare with base + head (#779)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'branches' })

    // Mark base from branches.
    state = applyInput(state, 'm', {}, {
      branchCount: 3,
      branchSelectedShortName: 'main',
    })
    expect(state.compareBase?.ref).toBe('main')

    // Switch to tags and press Enter on a tag — Enter override fires.
    state = applyLogInkAction(state, { type: 'pushView', value: 'tags' })
    const events = getLogInkInputEvents(state, '', { return: true }, {
      tagCount: 3,
      tagSelectedName: 'v1.0',
    })

    const compare = events.find((event) =>
      event.type === 'action' && event.action.type === 'navigateOpenDiffForCompare'
    )
    expect(compare).toBeDefined()
    if (compare && compare.type === 'action' && compare.action.type === 'navigateOpenDiffForCompare') {
      expect(compare.action.base).toEqual({ kind: 'branch', ref: 'main', label: 'main' })
      expect(compare.action.head).toEqual({ kind: 'tag', ref: 'v1.0', label: 'v1.0' })
    }
  })

  it('Enter on the same ref as the compare base shows a hint (#779)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'branches' })

    state = applyInput(state, 'm', {}, {
      branchCount: 3,
      branchSelectedShortName: 'main',
    })

    const events = getLogInkInputEvents(state, '', { return: true }, {
      branchCount: 3,
      branchSelectedShortName: 'main',
    })

    expect(events.find((event) =>
      event.type === 'action' && event.action.type === 'navigateOpenDiffForCompare'
    )).toBeUndefined()
    const status = events.find((event) =>
      event.type === 'action' && event.action.type === 'setStatus'
    )
    expect(status).toBeDefined()
  })

  it('clears the compare base when the diff view is popped (#779)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'branches' })

    // Mark base + open compare diff.
    state = applyInput(state, 'm', {}, {
      branchCount: 3,
      branchSelectedShortName: 'main',
    })
    state = applyLogInkAction(state, {
      type: 'navigateOpenDiffForCompare',
      base: { kind: 'branch', ref: 'main', label: 'main' },
      head: { kind: 'tag', ref: 'v1.0', label: 'v1.0' },
    })
    expect(state.activeView).toBe('diff')
    expect(state.compareBase?.ref).toBe('main')
    expect(state.compareHead?.ref).toBe('v1.0')

    // Pop the diff — compareBase + compareHead both clear.
    state = applyLogInkAction(state, { type: 'popView' })
    expect(state.activeView).toBe('branches')
    expect(state.compareBase).toBeUndefined()
    expect(state.compareHead).toBeUndefined()
  })

  it('Enter on a history commit row uses its hash as the compare head (#779)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, {
      type: 'setCompareBase',
      value: { kind: 'branch', ref: 'main', label: 'main' },
    })

    // History view, default cursor on commit at index 0.
    const events = getLogInkInputEvents(state, '', { return: true }, {})

    const compare = events.find((event) =>
      event.type === 'action' && event.action.type === 'navigateOpenDiffForCompare'
    )
    expect(compare).toBeDefined()
    if (compare && compare.type === 'action' && compare.action.type === 'navigateOpenDiffForCompare') {
      expect(compare.action.base.ref).toBe('main')
      expect(compare.action.head.kind).toBe('commit')
      // Hash matches the cursored commit (rows[0] is a commit row in this fixture).
      expect(compare.action.head.ref).toBeTruthy()
    }
  })

  it('pushes bisect with the gB chord (capital disambiguates from gb branches) (#784)', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, 'g')
    state = applyInput(state, 'B')

    expect(state.viewStack).toEqual(['history', 'bisect'])
    expect(state.activeView).toBe('bisect')
    expect(state.statusMessage).toBe('jumped to bisect')
  })

  it('pushes submodules with the gM chord (#932)', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, 'g')
    state = applyInput(state, 'M')

    expect(state.viewStack).toEqual(['history', 'submodules'])
    expect(state.activeView).toBe('submodules')
    expect(state.statusMessage).toBe('jumped to submodules')
  })

  it('j/k on the submodules view dispatches moveSubmodule (#932)', () => {
    let state = createLogInkState(rows, { activeView: 'submodules' })
    state = applyLogInkAction(state, { type: 'setBootLoading', value: false })

    const downEvents = getLogInkInputEvents(state, 'j', {}, { submoduleCount: 3 })
    expect(downEvents).toContainEqual({
      type: 'action',
      action: { type: 'moveSubmodule', delta: 1, count: 3 },
    })

    const upEvents = getLogInkInputEvents(state, 'k', {}, { submoduleCount: 3 })
    expect(upEvents).toContainEqual({
      type: 'action',
      action: { type: 'moveSubmodule', delta: -1, count: 3 },
    })

    // Zero submodules → no move action (falls through to the default).
    const emptyEvents = getLogInkInputEvents(state, 'j', {}, { submoduleCount: 0 })
    expect(emptyEvents.find((e) =>
      e.type === 'action' && (e.action as { type: string }).type === 'moveSubmodule'
    )).toBeUndefined()
  })

  it('y / Y on the submodules view yank path / sha (#932)', () => {
    const state = createLogInkState(rows, { activeView: 'submodules' })

    const yEvents = getLogInkInputEvents(state, 'y', {}, { submoduleCount: 2 })
    expect(yEvents).toContainEqual({ type: 'yankFromActiveView', short: false })

    const yShiftEvents = getLogInkInputEvents(state, 'Y', {}, { submoduleCount: 2 })
    expect(yShiftEvents).toContainEqual({ type: 'yankFromActiveView', short: true })
  })

  it('i / u / s on the submodules view run init / update / sync (#0.71)', () => {
    const state = createLogInkState(rows, { activeView: 'submodules' })

    expect(getLogInkInputEvents(state, 'i', {}, { submoduleCount: 2 }))
      .toContainEqual({ type: 'runWorkflowAction', id: 'submodule-init' })
    expect(getLogInkInputEvents(state, 'u', {}, { submoduleCount: 2 }))
      .toContainEqual({ type: 'runWorkflowAction', id: 'submodule-update' })
    expect(getLogInkInputEvents(state, 's', {}, { submoduleCount: 2 }))
      .toContainEqual({ type: 'runWorkflowAction', id: 'submodule-sync' })
  })

  it('submodule init / update / sync keys require a non-empty submodule list (#0.71)', () => {
    const state = createLogInkState(rows, { activeView: 'submodules' })

    for (const key of ['i', 'u', 's']) {
      const events = getLogInkInputEvents(state, key, {}, { submoduleCount: 0 })
      expect(events.find((e) =>
        e.type === 'runWorkflowAction' && e.id.startsWith('submodule-')
      )).toBeUndefined()
    }
  })

  it('lower-case g on the bisect view marks good (no chord trigger) (#784)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'bisect' })

    const events = getLogInkInputEvents(state, 'g', {}, {})

    expect(events).toContainEqual({ type: 'runWorkflowAction', id: 'bisect-good' })
    // pendingKey must NOT be set — bisect's g consumed the keystroke.
    const pendingChange = events.find((event) =>
      event.type === 'action' && event.action.type === 'setPendingKey'
    )
    expect(pendingChange).toBeUndefined()
  })

  it('b on the bisect view marks bad (does not require g chord) (#784)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'bisect' })

    const events = getLogInkInputEvents(state, 'b', {}, {})

    expect(events).toContainEqual({ type: 'runWorkflowAction', id: 'bisect-bad' })
  })

  it('s on the bisect view skips the candidate when bisect is active (#784)', () => {
    // With `bisectActive` true, `s` keeps the original #784 behavior
    // (skip current candidate). The context flag arrives from the
    // runtime — without it the dispatcher treats `s` as "start the
    // wizard" per #879 item 4.
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'bisect' })

    const events = getLogInkInputEvents(state, 's', {}, { bisectActive: true })

    expect(events).toContainEqual({ type: 'runWorkflowAction', id: 'bisect-skip' })
  })

  it('s on the bisect empty state enters the in-TUI start wizard (#879 item 4)', () => {
    // No bisect active → `s` pushes history, sets pick-bad mode, and
    // surfaces a sticky status banner. The next Enter on history is
    // intercepted to capture the bad sha (see Enter test below).
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'bisect' })

    const events = getLogInkInputEvents(state, 's', {}, { bisectActive: false })

    expect(events).toContainEqual({
      type: 'action',
      action: { type: 'setBisectPickMode', mode: 'bad' },
    })
    expect(events).toContainEqual({
      type: 'action',
      action: { type: 'pushView', value: 'history' },
    })
  })

  it('Enter on history during bisectPickMode=bad captures the sha and advances (#879 item 4)', () => {
    let state = createLogInkState(rows, { activeView: 'history' })
    state = applyLogInkAction(state, { type: 'setBisectPickMode', mode: 'bad' })

    const events = getLogInkInputEvents(state, '', { return: true })

    const advance = events.find((event) =>
      event.type === 'action' &&
      event.action.type === 'setBisectPickMode' &&
      event.action.mode === 'good'
    )
    expect(advance).toBeDefined()
    if (advance && advance.type === 'action' && advance.action.type === 'setBisectPickMode') {
      expect(advance.action.pendingBad).toBeDefined()
    }
  })

  it('Enter on history during bisectPickMode=good fires bisect-start-from-history (#879 item 4)', () => {
    let state = createLogInkState(rows, { activeView: 'history' })
    state = applyLogInkAction(state, { type: 'setBisectPickMode', mode: 'good', pendingBad: 'badsha123' })

    const events = getLogInkInputEvents(state, '', { return: true })

    const workflow = events.find((event) => event.type === 'runWorkflowAction')
    expect(workflow).toBeDefined()
    if (workflow && workflow.type === 'runWorkflowAction') {
      expect(workflow.id).toBe('bisect-start-from-history')
      expect(workflow.payload).toMatch(/^badsha123\n/)
    }
  })

  it('Esc during bisectPickMode clears the wizard (#879 item 4)', () => {
    let state = createLogInkState(rows, { activeView: 'history' })
    state = applyLogInkAction(state, { type: 'pushView', value: 'history' })
    state = applyLogInkAction(state, { type: 'setBisectPickMode', mode: 'good', pendingBad: 'badsha123' })

    const events = getLogInkInputEvents(state, '', { escape: true })

    expect(events).toContainEqual({
      type: 'action',
      action: { type: 'clearBisectPickMode' },
    })
  })

  it('R on an active bisect view opens the bisect-run-command prompt (#879 item 5)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'bisect' })

    const events = getLogInkInputEvents(state, 'R', {}, { bisectActive: true })

    const open = events.find(
      (event) =>
        event.type === 'action' &&
        event.action.type === 'openInputPrompt' &&
        event.action.kind === 'bisect-run-command'
    )
    expect(open).toBeDefined()
  })

  it('R on the empty bisect view (no active session) does nothing (#879 item 5)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'bisect' })

    const events = getLogInkInputEvents(state, 'R', {}, { bisectActive: false })

    expect(events.find((event) =>
      event.type === 'action' &&
      event.action.type === 'openInputPrompt' &&
      event.action.kind === 'bisect-run-command'
    )).toBeUndefined()
  })

  it('x on the bisect view opens the y-confirm for reset (#784)', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'bisect' })

    const events = getLogInkInputEvents(state, 'x', {}, {})

    const confirm = events.find((event) =>
      event.type === 'action' && event.action.type === 'setPendingConfirmation'
    )
    expect(confirm).toBeDefined()
    if (confirm && confirm.type === 'action' && confirm.action.type === 'setPendingConfirmation') {
      expect(confirm.action.value).toBe('bisect-reset')
    }
  })

  it('does not hijack g/b/s/x outside the bisect view (#784)', () => {
    // Defensive check: pressing `g` on the history view must still set
    // pendingKey for the chord prefix, not fire bisect-good.
    const state = createLogInkState(rows)
    expect(state.activeView).toBe('history')

    const events = getLogInkInputEvents(state, 'g', {}, {})

    expect(events).not.toContainEqual({ type: 'runWorkflowAction', id: 'bisect-good' })
    const pendingChange = events.find((event) =>
      event.type === 'action' && event.action.type === 'setPendingKey'
    )
    expect(pendingChange).toBeDefined()
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

  describe('Esc / < auto-pop for nested repo frames (#931)', () => {
    function pushSubmoduleFrame(s: LogInkState): LogInkState {
      return applyLogInkAction(s, {
        type: 'pushRepoFrame',
        label: 'vendor/lib',
        workdir: '/abs/coco/vendor/lib',
      })
    }

    it('Esc at the root view of a nested frame pops the frame', () => {
      let state = createLogInkState(rows, { repoLabel: 'coco' })
      state = pushSubmoduleFrame(state)
      expect(state.repoStack).toHaveLength(2)
      expect(state.viewStack).toEqual(['history'])

      state = applyInput(state, '', { escape: true })

      expect(state.repoStack).toHaveLength(1)
      expect(state.repoStack[0].label).toBe('coco')
    })

    it('Esc inside a nested frame drains the view stack before popping the frame', () => {
      let state = createLogInkState(rows, { repoLabel: 'coco' })
      state = pushSubmoduleFrame(state)
      state = applyLogInkAction(state, { type: 'pushView', value: 'diff' })
      expect(state.viewStack).toEqual(['history', 'diff'])
      expect(state.repoStack).toHaveLength(2)

      // First Esc: pops the diff view inside the nested frame.
      state = applyInput(state, '', { escape: true })
      expect(state.viewStack).toEqual(['history'])
      expect(state.repoStack).toHaveLength(2)

      // Second Esc: now at the root view of the frame, pops the frame.
      state = applyInput(state, '', { escape: true })
      expect(state.viewStack).toEqual(['history'])
      expect(state.repoStack).toHaveLength(1)
    })

    it('Esc at the root of the root frame is a no-op (no popRepoFrame underflow)', () => {
      const state = createLogInkState(rows, { repoLabel: 'coco' })
      const events = getLogInkInputEvents(state, '', { escape: true })
      // Either no events or events that don't include popRepoFrame /
      // popView. The two-stage filter-mode escape is also gated by
      // filterMode being true; here we never entered filter mode.
      const types = events
        .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
        .map((event) => event.action.type)
      expect(types).not.toContain('popRepoFrame')
      expect(types).not.toContain('popView')
    })

    it('Esc through a 3-deep nest unwinds one frame at a time', () => {
      let state = createLogInkState(rows, { repoLabel: 'coco' })
      state = pushSubmoduleFrame(state)
      state = applyLogInkAction(state, {
        type: 'pushRepoFrame',
        label: 'vendor/lib/inner',
      })
      expect(state.repoStack.map((f) => f.label)).toEqual([
        'coco',
        'vendor/lib',
        'vendor/lib/inner',
      ])

      state = applyInput(state, '', { escape: true })
      expect(state.repoStack.map((f) => f.label)).toEqual(['coco', 'vendor/lib'])

      state = applyInput(state, '', { escape: true })
      expect(state.repoStack.map((f) => f.label)).toEqual(['coco'])

      state = applyInput(state, '', { escape: true })
      expect(state.repoStack.map((f) => f.label)).toEqual(['coco'])
    })

    it('`<` keystroke pops the frame at the root of a nested frame', () => {
      let state = createLogInkState(rows, { repoLabel: 'coco' })
      state = pushSubmoduleFrame(state)
      state = applyInput(state, '<')
      expect(state.repoStack).toHaveLength(1)
    })

    it('`<` drains the view stack before popping the frame', () => {
      let state = createLogInkState(rows, { repoLabel: 'coco' })
      state = pushSubmoduleFrame(state)
      state = applyLogInkAction(state, { type: 'pushView', value: 'diff' })

      state = applyInput(state, '<')
      expect(state.viewStack).toEqual(['history'])
      expect(state.repoStack).toHaveLength(2)

      state = applyInput(state, '<')
      expect(state.repoStack).toHaveLength(1)
    })

    it('palette navigateBack mirrors the same logic', () => {
      let state = createLogInkState(rows, { repoLabel: 'coco' })
      state = pushSubmoduleFrame(state)
      const navigateBackCommand = getLogInkPaletteCommands().find((c) => c.id === 'navigateBack')
      if (!navigateBackCommand) throw new Error('navigateBack palette command missing')
      const events = getLogInkPaletteExecuteEvents(navigateBackCommand, state)
      const types = events
        .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
        .map((event) => event.action.type)
      expect(types).toContain('popRepoFrame')
      expect(types).not.toContain('popView')
    })

    it('filter-mode escape wins over auto-pop while filterMode is active', () => {
      let state = createLogInkState(rows, { repoLabel: 'coco' })
      state = pushSubmoduleFrame(state)
      // Enter filter mode and type a couple chars inside the nested frame.
      state = applyInput(state, '/')
      state = applyInput(state, 'f')
      expect(state.filterMode).toBe(true)
      expect(state.filter).toBe('f')
      expect(state.repoStack).toHaveLength(2)

      // First Esc: clears the filter text but stays in filter mode.
      state = applyInput(state, '', { escape: true })
      expect(state.filter).toBe('')
      expect(state.filterMode).toBe(true)
      expect(state.repoStack).toHaveLength(2)

      // Second Esc: exits filter mode. Should NOT pop the frame.
      state = applyInput(state, '', { escape: true })
      expect(state.filterMode).toBe(false)
      expect(state.repoStack).toHaveLength(2)

      // Third Esc: now at root view of nested frame with no filter
      // mode, the frame pops.
      state = applyInput(state, '', { escape: true })
      expect(state.repoStack).toHaveLength(1)
    })

    it('help overlay escape wins over auto-pop while help is open', () => {
      let state = createLogInkState(rows, { repoLabel: 'coco' })
      state = pushSubmoduleFrame(state)
      state = applyLogInkAction(state, { type: 'toggleHelp' })
      expect(state.showHelp).toBe(true)
      expect(state.repoStack).toHaveLength(2)

      // Esc closes the help overlay — does NOT pop the frame.
      state = applyInput(state, '', { escape: true })
      expect(state.showHelp).toBe(false)
      expect(state.repoStack).toHaveLength(2)
    })

    describe('submodules-view drill-in (PR 4 / #932)', () => {
      function submodulesViewState() {
        return createLogInkState(rows, {
          activeView: 'submodules',
          repoLabel: 'coco',
          repoWorkdir: '/abs/coco',
        })
      }

      it('Enter on a submodule row dispatches pushRepoFrame with label + workdir', () => {
        const state = submodulesViewState()
        const events = getLogInkInputEvents(state, '', { return: true }, {
          submoduleCount: 1,
          submoduleSelectedPath: 'vendor/lib',
          submoduleViewDrillIn: {
            label: 'vendor/lib',
            workdir: '/abs/coco/vendor/lib',
          },
        })
        const actionEvents = events
          .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
          .map((event) => event.action)
        const push = actionEvents.find((a) => a.type === 'pushRepoFrame')
        expect(push).toEqual({
          type: 'pushRepoFrame',
          label: 'vendor/lib',
          workdir: '/abs/coco/vendor/lib',
        })
        // No entryRange — the submodules view doesn't carry diff context.
        expect((push as { entryRange?: unknown })?.entryRange).toBeUndefined()
        const status = actionEvents.find((a) => a.type === 'setStatus')
        expect(status).toEqual({ type: 'setStatus', value: 'entering submodule vendor/lib' })
      })

      it('Enter without a drill-in target on the submodules view does NOT push a frame', () => {
        const state = submodulesViewState()
        const events = getLogInkInputEvents(state, '', { return: true }, {
          submoduleCount: 1,
          submoduleSelectedPath: 'vendor/lib',
          // No submoduleViewDrillIn (e.g., repo root not loaded yet).
        })
        const types = events
          .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
          .map((event) => event.action.type)
        expect(types).not.toContain('pushRepoFrame')
      })

      it('Enter on the submodules view when focus is on the sidebar does NOT drill in', () => {
        // isSubmodulesActionTarget gates on focus === 'commits'; if the
        // user is still in the sidebar, the drill-in handler shouldn't
        // claim the keystroke — the sidebar's Enter handler does.
        let state = submodulesViewState()
        state = applyLogInkAction(state, { type: 'setFocus', value: 'sidebar' })
        const events = getLogInkInputEvents(state, '', { return: true }, {
          submoduleCount: 1,
          submoduleViewDrillIn: {
            label: 'vendor/lib',
            workdir: '/abs/coco/vendor/lib',
          },
        })
        const types = events
          .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
          .map((event) => event.action.type)
        expect(types).not.toContain('pushRepoFrame')
      })

      it('Enter dispatch + reducer apply lands on history with parent return snapshot', () => {
        let state = submodulesViewState()
        const events = getLogInkInputEvents(state, '', { return: true }, {
          submoduleCount: 2,
          submoduleViewDrillIn: {
            label: 'vendor/lib',
            workdir: '/abs/coco/vendor/lib',
          },
        })
        state = events
          .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
          .reduce((curr, event) => applyLogInkAction(curr, event.action), state)

        expect(state.repoStack).toHaveLength(2)
        expect(state.repoStack[1].label).toBe('vendor/lib')
        expect(state.repoStack[1].workdir).toBe('/abs/coco/vendor/lib')
        expect(state.repoStack[1].entryRange).toBeUndefined()
        expect(state.activeView).toBe('history')
        // parentReturn captures activeView=submodules so Esc walks back.
        expect(state.repoStack[1].parentReturn?.activeView).toBe('submodules')
      })

      it('Enter on history view does NOT trigger submodule drill-in even if context payload is set', () => {
        // Defensive: if a stale drill-in payload arrives while the user
        // is on history, the activeView gate keeps the handler from
        // firing — the history-Enter (open-diff) handler claims it.
        const state = createLogInkState(rows, { activeView: 'history', repoLabel: 'coco' })
        const events = getLogInkInputEvents(state, '', { return: true }, {
          submoduleCount: 1,
          submoduleViewDrillIn: {
            label: 'vendor/lib',
            workdir: '/abs/coco/vendor/lib',
          },
        })
        const types = events
          .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
          .map((event) => event.action.type)
        expect(types).not.toContain('pushRepoFrame')
      })
    })

    describe('commit-diff drill-in (PR 3b)', () => {
      function commitDiffState() {
        const state = createLogInkState(rows, { activeView: 'diff', repoLabel: 'coco', repoWorkdir: '/abs/coco' })
        return {
          ...state,
          diffSource: 'commit' as const,
        } as LogInkState
      }

      it('Enter on a submodule file dispatches pushRepoFrame with the drill-in payload', () => {
        const state = commitDiffState()
        const events = getLogInkInputEvents(state, '', { return: true }, {
          commitDiffSubmoduleDrillIn: {
            label: 'vendor/lib',
            workdir: '/abs/coco/vendor/lib',
            entryRange: {
              oldSha: '11111111',
              newSha: '22222222',
            },
          },
        })
        const actionEvents = events
          .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
          .map((event) => event.action)
        const push = actionEvents.find((a) => a.type === 'pushRepoFrame')
        expect(push).toEqual({
          type: 'pushRepoFrame',
          label: 'vendor/lib',
          workdir: '/abs/coco/vendor/lib',
          entryRange: {
            oldSha: '11111111',
            newSha: '22222222',
          },
        })
        // Status hint accompanies the push so the user gets feedback.
        const status = actionEvents.find((a) => a.type === 'setStatus')
        expect(status).toEqual({ type: 'setStatus', value: 'entering submodule vendor/lib' })
      })

      it('Enter without a drill-in target on the diff view does NOT push a frame', () => {
        const state = commitDiffState()
        const events = getLogInkInputEvents(state, '', { return: true }, {})
        const types = events
          .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
          .map((event) => event.action.type)
        expect(types).not.toContain('pushRepoFrame')
      })

      it('Enter on a worktree-source diff is not a drill-in target even if drill-in payload is set', () => {
        // Worktree diffs come from `coco ui` against the live tree, not
        // a historical commit. The drill-in target is gated on
        // `diffSource === 'commit'` so a stray drill-in payload from a
        // race doesn't accidentally fire from the worktree diff view.
        const baseState = createLogInkState(rows, { activeView: 'diff' })
        const state = { ...baseState, diffSource: 'worktree' as const } as LogInkState
        const events = getLogInkInputEvents(state, '', { return: true }, {
          commitDiffSubmoduleDrillIn: {
            label: 'vendor/lib',
            workdir: '/abs/coco/vendor/lib',
          },
        })
        const types = events
          .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
          .map((event) => event.action.type)
        expect(types).not.toContain('pushRepoFrame')
      })

      it('Enter dispatch + reducer apply lands on history of the new frame with the cached parent return', () => {
        let state = commitDiffState()
        state = applyLogInkAction(state, { type: 'move', delta: 1 })
        const parentSelected = state.selectedIndex

        const events = getLogInkInputEvents(state, '', { return: true }, {
          commitDiffSubmoduleDrillIn: {
            label: 'vendor/lib',
            workdir: '/abs/coco/vendor/lib',
          },
        })
        state = events
          .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
          .reduce((curr, event) => applyLogInkAction(curr, event.action), state)

        expect(state.repoStack).toHaveLength(2)
        expect(state.repoStack[1].label).toBe('vendor/lib')
        expect(state.repoStack[1].workdir).toBe('/abs/coco/vendor/lib')
        // The new frame lands on history with a clean cursor.
        expect(state.activeView).toBe('history')
        expect(state.viewStack).toEqual(['history'])
        expect(state.selectedIndex).toBe(0)
        // Parent's view position is captured in parentReturn so Esc /
        // < / popRepoFrame restores it.
        expect(state.repoStack[1].parentReturn).toEqual(expect.objectContaining({
          activeView: 'diff',
          selectedIndex: parentSelected,
        }))
      })

      it('Enter drill-in works without an entryRange (e.g. added submodule)', () => {
        const state = commitDiffState()
        const events = getLogInkInputEvents(state, '', { return: true }, {
          commitDiffSubmoduleDrillIn: {
            label: 'vendor/lib',
            workdir: '/abs/coco/vendor/lib',
            // No entryRange (added / removed case).
          },
        })
        const push = events
          .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
          .map((event) => event.action)
          .find((a) => a.type === 'pushRepoFrame')
        expect(push).toEqual({
          type: 'pushRepoFrame',
          label: 'vendor/lib',
          workdir: '/abs/coco/vendor/lib',
          entryRange: undefined,
        })
      })
    })

    it('popping the frame restores the parent view position', () => {
      let state = createLogInkState(rows, { repoLabel: 'coco' })
      // Move the parent off defaults so we can verify the pop restored.
      state = applyLogInkAction(state, { type: 'setActiveView', value: 'branches' })
      state = applyLogInkAction(state, { type: 'move', delta: 1 })
      const parentSelected = state.selectedIndex

      state = pushSubmoduleFrame(state)
      // Inside the nested frame we land on history with cursor 0.
      expect(state.activeView).toBe('history')
      expect(state.selectedIndex).toBe(0)

      state = applyInput(state, '', { escape: true })

      expect(state.repoStack).toHaveLength(1)
      expect(state.activeView).toBe('branches')
      expect(state.selectedIndex).toBe(parentSelected)
    })
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

  describe('worktree-diff keys are inert on commit/stash/compare diffs (dirty-worktree hijack)', () => {
    // Regression: with a dirty worktree the hydrated worktree hunk/diff
    // data used to win the dispatch on ANY diff view — Space silently
    // staged (and z offered to discard) a hunk of the status-cursored
    // file while the user was reading a read-only commit diff, and j/k
    // scrolled the invisible worktree offset so the visible diff looked
    // frozen.
    const dirtyWorktreeContext = {
      worktreeHunkOffsets: [0, 12],
      worktreeDiffLineCount: 40,
      worktreeFileCount: 2,
    }

    function diffState(source: 'commit' | 'worktree' | undefined): LogInkState {
      const base = createLogInkState(rows, { activeView: 'diff' })
      return { ...base, diffSource: source } as LogInkState
    }

    it('Space stages the cursored hunk only on the staging diff', () => {
      expect(
        getLogInkInputEvents(diffState('worktree'), ' ', {}, dirtyWorktreeContext)
      ).toEqual([{ type: 'toggleSelectedHunkStage' }])
      // `g d` pushes the diff view without a source tag — still staging.
      expect(
        getLogInkInputEvents(diffState(undefined), ' ', {}, dirtyWorktreeContext)
      ).toEqual([{ type: 'toggleSelectedHunkStage' }])

      const onCommitDiff = getLogInkInputEvents(diffState('commit'), ' ', {}, dirtyWorktreeContext)
      expect(onCommitDiff).not.toContainEqual({ type: 'toggleSelectedHunkStage' })
      expect(onCommitDiff).not.toContainEqual({ type: 'toggleSelectedFileStage' })
    })

    it('z opens the revert-hunk confirmation only on the staging diff', () => {
      const staging = applyInput(diffState('worktree'), 'z', {}, dirtyWorktreeContext)
      expect(staging.pendingMutationConfirmation).toBe('revert-hunk')

      const commit = applyInput(diffState('commit'), 'z', {}, dirtyWorktreeContext)
      expect(commit.pendingMutationConfirmation).toBeUndefined()
    })

    it('j/k on a commit diff scroll the visible preview, not the hidden worktree diff', () => {
      const events = getLogInkInputEvents(diffState('commit'), 'j', {}, {
        ...dirtyWorktreeContext,
        previewLineCount: 80,
      })
      const actions = events
        .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
        .map((event) => event.action.type)
      expect(actions).toContain('pageDetailPreview')
      expect(actions).not.toContain('pageWorktreeDiff')
    })
  })

  describe('line-level staging keys (#1358)', () => {
    const dirtyDiffContext = {
      worktreeHunkOffsets: [4],
      worktreeDiffLineCount: 12,
    }

    function worktreeDiffState(overrides: Partial<LogInkState> = {}): LogInkState {
      const base = createLogInkState(rows, { activeView: 'diff' })
      return { ...base, diffSource: 'worktree' as const, worktreeDiffOffset: 6, ...overrides } as LogInkState
    }

    it('v anchors a selection at the current line; v again clears it', () => {
      let state = applyInput(worktreeDiffState(), 'v', {}, dirtyDiffContext)
      expect(state.diffLineSelectAnchor).toBe(6)

      state = applyInput(state, 'v', {}, dirtyDiffContext)
      expect(state.diffLineSelectAnchor).toBeUndefined()
    })

    it('Esc clears the selection without popping the view', () => {
      let state = applyInput(worktreeDiffState(), 'v', {}, dirtyDiffContext)
      state = applyInput(state, '', { escape: true }, dirtyDiffContext)
      expect(state.diffLineSelectAnchor).toBeUndefined()
      expect(state.activeView).toBe('diff')
    })

    it('Space with a selection stages the selected lines, not the hunk', () => {
      const state = worktreeDiffState({ diffLineSelectAnchor: 5 })
      const events = getLogInkInputEvents(state, ' ', {}, dirtyDiffContext)
      expect(events).toEqual([{ type: 'stageSelectedLines' }])
    })

    it('z with a selection asks to discard the selected lines', () => {
      let state = worktreeDiffState({ diffLineSelectAnchor: 5 })
      state = applyInput(state, 'z', {}, dirtyDiffContext)
      expect(state.pendingMutationConfirmation).toBe('discard-lines')

      const events = getLogInkInputEvents(state, 'y', {}, dirtyDiffContext)
      expect(events).toContainEqual({ type: 'revertSelectedLines' })
    })

    it('without a selection Space/z keep the whole-hunk semantics', () => {
      expect(getLogInkInputEvents(worktreeDiffState(), ' ', {}, dirtyDiffContext))
        .toEqual([{ type: 'toggleSelectedHunkStage' }])
      const state = applyInput(worktreeDiffState(), 'z', {}, dirtyDiffContext)
      expect(state.pendingMutationConfirmation).toBe('revert-hunk')
    })
  })

  describe('rebase plan surface keys (#1359)', () => {
    function rebaseState() {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, {
        type: 'openRebasePlan',
        rows: [
          { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'feat: one', author: 'Coco', date: '2026-05-01', action: 'pick' as const },
          { sha: 'b'.repeat(40), shortSha: 'bbbbbbb', subject: 'fix: two', author: 'Coco', date: '2026-05-02', action: 'pick' as const },
        ],
      })
      return state
    }

    it('s retags the cursored row to squash (not branch/tag sort)', () => {
      const state = applyInput(rebaseState(), 's')
      expect(state.rebasePlan?.rows[0].action).toBe('squash')
    })

    it('J reorders the cursored row downward', () => {
      const state = applyInput(rebaseState(), 'J')
      expect(state.rebasePlan?.rows.map((r) => r.shortSha)).toEqual(['bbbbbbb', 'aaaaaaa'])
    })

    it('r opens the reword prompt seeded with the subject; submit stages the reword', () => {
      let state = applyInput(rebaseState(), 'r')
      expect(state.inputPrompt).toMatchObject({ kind: 'rebase-reword', value: 'feat: one' })

      // Append and submit — Enter routes through the prompt handler.
      state = applyInput(state, '!', {})
      state = applyInput(state, '', { return: true })
      expect(state.inputPrompt).toBeUndefined()
      expect(state.rebasePlan?.rows[0]).toMatchObject({ action: 'reword', newMessage: 'feat: one!' })
    })

    it('Enter asks for confirmation of execute-rebase-plan', () => {
      const events = getLogInkInputEvents(rebaseState(), '', { return: true })
      expect(events).toEqual([
        { type: 'action', action: { type: 'setPendingConfirmation', value: 'execute-rebase-plan' } },
      ])
    })

    it('j/k move the plan cursor', () => {
      let state = applyInput(rebaseState(), 'j')
      expect(state.rebasePlan?.selectedIndex).toBe(1)
      state = applyInput(state, 'k')
      expect(state.rebasePlan?.selectedIndex).toBe(0)
    })
  })

  describe('pendingAiDraft accept keys vs inline editing', () => {
    function composeWithPendingDraft(): ReturnType<typeof createLogInkState> {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'compose' })
      state = applyLogInkAction(state, {
        type: 'commitCompose',
        action: { type: 'append', value: 'feat: typed by hand' },
      })
      // Non-empty summary routes the draft into pendingAiDraft.
      state = applyLogInkAction(state, {
        type: 'commitCompose',
        action: { type: 'setDraft', value: 'feat: AI draft\n\nAI body' },
      })
      expect(state.commitCompose.pendingAiDraft).toBeDefined()
      return state
    }

    it('R accepts the pending draft when not editing', () => {
      const state = composeWithPendingDraft()
      expect(getLogInkInputEvents(state, 'R')).toEqual([
        {
          type: 'action',
          action: { type: 'commitCompose', action: { type: 'acceptPendingAiDraft' } },
        },
      ])
    })

    // Regression: the accept branch used to run before the editing
    // intercept, so typing a capital R (or pressing Enter to advance
    // fields) mid-edit silently replaced the user's summary+body with
    // the AI draft — the exact loss pendingAiDraft exists to prevent.
    it('R while editing appends to the buffer instead of accepting the draft', () => {
      let state = composeWithPendingDraft()
      state = applyLogInkAction(state, {
        type: 'commitCompose',
        action: { type: 'setEditing', value: true },
      })

      state = applyInput(state, 'R')
      expect(state.commitCompose.pendingAiDraft).toBeDefined()
      expect(state.commitCompose.summary).toBe('feat: typed by handR')
    })

    it('Enter while editing advances the field instead of accepting the draft', () => {
      let state = composeWithPendingDraft()
      state = applyLogInkAction(state, {
        type: 'commitCompose',
        action: { type: 'setEditing', value: true },
      })

      state = applyInput(state, '', { return: true })
      expect(state.commitCompose.pendingAiDraft).toBeDefined()
      expect(state.commitCompose.field).toBe('body')
      expect(state.commitCompose.summary).toBe('feat: typed by hand')
    })
  })

  it('E from compose opens the draft in the external editor', () => {
    // Capital `E` (companion to lowercase `e` which activates inline
    // editing). The runtime callback handles the temp-file write + spawn
    // + read-back; the input handler emits a single openComposeInEditor
    // event the dispatcher routes there.
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'compose' })

    expect(getLogInkInputEvents(state, 'E')).toEqual([
      { type: 'openComposeInEditor' },
    ])
  })

  it('E from status or diff pushes compose first, then opens the external editor', () => {
    // Mirrors the lowercase `e` flow — from worktree views, the
    // keystroke auto-jumps into compose before invoking the editor.
    const statusState = createLogInkState(rows, { activeView: 'status' })
    expect(getLogInkInputEvents(statusState, 'E', {}, { worktreeFileCount: 1 })).toEqual([
      { type: 'action', action: { type: 'pushView', value: 'compose' } },
      { type: 'openComposeInEditor' },
    ])

    const diffState = createLogInkState(rows, { activeView: 'diff' })
    expect(getLogInkInputEvents(diffState, 'E', {}, { worktreeFileCount: 1 })).toEqual([
      { type: 'action', action: { type: 'pushView', value: 'compose' } },
      { type: 'openComposeInEditor' },
    ])
  })

  it('E does not fire outside the status / diff / compose triad', () => {
    // History, branches, tags, etc. should fall through to whatever
    // other E-binding exists for that view (or no-op) — the editor
    // keystroke is scoped to commit-message work.
    const historyState = createLogInkState(rows, { activeView: 'history' })
    const events = getLogInkInputEvents(historyState, 'E')
    expect(events.some((event) => event.type === 'openComposeInEditor')).toBe(false)
  })

  it('S from compose starts the split flow', () => {
    // Capital `S` — split staged changes into multiple commits. From
    // compose, single dispatch (no view push needed since we're
    // already in compose). Runtime callback handles pre-flight + plan
    // generation; from the input handler's perspective it's one event.
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'compose' })

    expect(getLogInkInputEvents(state, 'S')).toEqual([
      { type: 'startCommitSplit' },
    ])
  })

  it('S from status or diff pushes compose first, then starts the split flow', () => {
    // Mirrors `E` and lowercase `c` — from worktree views, the
    // keystroke auto-jumps into compose before invoking the split.
    const statusState = createLogInkState(rows, { activeView: 'status' })
    expect(getLogInkInputEvents(statusState, 'S', {}, { worktreeFileCount: 1 })).toEqual([
      { type: 'action', action: { type: 'pushView', value: 'compose' } },
      { type: 'startCommitSplit' },
    ])

    const diffState = createLogInkState(rows, { activeView: 'diff' })
    expect(getLogInkInputEvents(diffState, 'S', {}, { worktreeFileCount: 1 })).toEqual([
      { type: 'action', action: { type: 'pushView', value: 'compose' } },
      { type: 'startCommitSplit' },
    ])
  })

  it('S does not fire outside the status / diff / compose triad', () => {
    const historyState = createLogInkState(rows, { activeView: 'history' })
    const events = getLogInkInputEvents(historyState, 'S')
    expect(events.some((event) => event.type === 'startCommitSplit')).toBe(false)
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
    // Note: since 0.54.x the default `fullGraph` flipped to true so
    // users see the full multi-ref graph out of the box. The toggle
    // semantics didn't change — `\\` still flips between full and
    // compact — the starting state is just the inverse of what
    // earlier tests assumed.
    let state = createLogInkState(rows)
    expect(state.fullGraph).toBe(true)

    // Single g press only sets a pending chord — no graph flicker.
    state = applyInput(state, 'g')
    expect(state.fullGraph).toBe(true)
    expect(state.pendingKey).toBe('g')

    // An unmatched continuation CANCELS the chord without acting
    // (which-key semantics) — it used to leak through and toggle the
    // graph while leaving the prefix armed.
    state = applyInput(state, '\\')
    expect(state.fullGraph).toBe(true)
    expect(state.pendingKey).toBeUndefined()

    // With the chord cleared, \\ flips from default (full) to compact.
    state = applyInput(state, '\\')
    expect(state.fullGraph).toBe(false)

    // Pressing it again flips back to full.
    state = applyInput(state, '\\')
    expect(state.fullGraph).toBe(true)
  })

  it('Esc cancels a pending g chord instead of leaving it armed', () => {
    let state = createLogInkState(rows)
    state = applyInput(state, 'g')
    expect(state.pendingKey).toBe('g')

    state = applyInput(state, '', { escape: true })
    expect(state.pendingKey).toBeUndefined()

    // The next `c` is plain cherry-pick (confirm), NOT the `gc` chord.
    const events = getLogInkInputEvents(state, 'c')
    const types = events
      .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
      .map((event) => event.action.type)
    expect(types).not.toContain('pushView')
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

  describe('Esc cancels in-flight AI commit draft (#881 phase 3)', () => {
    it('dispatches cancelAiCommitDraft when Esc is pressed during compose loading', () => {
      // Set up the scenario: user is on the compose surface with an AI
      // draft generating (loading === true). Pressing Esc should
      // dispatch the runtime-side cancel event rather than falling
      // through to "exit editing" or "leave compose."
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'compose' })
      state = applyLogInkAction(state, {
        type: 'commitCompose',
        action: { type: 'setLoading', value: true },
      })

      expect(state.activeView).toBe('compose')
      expect(state.commitCompose.loading).toBe(true)

      const events = getLogInkInputEvents(state, '', { escape: true })
      expect(events).toEqual([{ type: 'cancelAiCommitDraft' }])
    })

    it('does not fire cancelAiCommitDraft when loading is false (normal Esc behaviour preserved)', () => {
      // Sanity: the cancel binding is gated on loading. When the user
      // is just sitting on the compose surface (no draft in flight),
      // Esc must keep its existing semantics (leave the view).
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'compose' })

      const events = getLogInkInputEvents(state, '', { escape: true })
      expect(events).not.toContainEqual({ type: 'cancelAiCommitDraft' })
    })

    it('fires cancelAiCommitDraft from any view while loading is true (audit finding #5)', () => {
      // The original Phase 3 implementation gated cancel on
      // `activeView === 'compose'`, which made the keystroke
      // unreachable after chord-navigation away from compose
      // mid-stream. The audit caught this: user starts AI draft on
      // compose, presses `g h` to glance at history while waiting,
      // realizes they want to bail — Esc should still cancel even
      // though they're not on compose anymore. The fix drops the
      // activeView gate; this test pins the new behaviour.
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, {
        type: 'commitCompose',
        action: { type: 'setLoading', value: true },
      })
      // Stay on history view (not compose).
      expect(state.activeView).toBe('history')

      const events = getLogInkInputEvents(state, '', { escape: true })
      expect(events).toEqual([{ type: 'cancelAiCommitDraft' }])
    })
  })

  describe('Esc cancels in-flight PR body draft (#881 phase 4)', () => {
    it('dispatches cancelPullRequestBodyDraft when Esc is pressed during the draft', () => {
      // While `pendingPullRequestBodyDraft` is true, Esc routes to the
      // soft-cancel handler so the user can bail before the prompt
      // opens. Unlike the compose-loading cancel binding above, this
      // is NOT gated on `activeView` — the C keystroke can be fired
      // from anywhere via the palette, so cancel has to work from
      // anywhere too.
      const state = applyLogInkAction(createLogInkState(rows), {
        type: 'setPendingPullRequestBodyDraft',
        value: true,
      })
      expect(state.pendingPullRequestBodyDraft).toBe(true)

      const events = getLogInkInputEvents(state, '', { escape: true })
      expect(events).toEqual([{ type: 'cancelPullRequestBodyDraft' }])
    })

    it('does not fire when no PR body draft is pending (normal Esc preserved)', () => {
      // Sanity: the cancel binding only fires when the flag is set.
      // With no draft pending, Esc falls through to the global handler
      // (which pops view stack, etc. — not asserted here, just that
      // we don't steal the keystroke).
      const events = getLogInkInputEvents(createLogInkState(rows), '', { escape: true })
      expect(events).not.toContainEqual({ type: 'cancelPullRequestBodyDraft' })
    })

    it('compose cancel takes precedence over PR-body cancel when both could match', () => {
      // Edge case: both `pendingPullRequestBodyDraft` AND
      // `commitCompose.loading` are true simultaneously (unusual but
      // recoverable state). The compose handler sits above PR-body
      // in the input pipeline, so compose cancel wins. Document the
      // precedence here so a future reorder doesn't silently swap it.
      //
      // Note: after audit finding #5, neither binding is gated on
      // `activeView`, so the active view is irrelevant to the
      // precedence — the order of handlers in the input pipeline
      // is the only thing that matters.
      let state = applyLogInkAction(createLogInkState(rows), {
        type: 'setPendingPullRequestBodyDraft',
        value: true,
      })
      state = applyLogInkAction(state, {
        type: 'commitCompose',
        action: { type: 'setLoading', value: true },
      })

      const events = getLogInkInputEvents(state, '', { escape: true })
      expect(events).toEqual([{ type: 'cancelAiCommitDraft' }])
    })
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

    it('emits yankFromActiveView from the bisect completion panel (#879 item 3)', () => {
      // Bisect completion: y / Y yank the first-bad commit sha. The
      // input dispatcher gates on `bisectCompletionSha` so the bisect
      // view falls through to the existing bisect-active handlers
      // (g/b/s/x) when no terminator is present.
      const state = createLogInkState(rows, { activeView: 'bisect' })

      expect(
        getLogInkInputEvents(state, 'y', {}, { bisectCompletionSha: 'abc12345' })
      ).toEqual([{ type: 'yankFromActiveView', short: false }])
      expect(
        getLogInkInputEvents(state, 'Y', {}, { bisectCompletionSha: 'abc12345' })
      ).toEqual([{ type: 'yankFromActiveView', short: true }])
      // No terminator → falls through.
      expect(getLogInkInputEvents(state, 'y', {}, {})).toEqual([])
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

    // OSS-245 / coco #1328 — arrow keys on the status view must respect
    // which panel is focused: sidebar focus → move within the sidebar
    // entity list; center pane focus → move the worktree file list.
    it('↑/↓ on the status view with sidebar branches focused moves the branch cursor, not the file list', () => {
      // selectedBranchIndex > 0 to avoid the "promote to header" edge case
      // (at index 0, ↑ sets sidebarHeaderFocused instead of moving).
      const state = { ...sidebarBranchesState(), activeView: 'status' as const, selectedBranchIndex: 2 }
      const down = getLogInkInputEvents(state, '', { downArrow: true }, { branchCount: 5, worktreeFileCount: 4 })
      expect(down).toEqual([{ type: 'action', action: { type: 'moveBranch', delta: 1, count: 5 } }])

      const up = getLogInkInputEvents(state, '', { upArrow: true }, { branchCount: 5, worktreeFileCount: 4 })
      expect(up).toEqual([{ type: 'action', action: { type: 'moveBranch', delta: -1, count: 5 } }])
    })

    it('↑/↓ on the status view with the center pane focused still moves the worktree file list', () => {
      const state = {
        ...createLogInkState(rows),
        activeView: 'status' as const,
        focus: 'commits' as const,
      }
      const down = getLogInkInputEvents(state, '', { downArrow: true }, { worktreeFileCount: 4 })
      expect(down).toEqual([{ type: 'action', action: { type: 'moveWorktreeFile', delta: 1, fileCount: 4 } }])

      const up = getLogInkInputEvents(state, '', { upArrow: true }, { worktreeFileCount: 4 })
      expect(up).toEqual([{ type: 'action', action: { type: 'moveWorktreeFile', delta: -1, fileCount: 4 } }])
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

    it('i on the history view opens the in-TUI rebase plan (#1359)', () => {
      // Lowercase `i` keeps the existing global `I` ai-commit-summary
      // workflow reachable on the history view; matches `git rebase -i`.
      // The $EDITOR variant stays palette-reachable as interactive-rebase.
      const events = getLogInkInputEvents(createLogInkState(rows), 'i')
      expect(events).toEqual([{ type: 'startRebasePlan' }])
    })

    it('f on the history view sets pending confirmation for fixup-into-commit (#1357)', () => {
      const events = getLogInkInputEvents(createLogInkState(rows), 'f')
      expect(events).toEqual([
        { type: 'action', action: { type: 'setPendingConfirmation', value: 'fixup-into-commit' } },
      ])
    })

    it('f stays inert on the history view when no commits are loaded', () => {
      const state = createLogInkState([])
      const events = getLogInkInputEvents(state, 'f')
      expect(events).toEqual([])
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
        action: { type: 'setStatus', value: 'Unknown reset mode: extreme. Use soft, mixed, or hard.', kind: 'warning' },
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
        action: { type: 'setStatus', value: 'enter a value or press esc to cancel', kind: 'warning' },
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
          action: { type: 'setStatus', value: 'Switched to side-by-side diff', kind: 'success' },
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
        action: { type: 'setStatus', value: 'Switched to unified diff', kind: 'success' },
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
        action: { type: 'setStatus', value: expect.stringContaining('gH applies a hunk'), kind: 'warning' },
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
        { type: 'action', action: { type: 'setStatus', value: 'enter a value or press esc to cancel', kind: 'warning' } },
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

    it('C globally starts the create-pull-request flow (changelog seed + prompt)', () => {
      // From the history view — `C` should start the PR creation
      // workflow. The runtime callback (in app.ts) handles the
      // changelog-fetch + prompt-open side effects; from the input
      // handler's perspective it's a single event the dispatcher
      // routes to `startCreatePullRequest`.
      const historyState = createLogInkState(rows, { activeView: 'history' })
      expect(getLogInkInputEvents(historyState, 'C')).toEqual([
        { type: 'startCreatePullRequest' },
      ])

      // From the branches view too — the natural starting point when
      // looking at the current branch.
      const branchesState = createLogInkState(rows, { activeView: 'branches' })
      expect(getLogInkInputEvents(branchesState, 'C')).toEqual([
        { type: 'startCreatePullRequest' },
      ])

      // From the PR view (when no PR exists yet). The runtime callback
      // takes care of the "already has an open PR" guard; the input
      // handler unconditionally fires.
      const prState = createLogInkState(rows, { activeView: 'pull-request' })
      expect(getLogInkInputEvents(prState, 'C')).toEqual([
        { type: 'startCreatePullRequest' },
      ])
    })

    it('C is scoped away from the conflicts and compose views', () => {
      // Conflicts: `C` means "continue the in-progress operation" when
      // no conflicts remain, otherwise it surfaces a "resolve first"
      // status. Either way it MUST NOT fall through to startCreate.
      const conflictsClear = createLogInkState(rows, { activeView: 'conflicts' })
      const conflictsBlocked = createLogInkState(rows, { activeView: 'conflicts' })
      expect(getLogInkInputEvents(conflictsClear, 'C', {}, { conflictFileCount: 0 }))
        .toEqual([{ type: 'runWorkflowAction', id: 'continue-operation' }])
      expect(getLogInkInputEvents(conflictsBlocked, 'C', {}, { conflictFileCount: 2 })[0])
        .toMatchObject({
          type: 'action',
          action: { type: 'setStatus', value: 'Resolve all conflicts before continuing', kind: 'warning' },
        })

      // Compose: claims the keystroke with an explicit "finish draft
      // first" status so the user mid-draft doesn't fat-finger their
      // way out. Without this guard the keystroke would fall through
      // to the generic workflow-by-key dispatch at the bottom of
      // getLogInkInputEvents.
      const composeState = createLogInkState(rows, { activeView: 'compose' })
      expect(getLogInkInputEvents(composeState, 'C')).toEqual([
        {
          type: 'action',
          action: { type: 'setStatus', value: 'Finish or cancel the commit draft before creating a PR.', kind: 'warning' },
        },
      ])
    })

    it('L from history or branches starts the changelog flow', () => {
      // From the history view — `L` should start the changelog flow.
      // Runtime callback handles the fetch + view-push side effects;
      // from the input handler's perspective it's a single event the
      // dispatcher routes to startChangelogView.
      const historyState = createLogInkState(rows, { activeView: 'history' })
      expect(getLogInkInputEvents(historyState, 'L')).toEqual([
        { type: 'startChangelogView' },
      ])

      // From the branches view — same dispatch.
      const branchesState = createLogInkState(rows, { activeView: 'branches' })
      expect(getLogInkInputEvents(branchesState, 'L')).toEqual([
        { type: 'startChangelogView' },
      ])
    })

    it('L does not fire outside history / branches', () => {
      // Scoped tight on purpose — the changelog is a "where am I, what
      // landed here" question that fits history/branches semantics.
      // Other views keep their own L-bindings (or none) without
      // colliding with the changelog flow.
      const compose = createLogInkState(rows, { activeView: 'compose' })
      const status = createLogInkState(rows, { activeView: 'status' })
      const diff = createLogInkState(rows, { activeView: 'diff' })
      const stash = createLogInkState(rows, { activeView: 'stash' })

      for (const state of [compose, status, diff, stash]) {
        const events = getLogInkInputEvents(state, 'L')
        expect(events.some((event) => event.type === 'startChangelogView')).toBe(false)
      }
    })

    it('inside the changelog view, j/k scrolls one line at a time', () => {
      const state = createLogInkState(rows, { activeView: 'changelog' })
      expect(getLogInkInputEvents(state, 'j', {}, { changelogLineCount: 50 })).toEqual([
        { type: 'action', action: { type: 'pageChangelog', delta: 1, lineCount: 50 } },
      ])
      expect(getLogInkInputEvents(state, 'k', {}, { changelogLineCount: 50 })).toEqual([
        { type: 'action', action: { type: 'pageChangelog', delta: -1, lineCount: 50 } },
      ])
    })

    it('inside the changelog view, pgup/pgdn scrolls by 10 lines', () => {
      const state = createLogInkState(rows, { activeView: 'changelog' })
      expect(getLogInkInputEvents(state, '', { pageDown: true }, { changelogLineCount: 50 })).toEqual([
        { type: 'action', action: { type: 'pageChangelog', delta: 10, lineCount: 50 } },
      ])
      expect(getLogInkInputEvents(state, '', { pageUp: true }, { changelogLineCount: 50 })).toEqual([
        { type: 'action', action: { type: 'pageChangelog', delta: -10, lineCount: 50 } },
      ])
    })

    it('inside the changelog view, scroll keystrokes no-op when no content is loaded', () => {
      // changelogLineCount is undefined during loading / error states —
      // pressing j/k/pgup/pgdn should fall through cleanly rather than
      // dispatch a pageChangelog with an undefined line count.
      const state = createLogInkState(rows, { activeView: 'changelog' })
      const events = getLogInkInputEvents(state, 'j')
      expect(events.some((event) =>
        event.type === 'action' && event.action.type === 'pageChangelog'
      )).toBe(false)
    })

    it('inside the changelog view, y/E/c/r dispatch their workflow events', () => {
      const state = createLogInkState(rows, { activeView: 'changelog' })

      // y → yank text (handler reads view state, not context)
      expect(getLogInkInputEvents(state, 'y')).toEqual([{ type: 'yankChangelog' }])

      // E → open in $EDITOR (mirrors compose's `E` from #913)
      expect(getLogInkInputEvents(state, 'E')).toEqual([{ type: 'openChangelogInEditor' }])

      // c → kick off create-PR (handler can reuse the cached changelog)
      expect(getLogInkInputEvents(state, 'c')).toEqual([{ type: 'startCreatePullRequest' }])

      // r → regenerate (skip cache, re-run LLM)
      expect(getLogInkInputEvents(state, 'r')).toEqual([{ type: 'regenerateChangelog' }])
    })

    it('submitting a create-pr prompt dispatches runWorkflowAction with the raw multi-line value', () => {
      const state = applyLogInkAction(createLogInkState(rows), {
        type: 'openInputPrompt',
        kind: 'create-pr',
        label: 'Create PR',
        initial: 'feat: workstation refactor\n\nLine 1 of body.\nLine 2 of body.',
        multiline: true,
      })

      // Ctrl+D submits multi-line prompts. The payload arrives as the
      // raw value — the workflow handler in app.ts splits title (line 1)
      // from body (lines 2+).
      const events = getLogInkInputEvents(state, 'd', { ctrl: true })
      expect(events).toEqual([
        {
          type: 'runWorkflowAction',
          id: 'create-pr',
          payload: 'feat: workstation refactor\n\nLine 1 of body.\nLine 2 of body.',
        },
        { type: 'action', action: { type: 'closeInputPrompt' } },
      ])
    })

    it('submitting an empty create-pr prompt falls back to the generic empty-value guard', () => {
      const state = applyLogInkAction(createLogInkState(rows), {
        type: 'openInputPrompt',
        kind: 'create-pr',
        label: 'Create PR',
        multiline: true,
      })

      // Ctrl+D on an empty multi-line prompt is rejected by the generic
      // empty-value check that runs before the per-kind dispatch. The
      // prompt stays open and the user sees the same "enter a value or
      // press esc to cancel" status as every other empty submission.
      const events = getLogInkInputEvents(state, 'd', { ctrl: true })
      expect(events).toEqual([
        {
          type: 'action',
          action: { type: 'setStatus', value: 'enter a value or press esc to cancel', kind: 'warning' },
        },
      ])
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

    // Regression: with the header row highlighted, Space still staged —
    // and z offered to revert — the group's FIRST file, which the visible
    // cursor wasn't on (o/i/b/L targeted it too).
    it('Space / z / o / b / L are inert while the group header is focused', () => {
      const headerState = statusState({ selectedWorktreeFileIndex: 0, statusGroupHeaderFocused: true })
      const ctx = {
        worktreeFileCount: 6,
        statusGroups: groups,
        worktreeSelectedPath: 'src/first-file.ts',
      }
      for (const key of [' ', 'z', 'o', 'b', 'L']) {
        const events = getLogInkInputEvents(headerState, key, {}, ctx)
        expect(events).not.toContainEqual({ type: 'toggleSelectedFileStage' })
        expect(events).not.toContainEqual(
          expect.objectContaining({ type: 'openFileInEditor' })
        )
        const actionTypes = events
          .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
          .map((event) => event.action.type)
        expect(actionTypes).not.toContain('setPendingMutationConfirmation')
        expect(actionTypes).not.toContain('navigateOpenBlameForPath')
        expect(actionTypes).not.toContain('navigateOpenFileHistoryForPath')
      }
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
        { inspectorActionCount: 9 },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'moveInspectorAction', delta: -1, actionCount: 9 } },
      ])
    })

    it('↓ moves the cursor down through the actions list', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorActionIndex: 0 }),
        '',
        { downArrow: true },
        { inspectorActionCount: 9 },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'moveInspectorAction', delta: 1, actionCount: 9 } },
      ])
    })

    it('↑/↓ falls through to moveDetailFile when inspectorTab=inspector', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorTab: 'inspector', inspectorActionIndex: 0 }),
        '',
        { upArrow: true },
        { inspectorActionCount: 9, detailFileCount: 5 },
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
        { inspectorActionCount: 9 },
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
        { inspectorActionCount: 9 },
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
        { inspectorActionCount: 9 },
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
        { inspectorActionCount: 9 },
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

    it('Enter on fixup (index 5) sets pending confirmation for fixup-into-commit', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorActionIndex: 5 }),
        '',
        { return: true },
        { inspectorActionCount: 9 },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'setPendingConfirmation', value: 'fixup-into-commit' } },
      ])
    })

    it('Enter on yank (index 6) fires yankFromActiveView', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorActionIndex: 6 }),
        '',
        { return: true },
        { inspectorActionCount: 9 },
      )
      expect(events).toEqual([{ type: 'yankFromActiveView' }])
    })

    it('Enter on yank short (index 7) fires yankFromActiveView with short=true', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorActionIndex: 7 }),
        '',
        { return: true },
        { inspectorActionCount: 9 },
      )
      expect(events).toEqual([{ type: 'yankFromActiveView', short: true }])
    })

    it('Enter on open in browser (index 8) fires open-pr workflow', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorActionIndex: 8 }),
        '',
        { return: true },
        { inspectorActionCount: 9 },
      )
      expect(events).toEqual([{ type: 'runWorkflowAction', id: 'open-pr' }])
    })

    it('Enter on inspector tab (not actions) falls through to existing diff handler', () => {
      const events = getLogInkInputEvents(
        actionsFocusState({ inspectorTab: 'inspector' }),
        '',
        { return: true },
        { inspectorActionCount: 9, detailFileCount: 3 },
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
        { inspectorActionCount: 9 },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'setStatus', value: 'No commit selected', kind: 'warning' } },
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

  // #838 — `D` on the worktrees view fires the chained worktree
  // removal + branch delete instead of the global delete-branch
  // workflow. Scoped per-view so `D` from elsewhere keeps doing what
  // it always did.
  describe('worktree D-for-delete-with-branch', () => {
    function worktreesViewState(overrides: Partial<LogInkState> = {}) {
      const base = createLogInkState(rows)
      return {
        ...base,
        focus: 'commits' as const,
        activeView: 'worktrees' as const,
        viewStack: ['worktrees'] as LogInkState['viewStack'],
        ...overrides,
      }
    }

    it('D on the worktrees view fires the remove-worktree-and-branch confirm', () => {
      const events = getLogInkInputEvents(
        worktreesViewState(),
        'D',
        {},
        { worktreeListCount: 2 },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'setPendingConfirmation', value: 'remove-worktree-and-branch' } },
      ])
    })

    it('D from anywhere else still fires the global delete-branch workflow', () => {
      // History view: no per-view interception; global workflow-by-key
      // path takes over and routes to delete-branch.
      const events = getLogInkInputEvents(createLogInkState(rows), 'D', {})
      expect(events).toEqual([
        { type: 'action', action: { type: 'setPendingConfirmation', value: 'delete-branch' } },
      ])
    })

    it('W on the worktrees view still fires plain remove-worktree (existing behavior)', () => {
      const events = getLogInkInputEvents(
        worktreesViewState(),
        'W',
        {},
        { worktreeListCount: 2 },
      )
      expect(events).toEqual([
        { type: 'action', action: { type: 'setPendingConfirmation', value: 'remove-worktree' } },
      ])
    })

    it('D on the worktrees view with no worktrees falls through (no interception)', () => {
      const events = getLogInkInputEvents(
        worktreesViewState(),
        'D',
        {},
        { worktreeListCount: 0 },
      )
      // worktreeListCount=0 means the per-view guard doesn't fire; the
      // global workflow-by-key path then claims D for delete-branch.
      expect(events).toEqual([
        { type: 'action', action: { type: 'setPendingConfirmation', value: 'delete-branch' } },
      ])
    })
  })

  describe('conflicts view', () => {
    it('navigates to conflicts view via gx chord', () => {
      let state = createLogInkState(rows)
      // First key: g sets pending key
      state = applyInput(state, 'g')
      expect(state.pendingKey).toBe('g')
      // Second key: x pushes conflicts view
      state = applyInput(state, 'x')
      expect(state.activeView).toBe('conflicts')
      expect(state.viewStack).toEqual(['history', 'conflicts'])
    })

    it('moves cursor up and down in the conflicts view', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'conflicts' })

      state = applyInput(state, '', { downArrow: true }, { conflictFileCount: 3 })
      expect(state.selectedConflictFileIndex).toBe(1)

      state = applyInput(state, '', { upArrow: true }, { conflictFileCount: 3 })
      expect(state.selectedConflictFileIndex).toBe(0)
    })

    it('clamps cursor at bounds in the conflicts view', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'conflicts' })

      state = applyInput(state, '', { upArrow: true }, { conflictFileCount: 3 })
      expect(state.selectedConflictFileIndex).toBe(0)
    })

    it('dispatches resolve-conflict-stage on s key', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'conflicts' })

      const events = getLogInkInputEvents(state, 's', {}, {
        conflictFileCount: 2,
        conflictSelectedPath: 'src/conflict.ts',
      })

      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'resolve-conflict-stage', payload: 'src/conflict.ts' },
      ])
    })

    it('dispatches resolve-conflict-theirs on u key', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'conflicts' })

      const events = getLogInkInputEvents(state, 'u', {}, {
        conflictFileCount: 2,
        conflictSelectedPath: 'src/conflict.ts',
      })

      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'resolve-conflict-theirs', payload: 'src/conflict.ts' },
      ])
    })

    it('dispatches resolve-conflict-ours on U key', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'conflicts' })

      const events = getLogInkInputEvents(state, 'U', {}, {
        conflictFileCount: 2,
        conflictSelectedPath: 'src/conflict.ts',
      })

      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'resolve-conflict-ours', payload: 'src/conflict.ts' },
      ])
    })

    it('dispatches open-in-editor on o key', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'conflicts' })

      const events = getLogInkInputEvents(state, 'o', {}, {
        conflictFileCount: 2,
        conflictSelectedPath: 'src/conflict.ts',
      })

      expect(events).toEqual([
        { type: 'openFileInEditor', path: 'src/conflict.ts' },
      ])
    })

    it('dispatches open-diff on Enter key', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'conflicts' })

      const events = getLogInkInputEvents(state, '', { return: true }, {
        conflictFileCount: 2,
        conflictSelectedPath: 'src/conflict.ts',
      })

      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'resolve-conflict-open-diff', payload: 'src/conflict.ts' },
      ])
    })

    it('dispatches continue-operation on C key when no conflicts remain', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'conflicts' })

      const events = getLogInkInputEvents(state, 'C', {}, {
        conflictFileCount: 0,
      })

      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'continue-operation' },
      ])
    })

    it('does not dispatch continue-operation when conflicts remain', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'pushView', value: 'conflicts' })

      const events = getLogInkInputEvents(state, 'C', {}, {
        conflictFileCount: 3,
        conflictSelectedPath: 'src/conflict.ts',
      })

      // C is intercepted on the conflicts view to prevent fallthrough
      // to the global C (Create PR) binding. Shows a status hint instead.
      expect(events).toContainEqual({
        type: 'action',
        action: { type: 'setStatus', value: 'Resolve all conflicts before continuing', kind: 'warning' },
      })
      const hasConflictContinue = events.some(
        (e) => e.type === 'runWorkflowAction' && (e as { id: string }).id === 'continue-operation'
      )
      expect(hasConflictContinue).toBe(false)
    })

    it('does not fire conflict keys when not on the conflicts view', () => {
      const state = createLogInkState(rows)

      const events = getLogInkInputEvents(state, 's', {}, {
        conflictFileCount: 2,
        conflictSelectedPath: 'src/conflict.ts',
      })

      // On history view, 's' should not trigger resolve-conflict-stage
      const hasConflictStage = events.some(
        (e) => e.type === 'runWorkflowAction' && (e as { id: string }).id === 'resolve-conflict-stage'
      )
      expect(hasConflictStage).toBe(false)
    })
  })

  describe('split-plan overlay intercept (#907)', () => {
    // Mock plan + context for the 'ready' state tests. The shape is
    // what runCommitSplitPlanWorkflow would return on success — the
    // input handler doesn't validate it deeply, just checks presence.
    const mockPlan = {
      groups: [
        { title: 'feat: foo', files: ['src/foo.ts'], hunks: [] },
        { title: 'feat: bar', files: ['src/bar.ts'], hunks: [] },
      ],
    }
    const mockPlanContext = {
      changes: { staged: [], unstaged: [], untracked: [] },
      hunkInventory: { hunks: [], byId: new Map(), byFile: new Map() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    it('intercepts y/Enter as apply when the plan is ready', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, {
        type: 'setSplitPlanReady',
        plan: mockPlan,
        planContext: mockPlanContext,
      })

      expect(getLogInkInputEvents(state, 'y', {}, { splitPlanLineCount: 10 })).toEqual([
        { type: 'applyCommitSplit' },
      ])
      expect(getLogInkInputEvents(state, '', { return: true }, { splitPlanLineCount: 10 })).toEqual([
        { type: 'applyCommitSplit' },
      ])
    })

    it('intercepts Esc as cancel from any phase', () => {
      const loadingState = applyLogInkAction(createLogInkState(rows), { type: 'startSplitPlanLoad' })
      expect(getLogInkInputEvents(loadingState, '', { escape: true })).toEqual([
        { type: 'cancelCommitSplit' },
      ])

      const readyState = applyLogInkAction(createLogInkState(rows), {
        type: 'setSplitPlanReady',
        plan: mockPlan,
        planContext: mockPlanContext,
      })
      expect(getLogInkInputEvents(readyState, '', { escape: true })).toEqual([
        { type: 'cancelCommitSplit' },
      ])
    })

    it('intercepts j/k and ↑/↓ as line scroll', () => {
      const state = applyLogInkAction(createLogInkState(rows), {
        type: 'setSplitPlanReady',
        plan: mockPlan,
        planContext: mockPlanContext,
      })

      // j/k (vim convention)
      expect(getLogInkInputEvents(state, 'j', {}, { splitPlanLineCount: 50 })).toEqual([
        { type: 'action', action: { type: 'pageSplitPlan', delta: 1, lineCount: 50 } },
      ])
      expect(getLogInkInputEvents(state, 'k', {}, { splitPlanLineCount: 50 })).toEqual([
        { type: 'action', action: { type: 'pageSplitPlan', delta: -1, lineCount: 50 } },
      ])

      // Arrow keys (universal convention) — same dispatch.
      expect(getLogInkInputEvents(state, '', { downArrow: true }, { splitPlanLineCount: 50 })).toEqual([
        { type: 'action', action: { type: 'pageSplitPlan', delta: 1, lineCount: 50 } },
      ])
      expect(getLogInkInputEvents(state, '', { upArrow: true }, { splitPlanLineCount: 50 })).toEqual([
        { type: 'action', action: { type: 'pageSplitPlan', delta: -1, lineCount: 50 } },
      ])
    })

    it('intercepts PgUp/PgDn and space/b as page scroll', () => {
      const state = applyLogInkAction(createLogInkState(rows), {
        type: 'setSplitPlanReady',
        plan: mockPlan,
        planContext: mockPlanContext,
      })

      // PgDown / PgUp
      expect(getLogInkInputEvents(state, '', { pageDown: true }, { splitPlanLineCount: 50 })).toEqual([
        { type: 'action', action: { type: 'pageSplitPlan', delta: 10, lineCount: 50 } },
      ])
      expect(getLogInkInputEvents(state, '', { pageUp: true }, { splitPlanLineCount: 50 })).toEqual([
        { type: 'action', action: { type: 'pageSplitPlan', delta: -10, lineCount: 50 } },
      ])

      // space / b — vim-style aliases, work in every terminal even when
      // PgUp/PgDn don't deliver cleanly through Ink.
      expect(getLogInkInputEvents(state, ' ', {}, { splitPlanLineCount: 50 })).toEqual([
        { type: 'action', action: { type: 'pageSplitPlan', delta: 10, lineCount: 50 } },
      ])
      expect(getLogInkInputEvents(state, 'b', {}, { splitPlanLineCount: 50 })).toEqual([
        { type: 'action', action: { type: 'pageSplitPlan', delta: -10, lineCount: 50 } },
      ])
    })

    it('G jumps to bottom, gg jumps to top', () => {
      let state = applyLogInkAction(createLogInkState(rows), {
        type: 'setSplitPlanReady',
        plan: mockPlan,
        planContext: mockPlanContext,
      })

      // G — single keystroke, jumps to bottom (delta = lineCount).
      expect(getLogInkInputEvents(state, 'G', {}, { splitPlanLineCount: 50 })).toEqual([
        { type: 'action', action: { type: 'pageSplitPlan', delta: 50, lineCount: 50 } },
      ])

      // First g sets pendingKey for the gg chord.
      expect(getLogInkInputEvents(state, 'g', {}, { splitPlanLineCount: 50 })).toEqual([
        { type: 'action', action: { type: 'setPendingKey', value: 'g' } },
      ])

      // Second g (with pendingKey === 'g') jumps to top.
      state = applyLogInkAction(state, { type: 'setPendingKey', value: 'g' })
      expect(getLogInkInputEvents(state, 'g', {}, { splitPlanLineCount: 50 })).toEqual([
        { type: 'action', action: { type: 'pageSplitPlan', delta: -50, lineCount: 50 } },
      ])
    })

    it('r retries (re-runs the plan workflow) from the ready state', () => {
      // After an error, the overlay surfaces "Press `r` to retry" —
      // this keystroke should re-fire startCommitSplit. Also valid
      // from a healthy 'ready' state (regenerate, like the changelog
      // surface's `r`).
      const state = applyLogInkAction(createLogInkState(rows), {
        type: 'setSplitPlanReady',
        plan: mockPlan,
        planContext: mockPlanContext,
      })

      expect(getLogInkInputEvents(state, 'r', {}, { splitPlanLineCount: 10 })).toEqual([
        { type: 'startCommitSplit' },
      ])
    })

    it('r is a no-op during loading / applying (no workflow stacking)', () => {
      const loadingState = applyLogInkAction(createLogInkState(rows), { type: 'startSplitPlanLoad' })
      expect(getLogInkInputEvents(loadingState, 'r')).toEqual([])

      let applyingState = applyLogInkAction(createLogInkState(rows), {
        type: 'setSplitPlanReady',
        plan: mockPlan,
        planContext: mockPlanContext,
      })
      applyingState = applyLogInkAction(applyingState, { type: 'setSplitPlanApplying' })
      expect(getLogInkInputEvents(applyingState, 'r', {}, { splitPlanLineCount: 10 })).toEqual([])
    })

    it('y/Enter no-op while loading (no plan to apply)', () => {
      const state = applyLogInkAction(createLogInkState(rows), { type: 'startSplitPlanLoad' })

      // Returns empty array — keystroke consumed, no dispatch.
      expect(getLogInkInputEvents(state, 'y')).toEqual([])
      expect(getLogInkInputEvents(state, '', { return: true })).toEqual([])
    })

    it('consumes all other keystrokes without falling through to compose bindings', () => {
      // While the overlay is open, none of the compose keystrokes
      // (`c` commit, `e` inline-edit, `E` external editor) should
      // reach the underlying view.
      const state = applyLogInkAction(createLogInkState(rows), {
        type: 'setSplitPlanReady',
        plan: mockPlan,
        planContext: mockPlanContext,
      })

      // `c` on compose normally fires createManualCommit. With the
      // overlay open, it should be consumed (empty array, no event).
      expect(getLogInkInputEvents(state, 'c', {}, { splitPlanLineCount: 10 })).toEqual([])
      expect(getLogInkInputEvents(state, 'e', {}, { splitPlanLineCount: 10 })).toEqual([])
      expect(getLogInkInputEvents(state, 'E', {}, { splitPlanLineCount: 10 })).toEqual([])
    })
  })
})

describe('issue / pull-request triage chords (#882 phase 3)', () => {
  it('pushes the issues view with the gi chord', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, 'g')
    expect(state.pendingKey).toBe('g')

    state = applyInput(state, 'i')
    expect(state.activeView).toBe('issues')
    expect(state.viewStack).toContain('issues')
    expect(state.pendingKey).toBeUndefined()
  })

  it('pushes the pull-request-triage view with the gP chord', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, 'g')
    state = applyInput(state, 'P')

    expect(state.activeView).toBe('pull-request-triage')
    expect(state.viewStack).toContain('pull-request-triage')
  })

  it('preserves the existing gp chord for the single-PR action panel', () => {
    // Regression guard: capital-P must not steal the lowercase-p
    // binding. The single-PR panel and the multi-PR triage list are
    // separate surfaces, both reachable from the root.
    let state = createLogInkState(rows)

    state = applyInput(state, 'g')
    state = applyInput(state, 'p')

    expect(state.activeView).toBe('pull-request')
  })

  it('j on the issues view increments selectedIssueIndex when there are items', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'issues' })

    state = applyInput(state, 'j', {}, { issueCount: 5 })
    expect(state.selectedIssueIndex).toBe(1)

    state = applyInput(state, 'j', {}, { issueCount: 5 })
    expect(state.selectedIssueIndex).toBe(2)
  })

  it('k on the issues view decrements selectedIssueIndex', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'issues' })
    state = { ...state, selectedIssueIndex: 3 }

    state = applyInput(state, 'k', {}, { issueCount: 5 })
    expect(state.selectedIssueIndex).toBe(2)
  })

  it('j on the pull-request-triage view increments selectedPullRequestTriageIndex', () => {
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'pull-request-triage' })

    state = applyInput(state, 'j', {}, { pullRequestTriageCount: 4 })
    expect(state.selectedPullRequestTriageIndex).toBe(1)
  })

  it('j on the issues view falls through to the commit-move fallback when issueCount is 0', () => {
    // Mirrors the existing pattern for the other promoted views — the
    // j/k branch only claims the keystroke when there are items to
    // navigate. Empty list → keystroke falls through to the default
    // sidebar / move handler.
    let state = createLogInkState(rows)
    state = applyLogInkAction(state, { type: 'pushView', value: 'issues' })

    state = applyInput(state, 'j', {}, {})
    expect(state.selectedIssueIndex).toBe(0)
  })
})

describe('triage-view per-row actions (#882 phase 4)', () => {
  describe('issues view', () => {
    const baseState = (): LogInkState =>
      applyLogInkAction(createLogInkState(rows), { type: 'pushView', value: 'issues' })

    it('O dispatches the triage-issue-open workflow when an URL is in scope', () => {
      const state = baseState()
      const events = getLogInkInputEvents(state, 'O', {}, {
        issueCount: 1,
        issueSelectedUrl: 'https://github.com/gfargo/coco/issues/882',
      })
      expect(events).toEqual([{ type: 'runWorkflowAction', id: 'triage-issue-open' }])
    })

    it('O falls through to the global open-pr workflow when no issue URL is in scope', () => {
      // Without an issue URL in context, the triage-O handler doesn't
      // claim the keystroke — it falls through to the global O
      // binding (which targets the current branch's PR / commit /
      // repo). Documenting this so the next maintainer doesn't
      // confuse "no issue cursored" with "no-op".
      const state = baseState()
      const events = getLogInkInputEvents(state, 'O', {}, {})
      expect(events).toEqual([{ type: 'runWorkflowAction', id: 'open-pr' }])
    })

    it('c opens a multi-line input prompt for triage-issue-comment', () => {
      const state = applyInput(baseState(), 'c', {}, { issueCount: 5 })
      expect(state.inputPrompt?.kind).toBe('triage-issue-comment')
      expect(state.inputPrompt?.multiline).toBe(true)
    })

    it('L opens an input prompt for triage-issue-label', () => {
      const state = applyInput(baseState(), 'L', {}, { issueCount: 5 })
      expect(state.inputPrompt?.kind).toBe('triage-issue-label')
      expect(state.inputPrompt?.multiline).toBeFalsy()
    })

    it('A pre-seeds the assignee prompt with @me for ergonomics', () => {
      const state = applyInput(baseState(), 'A', {}, { issueCount: 5 })
      expect(state.inputPrompt?.kind).toBe('triage-issue-assign')
      expect(state.inputPrompt?.value).toBe('@me')
    })

    it('y dispatches yankFromActiveView when an issue URL is in scope', () => {
      const state = baseState()
      const events = getLogInkInputEvents(state, 'y', {}, {
        issueCount: 1,
        issueSelectedUrl: 'https://github.com/gfargo/coco/issues/882',
      })
      expect(events).toEqual([{ type: 'yankFromActiveView' }])
    })

    it('submitting the triage-issue-comment prompt (Ctrl+D) fires runWorkflowAction with the body', () => {
      // The comment prompt is multi-line, so Enter inserts a newline
      // and Ctrl+D is the submit affordance — mirrors the
      // pr-comment / pr-request-changes prompts. The single-line
      // triage-issue-label / triage-issue-assign prompts submit on
      // Enter (no Ctrl+D needed).
      let state = baseState()
      state = applyInput(state, 'c', {}, { issueCount: 5 })
      state = applyLogInkAction(state, { type: 'appendInputPrompt', value: 'lgtm' })

      const events = getLogInkInputEvents(state, 'd', { ctrl: true })
      const workflow = events.find((e) => e.type === 'runWorkflowAction')
      expect(workflow).toEqual({
        type: 'runWorkflowAction',
        id: 'triage-issue-comment',
        payload: 'lgtm',
      })
    })

    it('submitting the triage-issue-label prompt (Enter) fires runWorkflowAction', () => {
      let state = baseState()
      state = applyInput(state, 'L', {}, { issueCount: 5 })
      state = applyLogInkAction(state, { type: 'appendInputPrompt', value: 'enhancement' })

      const events = getLogInkInputEvents(state, '', { return: true })
      const workflow = events.find((e) => e.type === 'runWorkflowAction')
      expect(workflow).toEqual({
        type: 'runWorkflowAction',
        id: 'triage-issue-label',
        payload: 'enhancement',
      })
    })

    it('Enter on a multi-line triage prompt inserts a newline instead of submitting', () => {
      let state = baseState()
      state = applyInput(state, 'c', {}, { issueCount: 5 })
      state = applyInput(state, 'a')
      state = applyInput(state, '', { return: true })
      expect(state.inputPrompt?.value).toBe('a\n')
    })
  })

  describe('pull-request-triage view', () => {
    const baseState = (): LogInkState =>
      applyLogInkAction(createLogInkState(rows), {
        type: 'pushView',
        value: 'pull-request-triage',
      })

    it('O dispatches the triage-pr-open workflow when a PR URL is in scope', () => {
      const state = baseState()
      const events = getLogInkInputEvents(state, 'O', {}, {
        pullRequestTriageCount: 1,
        pullRequestTriageSelectedUrl: 'https://github.com/gfargo/coco/pull/962',
      })
      expect(events).toEqual([{ type: 'runWorkflowAction', id: 'triage-pr-open' }])
    })

    it('c / L / A open the matching triage-pr-* prompt kinds', () => {
      let state = applyInput(baseState(), 'c', {}, { pullRequestTriageCount: 3 })
      expect(state.inputPrompt?.kind).toBe('triage-pr-comment')

      state = applyInput(baseState(), 'L', {}, { pullRequestTriageCount: 3 })
      expect(state.inputPrompt?.kind).toBe('triage-pr-label')

      state = applyInput(baseState(), 'A', {}, { pullRequestTriageCount: 3 })
      expect(state.inputPrompt?.kind).toBe('triage-pr-assign')
    })

    it('does NOT collide with the single-PR action panel keys', () => {
      // Regression guard: from the `pull-request` view (single, current
      // branch), `c` still routes to the existing `pr-comment` prompt,
      // not the triage variant.
      const state = applyLogInkAction(createLogInkState(rows), {
        type: 'pushView',
        value: 'pull-request',
      })
      const result = applyInput(state, 'c')
      expect(result.inputPrompt?.kind).toBe('pr-comment')
    })
  })
})

describe('triage-view destructive actions (#882 phase 5)', () => {
  describe('issues view', () => {
    const baseState = (): LogInkState =>
      applyLogInkAction(createLogInkState(rows), { type: 'pushView', value: 'issues' })

    it('x sets pendingConfirmation to triage-issue-close', () => {
      const state = applyInput(baseState(), 'x', {}, { issueCount: 5 })
      expect(state.pendingConfirmationId).toBe('triage-issue-close')
    })

    it('X sets pendingConfirmation to triage-issue-reopen', () => {
      const state = applyInput(baseState(), 'X', {}, { issueCount: 5 })
      expect(state.pendingConfirmationId).toBe('triage-issue-reopen')
    })

    it('x is a no-op when no issues are in scope', () => {
      const state = applyInput(baseState(), 'x', {}, {})
      // Falls through to whatever-else binds `x` globally (currently
      // nothing on this view), so no confirmation fires.
      expect(state.pendingConfirmationId).toBeUndefined()
    })

    it('confirming triage-issue-close fires runWorkflowAction', () => {
      const state = applyInput(baseState(), 'x', {}, { issueCount: 5 })
      const events = getLogInkInputEvents(state, 'y')
      const workflow = events.find((e) => e.type === 'runWorkflowAction')
      expect(workflow).toEqual({
        type: 'runWorkflowAction',
        id: 'triage-issue-close',
        payload: undefined,
      })
    })

    it('n cancels the confirmation without firing the workflow', () => {
      let state = applyInput(baseState(), 'x', {}, { issueCount: 5 })
      state = applyInput(state, 'n')
      expect(state.pendingConfirmationId).toBeUndefined()
    })
  })

  describe('pull-request-triage view', () => {
    const baseState = (): LogInkState =>
      applyLogInkAction(createLogInkState(rows), {
        type: 'pushView',
        value: 'pull-request-triage',
      })

    it('x sets pendingConfirmation to triage-pr-close', () => {
      const state = applyInput(baseState(), 'x', {}, { pullRequestTriageCount: 3 })
      expect(state.pendingConfirmationId).toBe('triage-pr-close')
    })

    it('a sets pendingConfirmation to triage-pr-approve', () => {
      const state = applyInput(baseState(), 'a', {}, { pullRequestTriageCount: 3 })
      expect(state.pendingConfirmationId).toBe('triage-pr-approve')
    })

    it('m opens the merge-strategy prompt', () => {
      const state = applyInput(baseState(), 'm', {}, { pullRequestTriageCount: 3 })
      expect(state.inputPrompt?.kind).toBe('triage-pr-merge-strategy')
      expect(state.pendingConfirmationId).toBeUndefined()
    })

    it('submitting the merge-strategy prompt validates the strategy + routes through y-confirm', () => {
      let state = applyInput(baseState(), 'm', {}, { pullRequestTriageCount: 3 })
      state = applyLogInkAction(state, { type: 'appendInputPrompt', value: 'squash' })
      state = applyInput(state, '', { return: true })
      expect(state.pendingConfirmationId).toBe('triage-pr-merge')
      expect(state.pendingConfirmationPayload).toBe('squash')
      expect(state.inputPrompt).toBeUndefined()
    })

    it('rejects unknown merge strategies with a status message', () => {
      let state = applyInput(baseState(), 'm', {}, { pullRequestTriageCount: 3 })
      state = applyLogInkAction(state, { type: 'appendInputPrompt', value: 'fastforward' })
      const events = getLogInkInputEvents(state, '', { return: true })
      const status = events.find(
        (e): e is Extract<typeof e, { type: 'action' }> =>
          e.type === 'action' && (e.action as { type: string }).type === 'setStatus'
      )
      expect(status).toBeDefined()
      expect(JSON.stringify(status)).toContain('Unknown merge strategy')
    })

    it('R opens the request-changes multi-line prompt', () => {
      const state = applyInput(baseState(), 'R', {}, { pullRequestTriageCount: 3 })
      expect(state.inputPrompt?.kind).toBe('triage-pr-request-changes')
      expect(state.inputPrompt?.multiline).toBe(true)
    })

    it('submitting the request-changes prompt routes through y-confirm with the body as payload', () => {
      let state = applyInput(baseState(), 'R', {}, { pullRequestTriageCount: 3 })
      state = applyLogInkAction(state, { type: 'appendInputPrompt', value: 'please address X' })
      state = applyInput(state, 'd', { ctrl: true })
      expect(state.pendingConfirmationId).toBe('triage-pr-request-changes')
      expect(state.pendingConfirmationPayload).toBe('please address X')
    })

    it('confirming triage-pr-merge forwards the strategy payload to the workflow', () => {
      let state = applyInput(baseState(), 'm', {}, { pullRequestTriageCount: 3 })
      state = applyLogInkAction(state, { type: 'appendInputPrompt', value: 'rebase' })
      state = applyInput(state, '', { return: true })
      const events = getLogInkInputEvents(state, 'y')
      const workflow = events.find((e) => e.type === 'runWorkflowAction')
      expect(workflow).toEqual({
        type: 'runWorkflowAction',
        id: 'triage-pr-merge',
        payload: 'rebase',
      })
    })

    it('does NOT collide with the single-PR action panel keys', () => {
      // Regression guard: from the `pull-request` view, `x` still
      // routes to the existing `close-pr` confirmation (not the
      // triage variant).
      const state = applyLogInkAction(createLogInkState(rows), {
        type: 'pushView',
        value: 'pull-request',
      })
      const result = applyInput(state, 'x')
      expect(result.pendingConfirmationId).toBe('close-pr')
    })
  })
})

describe('triage filter cycling (#882 phase 6)', () => {
  it('f on the issues view cycles the issue filter preset', () => {
    let state = applyLogInkAction(createLogInkState(rows), {
      type: 'pushView',
      value: 'issues',
    })
    expect(state.selectedIssueFilter).toBe('open')

    state = applyInput(state, 'f')
    expect(state.selectedIssueFilter).toBe('closed')

    state = applyInput(state, 'f')
    expect(state.selectedIssueFilter).toBe('mine')
  })

  it('f on the pull-request-triage view cycles the PR filter preset', () => {
    let state = applyLogInkAction(createLogInkState(rows), {
      type: 'pushView',
      value: 'pull-request-triage',
    })
    expect(state.selectedPullRequestFilter).toBe('open')

    state = applyInput(state, 'f')
    expect(state.selectedPullRequestFilter).toBe('draft')
  })

  it('f on the history view does not touch either triage preset', () => {
    // Regression guard: `f` is a single-letter key with no global
    // binding currently. Adding it as a triage-scoped chord must
    // not accidentally claim it elsewhere.
    let state = createLogInkState(rows)
    expect(state.activeView).toBe('history')

    state = applyInput(state, 'f')
    expect(state.selectedIssueFilter).toBe('open')
    expect(state.selectedPullRequestFilter).toBe('open')
  })

  // #1135 v2 — momentary sidebar "peek" on narrow (single-pane)
  // terminals: `v` jumps to the sidebar with a return ticket; `v`/Esc
  // snaps back to where you were; browsing the sidebar keeps it open;
  // any explicit focus change or drill-in cancels the ticket.
  describe('peek (single-pane sidebar glance)', () => {
    const singlePane = { singlePane: true }

    it('v opens a sidebar peek from the main pane and stores the return focus', () => {
      let state = createLogInkState(rows)
      expect(state.focus).toBe('commits')

      state = applyInput(state, 'v', {}, singlePane)
      expect(state.focus).toBe('sidebar')
      expect(state.peekReturnFocus).toBe('commits')
    })

    it('v again snaps back to the original pane and clears the ticket', () => {
      let state = createLogInkState(rows)
      state = applyInput(state, 'v', {}, singlePane)
      state = applyInput(state, 'v', {}, singlePane)
      expect(state.focus).toBe('commits')
      expect(state.peekReturnFocus).toBeUndefined()
    })

    it('Esc closes a peek back to the original pane', () => {
      let state = createLogInkState(rows)
      state = applyInput(state, 'v', {}, singlePane)
      state = applyInput(state, '', { escape: true }, singlePane)
      expect(state.focus).toBe('commits')
      expect(state.peekReturnFocus).toBeUndefined()
    })

    it('keeps the peek open while browsing the sidebar (←/→ tab switch)', () => {
      let state = createLogInkState(rows)
      state = applyInput(state, 'v', {}, singlePane)
      expect(state.sidebarTab).toBe('branches')

      state = applyInput(state, '', { rightArrow: true }, singlePane)
      expect(state.sidebarTab).not.toBe('branches')
      // Still peeking — the glance survives sidebar navigation.
      expect(state.focus).toBe('sidebar')
      expect(state.peekReturnFocus).toBe('commits')
    })

    it('Tab cancels the peek ticket (explicit focus change)', () => {
      let state = createLogInkState(rows)
      state = applyInput(state, 'v', {}, singlePane)
      state = applyInput(state, '', { tab: true }, singlePane)
      expect(state.peekReturnFocus).toBeUndefined()
    })

    it('v is a no-op in the three-pane layout (not single-pane)', () => {
      let state = createLogInkState(rows)
      state = applyInput(state, 'v', {}, { singlePane: false })
      expect(state.focus).toBe('commits')
      expect(state.peekReturnFocus).toBeUndefined()
    })
  })

  describe('worktree-checkout-conflict choice prompt (#1175, #1181)', () => {
    function conflictState() {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, {
        type: 'setWorktreeCheckoutConflict',
        value: { branch: 'feat/x', worktreePath: '/repo/.wt/foo', dirty: false },
      })
      state = applyLogInkAction(state, {
        type: 'setPendingChoice',
        value: {
          id: 'worktree-checkout-conflict',
          title: "'feat/x' is checked out in another worktree",
          options: [
            { key: 'y', label: 'Switch to that worktree', intent: 'switch-worktree' },
            { key: 'r', label: 'Remove worktree & check out here', workflowId: 'conflict-remove-worktree-checkout', destructive: true },
            { key: 'x', label: 'Remove worktree & delete branch', workflowId: 'conflict-remove-worktree-branch', destructive: true },
          ],
        },
      })
      return state
    }

    it('y (switch intent) pushes a repo frame for the conflicting worktree and clears the prompt', () => {
      const state = conflictState()
      const events = getLogInkInputEvents(state, 'y')
      const pushFrame = events.find(
        (e): e is Extract<typeof e, { type: 'action' }> =>
          e.type === 'action' && e.action.type === 'pushRepoFrame'
      )
      expect(pushFrame).toBeDefined()
      expect((pushFrame as { action: { workdir?: string; label?: string } }).action.workdir).toBe('/repo/.wt/foo')
      expect((pushFrame as { action: { workdir?: string; label?: string } }).action.label).toBe('feat/x')

      const after = applyInput(state, 'y')
      expect(after.repoStack.length).toBe(state.repoStack.length + 1)
      expect(after.pendingChoice).toBeUndefined()
      expect(after.worktreeCheckoutConflict).toBeUndefined()
    })

    it('n cancels without switching and clears the conflict', () => {
      const state = conflictState()
      const after = applyInput(state, 'n')
      expect(after.repoStack.length).toBe(state.repoStack.length)
      expect(after.pendingChoice).toBeUndefined()
      expect(after.worktreeCheckoutConflict).toBeUndefined()
    })

    it('Esc also cancels and clears the conflict', () => {
      const state = conflictState()
      const after = applyInput(state, '', { escape: true })
      expect(after.repoStack.length).toBe(state.repoStack.length)
      expect(after.pendingChoice).toBeUndefined()
      expect(after.worktreeCheckoutConflict).toBeUndefined()
    })

    it('r runs the remove-worktree-&-checkout workflow and closes the prompt', () => {
      const state = conflictState()
      const events = getLogInkInputEvents(state, 'r')
      expect(events).toContainEqual({ type: 'runWorkflowAction', id: 'conflict-remove-worktree-checkout' })
      // The runtime owns clearing the conflict (it reads it first), so
      // the input layer only closes the choice prompt.
      const after = applyInput(state, 'r')
      expect(after.pendingChoice).toBeUndefined()
    })

    it('x runs the remove-worktree-&-branch workflow and closes the prompt', () => {
      const state = conflictState()
      const events = getLogInkInputEvents(state, 'x')
      expect(events).toContainEqual({ type: 'runWorkflowAction', id: 'conflict-remove-worktree-branch' })
    })

    it('ignores keys that match no option', () => {
      const state = conflictState()
      const after = applyInput(state, 'q')
      // Still showing the prompt; nothing fired.
      expect(after.pendingChoice).toBeDefined()
      expect(after.repoStack.length).toBe(state.repoStack.length)
    })
  })
})

// Every view in the LogInkView union. Kept here (not imported as a runtime
// list — the type has no runtime form) so a reviewer adding a view to the union
// updates both the allowlists in inkInput.ts AND this expectation, which is the
// whole point of the allowlist conversion (#0.68): no silent inheritance.
const ALL_VIEWS: LogInkView[] = [
  'history', 'status', 'diff', 'compose', 'branches', 'tags', 'stash',
  'worktrees', 'pull-request', 'pull-request-triage', 'issues', 'conflicts',
  'reflog', 'bisect', 'changelog', 'submodules',
]

describe('global key allowlists (negation-guard conversion)', () => {
  it('C creates a PR in every view except conflicts', () => {
    for (const view of ALL_VIEWS) {
      expect(isCreatePrView(view)).toBe(view !== 'conflicts')
    }
  })

  it('S creates a stash in every view except the commit triad (compose/status/diff)', () => {
    const triad: LogInkView[] = ['compose', 'status', 'diff']
    for (const view of ALL_VIEWS) {
      expect(isCreateStashView(view)).toBe(!triad.includes(view))
    }
  })
})
