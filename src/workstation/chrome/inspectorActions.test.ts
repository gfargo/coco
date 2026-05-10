import {
  InspectorActionContext,
  getInspectorActions,
} from './inspectorActions'

describe('inspector actions', () => {
  describe('history-commit', () => {
    const actions = getInspectorActions('history-commit')

    it('exposes the per-commit action set', () => {
      const keys = actions.map((action) => action.key)
      expect(keys).toEqual(
        expect.arrayContaining(['enter', 'c', 'R', 'Z', 'i', 'y', 'Y', 'O'])
      )
    })

    it('marks revert / reset / interactive-rebase as destructive', () => {
      const destructive = actions
        .filter((action) => action.destructive)
        .map((action) => action.key)
      expect(destructive).toEqual(expect.arrayContaining(['R', 'Z', 'i']))
    })

    it('does not mark cherry-pick or yank as destructive', () => {
      const cherryPick = actions.find((action) => action.key === 'c')
      const yank = actions.find((action) => action.key === 'y')
      expect(cherryPick?.destructive).toBeFalsy()
      expect(yank?.destructive).toBeFalsy()
    })

    it('places open-diff first so the primary action is at the top', () => {
      expect(actions[0]).toMatchObject({ key: 'enter', label: expect.stringMatching(/diff/i) })
    })
  })

  describe('branch', () => {
    const actions = getInspectorActions('branch')

    it('exposes the per-branch action set', () => {
      const keys = actions.map((action) => action.key)
      expect(keys).toEqual(
        expect.arrayContaining(['enter', '+', 'R', 'u', 'D', 'P', 'F', 'y'])
      )
    })

    it('marks delete as destructive', () => {
      const destructive = actions
        .filter((action) => action.destructive)
        .map((action) => action.key)
      expect(destructive).toEqual(['D'])
    })
  })

  describe('tag', () => {
    const actions = getInspectorActions('tag')

    it('exposes the per-tag action set', () => {
      const keys = actions.map((action) => action.key)
      expect(keys).toEqual(expect.arrayContaining(['+', 'P', 'T', 'R', 'y']))
    })

    it('marks delete (T) and delete-remote (R) as destructive', () => {
      const destructive = actions
        .filter((action) => action.destructive)
        .map((action) => action.key)
      expect(destructive).toEqual(expect.arrayContaining(['T', 'R']))
      expect(destructive).not.toContain('+')
      expect(destructive).not.toContain('P')
    })
  })

  describe('stash', () => {
    const actions = getInspectorActions('stash')

    it('exposes the per-stash action set', () => {
      const keys = actions.map((action) => action.key)
      expect(keys).toEqual(expect.arrayContaining(['enter', 'a', 'p', 'X', 'y']))
    })

    it('marks drop (X) as destructive but apply / pop as non-destructive', () => {
      const destructive = actions
        .filter((action) => action.destructive)
        .map((action) => action.key)
      expect(destructive).toEqual(['X'])
    })
  })

  describe('worktree', () => {
    const actions = getInspectorActions('worktree')

    it('exposes the per-worktree action set', () => {
      const keys = actions.map((action) => action.key)
      expect(keys).toEqual(expect.arrayContaining(['W', 'y']))
    })

    it('marks remove (W) as destructive', () => {
      const destructive = actions
        .filter((action) => action.destructive)
        .map((action) => action.key)
      expect(destructive).toEqual(['W'])
    })
  })

  it('every action has a non-empty key and label', () => {
    const contexts: InspectorActionContext[] = [
      'history-commit',
      'branch',
      'tag',
      'stash',
      'worktree',
    ]
    for (const context of contexts) {
      for (const action of getInspectorActions(context)) {
        expect(action.key.length).toBeGreaterThan(0)
        expect(action.label.length).toBeGreaterThan(0)
      }
    }
  })
})
