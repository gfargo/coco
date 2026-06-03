import { WorkspaceOverview } from '../../../git/workspaceData'

import { resolveWorkspaceInput, WorkspaceInputKey } from './input'
import { createWorkspaceState, WorkspaceState } from './state'

function key(overrides: Partial<WorkspaceInputKey> = {}): WorkspaceInputKey {
  return { ...overrides }
}

const emptyOverview: WorkspaceOverview = {
  roots: ['/tmp'],
  repos: [],
  scannedAt: '2026-05-26T00:00:00Z',
}

function listState(filter = ''): WorkspaceState {
  const base = createWorkspaceState({ overview: emptyOverview, roots: ['~/code'] })
  return { ...base, filter }
}

function filterState(): WorkspaceState {
  return { ...createWorkspaceState({ overview: emptyOverview, roots: ['~/code'] }), focus: 'filter' }
}

function addRepoState(): WorkspaceState {
  return { ...createWorkspaceState({ overview: emptyOverview, roots: ['~/code'] }), focus: 'add-repo' }
}

function cloneState(): WorkspaceState {
  return { ...createWorkspaceState({ overview: emptyOverview, roots: ['~/code'] }), focus: 'clone-repo' }
}

describe('resolveWorkspaceInput', () => {
  it('list focus: `c` opens the clone-repo prompt', () => {
    expect(resolveWorkspaceInput('c', key(), listState()).kind).toBe('clone-repo')
  })

  it('clone-repo focus: Esc cancels back to the list', () => {
    expect(resolveWorkspaceInput('', key({ escape: true }), cloneState())).toEqual({
      kind: 'action',
      action: { type: 'set-focus', focus: 'list' },
    })
  })

  it('clone-repo focus: printable keys are no-ops in the resolver (runtime owns them)', () => {
    expect(resolveWorkspaceInput('h', key(), cloneState()).kind).toBe('noop')
    expect(resolveWorkspaceInput('', key({ return: true }), cloneState()).kind).toBe('noop')
  })

  it('quits on q only — escape never quits because terminals can deliver bare ESC on arrow keys', () => {
    expect(resolveWorkspaceInput('q', key(), listState()).kind).toBe('quit')
    // Bare ESC must NOT quit; it would crash the app every time the
    // user pressed an arrow key on terminals that deliver ESC + [ + A
    // as separate keypresses.
    expect(resolveWorkspaceInput('', key({ escape: true }), listState()).kind).toBe('noop')
  })

  it('clears the filter on escape when a filter is set', () => {
    expect(resolveWorkspaceInput('', key({ escape: true }), listState('foo'))).toEqual({
      kind: 'action',
      action: { type: 'clear-filter' },
    })
  })

  it('moves the cursor on j/k and arrow keys (list focus)', () => {
    expect(resolveWorkspaceInput('j', key(), listState())).toEqual({
      kind: 'action',
      action: { type: 'move-cursor', delta: 1 },
    })
    expect(resolveWorkspaceInput('', key({ downArrow: true }), listState())).toEqual({
      kind: 'action',
      action: { type: 'move-cursor', delta: 1 },
    })
    expect(resolveWorkspaceInput('k', key(), listState())).toEqual({
      kind: 'action',
      action: { type: 'move-cursor', delta: -1 },
    })
    expect(resolveWorkspaceInput('', key({ pageDown: true }), listState())).toEqual({
      kind: 'action',
      action: { type: 'move-cursor', delta: 10 },
    })
  })

  it('jumps to top with g and bottom with G (list focus)', () => {
    expect(resolveWorkspaceInput('g', key(), listState())).toEqual({
      kind: 'action',
      action: { type: 'set-cursor', index: 0 },
    })
    expect(resolveWorkspaceInput('G', key(), listState())).toEqual({
      kind: 'action',
      action: { type: 'set-cursor', index: Number.MAX_SAFE_INTEGER },
    })
  })

  it('cycles panel focus on tab / shift-tab', () => {
    expect(resolveWorkspaceInput('', key({ tab: true }), listState())).toEqual({
      kind: 'action',
      action: { type: 'cycle-panel-focus', direction: 'next' },
    })
    expect(resolveWorkspaceInput('', key({ tab: true, shift: true }), listState())).toEqual({
      kind: 'action',
      action: { type: 'cycle-panel-focus', direction: 'previous' },
    })
  })

  it('list focus: h / ← moves focus to the sidebar', () => {
    expect(resolveWorkspaceInput('h', key(), listState())).toEqual({
      kind: 'action',
      action: { type: 'set-focus', focus: 'sidebar' },
    })
    expect(resolveWorkspaceInput('', key({ leftArrow: true }), listState())).toEqual({
      kind: 'action',
      action: { type: 'set-focus', focus: 'sidebar' },
    })
  })

  it('sidebar focus: j/k cycles the active tab and l/Enter jumps back to the list', () => {
    const sidebar = { ...listState(), focus: 'sidebar' as const }
    expect(resolveWorkspaceInput('j', key(), sidebar)).toEqual({
      kind: 'action',
      action: { type: 'cycle-tab', direction: 'next' },
    })
    expect(resolveWorkspaceInput('k', key(), sidebar)).toEqual({
      kind: 'action',
      action: { type: 'cycle-tab', direction: 'previous' },
    })
    expect(resolveWorkspaceInput('l', key(), sidebar)).toEqual({
      kind: 'action',
      action: { type: 'set-focus', focus: 'list' },
    })
    expect(resolveWorkspaceInput('', key({ return: true }), sidebar)).toEqual({
      kind: 'action',
      action: { type: 'set-focus', focus: 'list' },
    })
  })

  it('opens the filter prompt on / and routes drill-in on enter', () => {
    expect(resolveWorkspaceInput('/', key(), listState())).toEqual({
      kind: 'action',
      action: { type: 'set-focus', focus: 'filter' },
    })
    expect(resolveWorkspaceInput('', key({ return: true }), listState()).kind).toBe('drill-in')
  })

  it('cycles sort, refresh, and add-repo intents on their bindings', () => {
    expect(resolveWorkspaceInput('s', key(), listState())).toEqual({
      kind: 'action',
      action: { type: 'cycle-sort' },
    })
    expect(resolveWorkspaceInput('r', key(), listState()).kind).toBe('refresh')
    expect(resolveWorkspaceInput('a', key(), listState()).kind).toBe('add-repo')
  })

  it('lets escape exit the filter prompt and enter commit it', () => {
    expect(resolveWorkspaceInput('', key({ escape: true }), filterState())).toEqual({
      kind: 'action',
      action: { type: 'clear-filter' },
    })
    expect(resolveWorkspaceInput('', key({ return: true }), filterState())).toEqual({
      kind: 'action',
      action: { type: 'set-focus', focus: 'list' },
    })
    expect(resolveWorkspaceInput('a', key(), filterState()).kind).toBe('noop')
  })

  it('routes d to request-delete while focused on the list', () => {
    expect(resolveWorkspaceInput('d', key(), listState()).kind).toBe('request-delete')
  })

  it('confirm-delete focus accepts only y/Y; every other key cancels', () => {
    const state = { ...listState(), focus: 'confirm-delete' as const, pendingDeletePath: '/tmp/r' }
    expect(resolveWorkspaceInput('y', key(), state).kind).toBe('confirm-delete')
    expect(resolveWorkspaceInput('Y', key(), state).kind).toBe('confirm-delete')
    expect(resolveWorkspaceInput('n', key(), state)).toEqual({
      kind: 'action',
      action: { type: 'cancel-delete' },
    })
    expect(resolveWorkspaceInput('', key({ escape: true }), state)).toEqual({
      kind: 'action',
      action: { type: 'cancel-delete' },
    })
  })

  it('routes ? to toggle-help while focused on the list', () => {
    expect(resolveWorkspaceInput('?', key(), listState())).toEqual({
      kind: 'action',
      action: { type: 'toggle-help' },
    })
  })

  it('closes the help overlay on esc/?/q', () => {
    const state = { ...listState(), showHelp: true }
    expect(resolveWorkspaceInput('', key({ escape: true }), state)).toEqual({
      kind: 'action',
      action: { type: 'close-help' },
    })
    expect(resolveWorkspaceInput('?', key(), state)).toEqual({
      kind: 'action',
      action: { type: 'close-help' },
    })
    expect(resolveWorkspaceInput('q', key(), state)).toEqual({
      kind: 'action',
      action: { type: 'close-help' },
    })
  })

  it('scrolls the help overlay with j/k/↑/↓ and ctrl+d/u', () => {
    const state = { ...listState(), showHelp: true }
    expect(resolveWorkspaceInput('j', key(), state)).toEqual({
      kind: 'action',
      action: { type: 'scroll-help', delta: 1 },
    })
    expect(resolveWorkspaceInput('', key({ downArrow: true }), state)).toEqual({
      kind: 'action',
      action: { type: 'scroll-help', delta: 1 },
    })
    expect(resolveWorkspaceInput('k', key(), state)).toEqual({
      kind: 'action',
      action: { type: 'scroll-help', delta: -1 },
    })
    expect(resolveWorkspaceInput('', key({ upArrow: true }), state)).toEqual({
      kind: 'action',
      action: { type: 'scroll-help', delta: -1 },
    })
    expect(resolveWorkspaceInput('d', key({ ctrl: true }), state)).toEqual({
      kind: 'action',
      action: { type: 'scroll-help', delta: 10 },
    })
    expect(resolveWorkspaceInput('u', key({ ctrl: true }), state)).toEqual({
      kind: 'action',
      action: { type: 'scroll-help', delta: -10 },
    })
  })

  it('drops other keystrokes while the help overlay is up', () => {
    const state = { ...listState(), showHelp: true }
    expect(resolveWorkspaceInput('', key({ return: true }), state).kind).toBe('noop')
    expect(resolveWorkspaceInput('a', key(), state).kind).toBe('noop')
  })

  it('routes escape out of the add-repo prompt and lets the runtime own other keys', () => {
    expect(resolveWorkspaceInput('', key({ escape: true }), addRepoState())).toEqual({
      kind: 'action',
      action: { type: 'set-focus', focus: 'list' },
    })
    expect(resolveWorkspaceInput('', key({ return: true }), addRepoState()).kind).toBe('noop')
    expect(resolveWorkspaceInput('', key({ tab: true }), addRepoState()).kind).toBe('noop')
    expect(resolveWorkspaceInput('a', key(), addRepoState()).kind).toBe('noop')
  })

  describe('theme picker', () => {
    function pickerState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
      return {
        ...createWorkspaceState({ overview: emptyOverview, roots: ['~/code'] }),
        showThemePicker: true,
        ...overrides,
      }
    }

    it('opens the picker on T', () => {
      expect(resolveWorkspaceInput('T', key(), listState())).toEqual({
        kind: 'action',
        action: { type: 'toggle-theme-picker' },
      })
    })

    it('is modal: arrows move, printable filters, backspace edits', () => {
      expect(resolveWorkspaceInput('', key({ downArrow: true }), pickerState()).kind).toBe('action')
      expect(resolveWorkspaceInput('', key({ upArrow: true }), pickerState())).toMatchObject({
        action: { type: 'move-theme-picker', delta: -1 },
      })
      expect(resolveWorkspaceInput('g', key(), pickerState())).toEqual({
        kind: 'action',
        action: { type: 'append-theme-picker-filter', value: 'g' },
      })
      expect(resolveWorkspaceInput('', key({ backspace: true }), pickerState({ themePickerFilter: 'gr' }))).toEqual({
        kind: 'action',
        action: { type: 'backspace-theme-picker-filter' },
      })
    })

    it('Enter applies the cursored preset', () => {
      // Filtering to "gruvbox" puts it at index 0 (best match).
      const intent = resolveWorkspaceInput('', key({ return: true }), pickerState({ themePickerFilter: 'gruvbox' }))
      expect(intent).toEqual({ kind: 'apply-theme', preset: 'gruvbox' })
    })

    it('Esc clears a non-empty filter first, then closes', () => {
      expect(resolveWorkspaceInput('', key({ escape: true }), pickerState({ themePickerFilter: 'x' }))).toEqual({
        kind: 'action',
        action: { type: 'clear-theme-picker-filter' },
      })
      expect(resolveWorkspaceInput('', key({ escape: true }), pickerState())).toEqual({
        kind: 'action',
        action: { type: 'toggle-theme-picker' },
      })
    })
  })
})
