import { GitLogRow } from './data'
import { getLogInkInputEvents } from './inkInput'
import { applyLogInkAction, createLogInkState } from './inkViewModel'

const rows: GitLogRow[] = [
  {
    type: 'commit',
    graph: '*',
    shortHash: 'abc1234',
    hash: 'abc123456789',
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

    state = applyInput(state, 'j', {}, {
      worktreeDiffLineCount: 30,
      worktreeHunkOffsets: [2, 12, 20],
    })
    expect(state.worktreeDiffOffset).toBe(12)
    expect(state.selectedWorktreeHunkIndex).toBe(1)

    state = applyInput(state, '', { escape: true })
    expect(state.activeView).toBe('status')
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
})
