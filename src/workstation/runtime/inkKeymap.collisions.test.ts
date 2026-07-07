/**
 * Keymap collision guard.
 *
 * The workstation deliberately overloads single keys across views (see
 * `src/workstation/KEYMAP.md`). Those overloads live in the imperative
 * resolver (`inkInput.ts`) and are disambiguated by dispatch precedence —
 * this test can't see them.
 *
 * What it CAN guard is the declarative binding table (`LOG_INK_KEY_BINDINGS`),
 * the source for the `?` help overlay and the `:` palette. Two bindings that
 * claim the same key in the same context there is almost always an accident:
 * one of them will be unreachable or mislabeled. This test fails the build the
 * moment that happens, so a new binding can't silently shadow an existing one.
 *
 * If a collision is ever intentional (e.g. two ids that the resolver gates on
 * finer state than `contexts` can express), add it to ALLOWED_COLLISIONS with a
 * comment justifying why — that keeps the exception visible and reviewed.
 */
import { LOG_INK_KEY_BINDINGS } from './inkKeymap'
import { getLogInkWorkflowActions } from './inkWorkflows'

/**
 * Intentional, reviewed `(context::key)` collisions. Keep empty unless a
 * specific overload genuinely needs both ids in the same coarse context; each
 * entry must carry a justification comment.
 */
const ALLOWED_COLLISIONS = new Set<string>([])

