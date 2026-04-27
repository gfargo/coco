import { GitLogRow } from './data'
import { applyLogTuiAction, createLogTuiState, getSelectedCommit } from './interactiveState'

const rows: GitLogRow[] = [
  {
    type: 'commit',
    graph: '*',
    shortHash: 'aaa1111',
    hash: 'aaa1111',
    date: '2026-04-27',
    author: 'Coco Test',
    refs: ['HEAD -> main'],
    message: 'feat: add graph ui',
  },
  {
    type: 'graph',
    graph: '|\\',
  },
  {
    type: 'commit',
    graph: '| *',
    shortHash: 'bbb2222',
    hash: 'bbb2222',
    date: '2026-04-26',
    author: 'Dependabot',
    refs: [],
    message: 'chore: update dependency',
  },
]

describe('log interactive state', () => {
  it('moves through commit rows without selecting graph-only rows', () => {
    let state = createLogTuiState(rows)

    state = applyLogTuiAction(state, { type: 'move', delta: 1 })

    expect(getSelectedCommit(state)).toEqual(expect.objectContaining({
      shortHash: 'bbb2222',
    }))

    state = applyLogTuiAction(state, { type: 'move', delta: 1 })

    expect(getSelectedCommit(state)).toEqual(expect.objectContaining({
      shortHash: 'bbb2222',
    }))
  })

  it('filters commits by message, author, hash, and refs', () => {
    let state = createLogTuiState(rows)

    state = applyLogTuiAction(state, { type: 'setFilter', value: 'dependency' })

    expect(state.filteredCommits).toHaveLength(1)
    expect(getSelectedCommit(state)).toEqual(expect.objectContaining({
      shortHash: 'bbb2222',
    }))

    state = applyLogTuiAction(state, { type: 'setFilter', value: 'HEAD' })

    expect(state.filteredCommits).toHaveLength(1)
    expect(getSelectedCommit(state)).toEqual(expect.objectContaining({
      shortHash: 'aaa1111',
    }))
  })

  it('updates filter text incrementally and supports graph/help toggles', () => {
    let state = createLogTuiState(rows)

    state = applyLogTuiAction(state, { type: 'toggleFilterMode' })
    state = applyLogTuiAction(state, { type: 'appendFilter', value: 'feat' })
    state = applyLogTuiAction(state, { type: 'backspaceFilter' })
    state = applyLogTuiAction(state, { type: 'toggleGraph' })
    state = applyLogTuiAction(state, { type: 'toggleHelp' })

    expect(state.filterMode).toBe(true)
    expect(state.filter).toBe('fea')
    expect(state.fullGraph).toBe(true)
    expect(state.showHelp).toBe(false)
  })
})
