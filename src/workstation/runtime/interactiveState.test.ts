import { GitLogRow } from '../../git/logData'
import { createLogTuiState, getSelectedCommit } from './interactiveState'

const rows: GitLogRow[] = [
  {
    type: 'commit',
    graph: '*',
    shortHash: 'aaa1111',
    hash: 'aaa1111',
    parents: ['bbb2222'],
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
    parents: [],
    date: '2026-04-26',
    author: 'Dependabot',
    refs: [],
    message: 'chore: update dependency',
  },
]

describe('log interactive state', () => {
  it('builds state from commit rows, skipping graph-only rows', () => {
    const state = createLogTuiState(rows)

    expect(state.commits).toHaveLength(2)
    expect(state.filteredCommits).toEqual(state.commits)
    expect(state.selectedIndex).toBe(0)
    expect(state.filter).toBe('')
    expect(state.filterMode).toBe(false)
    expect(state.fullGraph).toBe(false)
    expect(state.showHelp).toBe(true)
  })

  it('selects the commit at the current index', () => {
    const state = createLogTuiState(rows)

    expect(getSelectedCommit(state)).toEqual(expect.objectContaining({
      shortHash: 'aaa1111',
    }))
  })

  it('returns undefined when there are no commits', () => {
    const state = createLogTuiState([])

    expect(getSelectedCommit(state)).toBeUndefined()
  })
})
