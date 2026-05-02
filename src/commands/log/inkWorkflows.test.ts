import {
  getLogInkWorkflowActionById,
  getLogInkWorkflowActionByKey,
  getLogInkWorkflowActions,
  getLogInkWorkflowSections,
} from './inkWorkflows'

describe('log Ink workflows', () => {
  it('builds workflow sections from available repository context', () => {
    const sections = getLogInkWorkflowSections({
      branches: {
        currentBranch: 'main',
        dirty: true,
        localBranches: [],
        remoteBranches: [],
      },
      worktree: {
        stagedCount: 1,
        unstagedCount: 2,
        untrackedCount: 3,
        files: [],
      },
      selectedCommit: {
        type: 'commit',
        graph: '*',
        shortHash: 'abc1234',
        hash: 'abc123456789',
        parents: [],
        date: '2026-04-29',
        author: 'Coco Test',
        refs: [],
        message: 'feat: add workflows',
      },
    })

    expect(sections.map((section) => section.title)).toEqual([
      'Branch',
      'Provider / PR',
      'Status',
      'Tags / Stashes / Worktrees',
      'Operation / AI',
    ])
    expect(sections[0].lines).toContain('Current: main')
    expect(sections[2].lines).toContain('1 staged file')
    expect(sections[4].lines.join('\n')).toContain('abc1234')
  })

  it('marks destructive and AI actions as confirmation-gated', () => {
    const actions = getLogInkWorkflowActions()
    const destructive = actions.filter((action) => action.kind === 'destructive')
    const ai = actions.filter((action) => action.kind === 'ai')

    expect(destructive.length).toBeGreaterThan(0)
    expect(destructive.every((action) => action.requiresConfirmation)).toBe(true)
    expect(ai.every((action) => action.requiresConfirmation && action.estimatedTokens)).toBe(true)
    expect(getLogInkWorkflowActionByKey('D')?.id).toBe('delete-branch')
    expect(getLogInkWorkflowActionById('ai-commit-summary')?.key).toBe('I')
  })

  it('reports loading states while optional repository context hydrates', () => {
    const sections = getLogInkWorkflowSections({
      contextLoading: true,
    })
    const text = sections.flatMap((section) => section.lines).join('\n')

    expect(text).toContain('Branch data loading')
    expect(text).toContain('Provider and pull request data loading')
    expect(text).toContain('Status data loading')
    expect(text).toContain('Tags loading')
    expect(text).toContain('Operation data loading')
  })
})