describe('LOG_INK_KEY_BINDINGS collision guard', () => {
  it('never binds the same key to two ids in the same context', () => {
    const seen = new Map<string, string[]>()

    for (const binding of LOG_INK_KEY_BINDINGS) {
      for (const context of binding.contexts) {
        for (const key of binding.keys) {
          const slot = `${context}::${key}`
          const ids = seen.get(slot) ?? []
          ids.push(binding.id)
          seen.set(slot, ids)
        }
      }
    }

    const collisions = [...seen.entries()]
      .filter(([slot, ids]) => ids.length > 1 && !ALLOWED_COLLISIONS.has(slot))
      .map(([slot, ids]) => `${slot} → ${ids.join(', ')}`)

    expect(collisions).toEqual([])
  })

  it('every binding declares at least one key and one context', () => {
    // A binding with no key or no context can never fire and can never be
    // discovered — almost certainly a mistake during a refactor.
    const broken = LOG_INK_KEY_BINDINGS.filter(
      (b) => b.keys.length === 0 || b.contexts.length === 0
    ).map((b) => b.id)

    expect(broken).toEqual([])
  })

  it('every workflow handler id has a registry entry in inkWorkflows', () => {
    // #1447 — a handler id in useWorkflowAction.ts that has no
    // corresponding entry in getLogInkWorkflowActions() is invisible
    // to the palette, help overlay, and footer. This test fails when
    // someone adds a new handler without the matching registry row.
    const registeredIds = new Set(
      getLogInkWorkflowActions().map((a) => a.id)
    )

    // These are the known workflow handler ids dispatched via
    // `{ type: 'runWorkflowAction', id: '...' }` throughout the
    // codebase. Keep this list in sync with useWorkflowAction.ts.
    const handlerIds = [
      'create-branch',
      'create-tag',
      'checkout-branch',
      'delete-branch',
      'force-delete-branch',
      'rebase-onto-branch',
      'rename-branch',
      'set-upstream',
      'delete-tag',
      'delete-remote-tag',
      'push-tag',
      'drop-stash',
      'undo-drop-stash',
      'apply-stash',
      'apply-stash-index',
      'pop-stash',
      'rename-stash',
      'stash-branch',
      'create-stash',
      'stash-staged',
      'stash-keep-index',
      'fetch-remotes',
      'pull-current-branch',
      'push-current-branch',
      'fetch-selected-branch',
      'pull-selected-branch',
      'push-selected-branch',
      'force-push-current-branch',
      'force-push-selected-branch',
      'pull-rebase-current',
      'pull-merge-current',
      'open-pr',
      'create-pr',
      'merge-pr',
      'close-pr',
      'approve-pr',
      'request-changes-pr',
      'comment-pr',
      'add-to-gitignore',
      'stage-file',
      'stage-all',
      'stage-pathspec',
      'stage-all-unstaged',
      'unstage-all-staged',
      'stage-all-untracked',
      'remove-worktree',
      'remove-worktree-and-branch',
      'conflict-remove-worktree-checkout',
      'conflict-remove-worktree-branch',
      'stash-and-checkout-branch',
      'stash-and-checkout-pr',
      'abort-operation',
      'resolve-conflict-ours',
      'resolve-conflict-theirs',
      'resolve-conflict-stage',
      'resolve-conflict-open-diff',
      'continue-operation',
      'cherry-pick-commit',
      'revert-commit',
      'reset-to-commit',
      'fixup-into-commit',
      'autosquash-rebase',
      'interactive-rebase',
      'execute-rebase-plan',
      'create-branch-here',
      'checkout-created-branch',
      'create-tag-here',
      'checkout-file-from-commit',
      'checkout-file-from-stash',
      'apply-hunk-worktree',
      'apply-hunk-index',
      'checkout-reflog-entry',
      'amend-head',
      'reword-head',
      'bisect-good',
      'bisect-bad',
      'bisect-skip',
      'bisect-reset',
      'bisect-run',
      'bisect-start-from-history',
      'submodule-init',
      'submodule-update',
      'submodule-sync',
      'remote-add',
      'remote-set-url',
      'remote-remove',
      'remote-prune',
      'triage-issue-open',
      'triage-issue-comment',
      'triage-issue-label',
      'triage-issue-assign',
      'triage-issue-close',
      'triage-issue-reopen',
      'triage-pr-open',
      'triage-pr-comment',
      'triage-pr-label',
      'triage-pr-assign',
      'triage-pr-merge',
      'triage-pr-close',
      'triage-pr-approve',
      'triage-pr-request-changes',
      'triage-pr-checkout',
      'ai-commit-summary',
      'ai-conflict-help',
    ]

    const missing = handlerIds.filter((id) => !registeredIds.has(id))
    expect(missing).toEqual([])
  })

  it('every view-context binding key has a corresponding view in the binding table', () => {
    // #1447 — the footer-hint renderer and the `g?` which-key strip
    // pull from LOG_INK_KEY_BINDINGS filtered by the active view. A
    // view that dispatches keys imperatively but has zero declarative
    // entries will show a generic "normal" list to users — misleading.
    // This test asserts that every LogInkView with per-view keybindings
    // (i.e. every view that actually dispatches unique keys in
    // inkInput.ts) has at least one binding scoped to it.
    const viewsWithBindings = new Set<string>()
    for (const binding of LOG_INK_KEY_BINDINGS) {
      for (const ctx of binding.contexts) {
        viewsWithBindings.add(ctx)
      }
    }

    // Views that dispatch unique per-view keys in inkInput.ts and
    // therefore MUST have at least one binding scoped to them.
    const viewsRequiringBindings = [
      'history',
      'status',
      'diff',
      'compose',
      'branches',
      'tags',
      'stash',
      'worktrees',
      'conflicts',
      'reflog',
      'bisect',
      'remotes',
      'submodules',
      'pull-request-triage',
      'issues',
    ]

    const missing = viewsRequiringBindings.filter((v) => !viewsWithBindings.has(v))
    expect(missing).toEqual([])
  })

  it('kind "destructive" implies requiresConfirmation (danger policy #1448)', () => {
    // #1448 — the danger doctrine: every workflow marked destructive
    // must either require confirmation OR carry a documented waiver
    // explaining why confirmation is unnecessary (e.g. undo is cheap,
    // or the action is input-mediated so the prompt IS the confirm).
    //
    // Waivers live here, not in the registry, so adding one is a
    // reviewed, visible decision. Each entry must carry a justification.
    const DANGER_WAIVERS = new Set<string>([
      // apply-hunk-worktree / apply-hunk-index: `git apply -R` cleanly
      // undoes the patch. Undo is cheap; confirming every hunk-apply
      // would kill the drill-in-and-apply flow's speed.
      // (Currently kind: 'normal' so they don't hit this assertion,
      // but documented here for the doctrine record.)
    ])

    const actions = getLogInkWorkflowActions()
    const violations = actions
      .filter((a) => a.kind === 'destructive' && !a.requiresConfirmation && !DANGER_WAIVERS.has(a.id))
      .map((a) => a.id)

    expect(violations).toEqual([])
  })
})
