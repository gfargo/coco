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

describe('resolveWorkspaceInput', () => {
  it('quits on q or escape (no filter active)', () => {
    expect(resolveWorkspaceInput('q', key(), listState()).kind).toBe('quit')
    expect(resolveWorkspaceInput('', key({ escape: true }), listState()).kind).toBe('quit')
  })

  it('clears the filter on escape when a filter is set', () => {
    expect(resolveWorkspaceInput('', key({ escape: true }), listState('foo'))).toEqual({
      kind: 'action',
      action: { type: 'clear-filter' },
    })
  })

  it('moves the cursor on j/k and arrow keys', () => {
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

  it('jumps to top with g and bottom with G', () => {
    expect(resolveWorkspaceInput('g', key(), listState())).toEqual({
      kind: 'action',
      action: { type: 'set-cursor', index: 0 },
    })
    expect(resolveWorkspaceInput('G', key(), listState())).toEqual({
      kind: 'action',
      action: { type: 'set-cursor', index: Number.MAX_SAFE_INTEGER },
    })
  })

  it('cycles tabs on tab / shift-tab / h / l', () => {
    expect(resolveWorkspaceInput('', key({ tab: true }), listState())).toEqual({
      kind: 'action',
      action: { type: 'cycle-tab', direction: 'next' },
    })
    expect(resolveWorkspaceInput('', key({ tab: true, shift: true }), listState())).toEqual({
      kind: 'action',
      action: { type: 'cycle-tab', direction: 'previous' },
    })
    expect(resolveWorkspaceInput('h', key(), listState()).kind).toBe('action')
    expect(resolveWorkspaceInput('l', key(), listState()).kind).toBe('action')
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

  it('routes ? to toggle-help while focused on the list', () => {
    expect(resolveWorkspaceInput('?', key(), listState())).toEqual({
      kind: 'action',
      action: { type: 'toggle-help' },
    })
  })

  it('drops every keystroke while the help overlay is up except esc/?/q', () => {
    const state = { ...listState(), showHelp: true }
    expect(resolveWorkspaceInput('j', key(), state).kind).toBe('noop')
    expect(resolveWorkspaceInput('', key({ return: true }), state).kind).toBe('noop')
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

  it('routes escape out of the add-repo prompt and lets the runtime own other keys', () => {
    expect(resolveWorkspaceInput('', key({ escape: true }), addRepoState())).toEqual({
      kind: 'action',
      action: { type: 'set-focus', focus: 'list' },
    })
    expect(resolveWorkspaceInput('', key({ return: true }), addRepoState()).kind).toBe('noop')
    expect(resolveWorkspaceInput('', key({ tab: true }), addRepoState()).kind).toBe('noop')
    expect(resolveWorkspaceInput('a', key(), addRepoState()).kind).toBe('noop')
  })
})
