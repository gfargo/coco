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

    state = applyInput(state, 'g')
    expect(state.fullGraph).toBe(true)

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

    state = applyInput(state, '', { escape: true })
    expect(state.activeView).toBe('status')
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

  it('gates destructive and AI workflow actions behind confirmation', () => {
    let state = createLogInkState(rows)

    state = applyInput(state, 'D')
    expect(state.pendingConfirmationId).toBe('delete-branch')

    state = applyInput(state, 'n')
    expect(state.pendingConfirmationId).toBeUndefined()
    expect(state.statusMessage).toBe('workflow action cancelled')

    state = applyInput(state, 'I')
    expect(state.pendingConfirmationId).toBe('ai-commit-summary')

    state = applyInput(state, 'y')
    expect(state.pendingConfirmationId).toBeUndefined()
    expect(state.statusMessage).toBe('AI commit summary queued for workflow execution')
  })
})
