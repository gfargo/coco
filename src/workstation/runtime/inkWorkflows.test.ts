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

  // Regression: arrow keys (left/right) and other unbound keystrokes
  // arrive at the workflow lookup with `inputValue === ''`. Without
  // the empty-string guard, `find()` would match the first action
  // declared with `key: ''` (cherry-pick-commit) and pop a
  // confirmation prompt on every arrow press. Palette-only entries
  // (key: '') must stay reachable via the palette but ignore key
  // dispatch entirely.
  it('returns undefined for empty inputValue so palette-only actions never match a keystroke', () => {
    expect(getLogInkWorkflowActionByKey('')).toBeUndefined()
  })

  it('registers the reflog checkout action as palette-only (view-scoped dispatch is by id)', () => {
    expect(getLogInkWorkflowActionById('checkout-reflog-entry')).toMatchObject({
      key: '',
      kind: 'destructive',
      requiresConfirmation: true,
    })
  })

  // Regression for the global `c` leak: with a live key on this entry,
  // the end-of-dispatch fallback fired `git checkout <reflog hash>`
  // (detached HEAD, no confirmation) from any view that doesn't bind
  // `c` — branches, tags, stash, worktrees, remotes, bisect, blame.
  it('never resolves checkout-reflog-entry from a raw keystroke', () => {
    expect(getLogInkWorkflowActionByKey('c')).toBeUndefined()
  })

  it('declares every workflow action id at most once', () => {
    const ids = getLogInkWorkflowActions().map((a) => a.id)
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(dupes).toEqual([])
  })

  it('still finds palette-only actions by id (cherry-pick-commit, etc.)', () => {
    expect(getLogInkWorkflowActionById('cherry-pick-commit')?.key).toBe('')
    expect(getLogInkWorkflowActionById('checkout-file-from-commit')?.key).toBe('')
  })

  it('registers force-delete-branch as a keyless, confirmation-gated escalation', () => {
    // Raised by the runtime as a second confirm when `git branch -d`
    // rejects an unmerged branch; keyless so no keystroke fires it.
    const force = getLogInkWorkflowActionById('force-delete-branch')
    expect(force).toMatchObject({
      key: '',
      kind: 'destructive',
      requiresConfirmation: true,
    })
    expect(getLogInkWorkflowActionByKey('')).toBeUndefined()
  })

  it('registers rebase-onto-branch as a keyless, confirmation-gated destructive op (#0.71)', () => {
    // Per-view-only: the `r` keystroke is scoped to the branches surface
    // in inkInput, so the registry entry is keyless (palette-discoverable
    // without a global hotkey). Destructive — it rewrites history — so it
    // must require confirmation.
    const rebase = getLogInkWorkflowActionById('rebase-onto-branch')
    expect(rebase).toMatchObject({
      key: '',
      kind: 'destructive',
      requiresConfirmation: true,
    })
  })

  // Issue #777 — revert / reset / interactive-rebase wired through the
  // workflow registry as palette-only entries (key: ''). Real keystroke
  // dispatch is per-view scoped in inkInput.ts so they only fire on
  // history view.
  it('registers history-mutation workflows as destructive + palette-only', () => {
    const revert = getLogInkWorkflowActionById('revert-commit')
    expect(revert).toMatchObject({
      key: '',
      kind: 'destructive',
      requiresConfirmation: true,
    })

    const reset = getLogInkWorkflowActionById('reset-to-commit')
    expect(reset).toMatchObject({
      key: '',
      kind: 'destructive',
      requiresConfirmation: true,
    })

    const rebase = getLogInkWorkflowActionById('interactive-rebase')
    expect(rebase).toMatchObject({
      key: '',
      kind: 'destructive',
      requiresConfirmation: true,
    })
  })

  it('registers create-branch-here / create-tag-here as palette-only normal actions', () => {
    // GitKraken-style "create branch / tag from commit" — bound to `B`
    // and `gT` on the history view in inkInput. Palette-only `key: ''`
    // here keeps them discoverable without registering global hotkeys;
    // the prompt itself is the affirmative gate so requiresConfirmation
    // stays false (no extra y-confirm).
    const branchHere = getLogInkWorkflowActionById('create-branch-here')
    expect(branchHere).toMatchObject({
      key: '',
      kind: 'normal',
      requiresConfirmation: false,
    })

    const tagHere = getLogInkWorkflowActionById('create-tag-here')
    expect(tagHere).toMatchObject({
      key: '',
      kind: 'normal',
      requiresConfirmation: false,
    })
  })

  it('registers checkout-created-branch as keyless, non-confirming follow-up action (#1326)', () => {
    // Reached only via the in-runner setPendingConfirmation dispatch
    // (create-branch or create-branch-here → y-confirm → here). Must be
    // keyless so it cannot be triggered directly by a keystroke, and must
    // NOT itself require a second confirmation — it IS the confirmation target.
    const action = getLogInkWorkflowActionById('checkout-created-branch')
    expect(action).toMatchObject({
      key: '',
      kind: 'normal',
      requiresConfirmation: false,
    })
    expect(action?.label).toContain('created branch')
    // Keyless → never matches a raw keystroke.
    expect(getLogInkWorkflowActionByKey('')).toBeUndefined()
  })

  it('registers hunk-apply workflows as palette-only and non-destructive (#782)', () => {
    const worktree = getLogInkWorkflowActionById('apply-hunk-worktree')
    const index = getLogInkWorkflowActionById('apply-hunk-index')
    expect(worktree?.key).toBe('')
    expect(worktree?.kind).toBe('normal')
    expect(worktree?.requiresConfirmation).toBe(false)
    expect(index?.key).toBe('')
    expect(index?.kind).toBe('normal')
    expect(index?.requiresConfirmation).toBe(false)
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

describe('triage PR checkout workflow (#1363)', () => {
  it('registers triage-pr-checkout as keyless (view-scoped C dispatches by id) and confirmation-free', () => {
    // Non-destructive: gh refuses on a dirty worktree rather than
    // clobbering it, and switching back is one checkout — same
    // consent model as checkout-branch.
    expect(getLogInkWorkflowActionById('triage-pr-checkout')).toMatchObject({
      key: '',
      kind: 'normal',
      requiresConfirmation: false,
    })
  })

  it('never resolves triage-pr-checkout from a raw C keystroke (create-pr owns the registry key)', () => {
    expect(getLogInkWorkflowActionByKey('C')?.id).toBe('create-pr')
  })
})
