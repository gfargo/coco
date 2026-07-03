/**
 * In-TUI interactive rebase entry point (#1359).
 *
 * `startRebasePlan` resolves the cursored history commit, loads the todo
 * candidates for `<cursored>^..HEAD` (oldest first), and opens the rebase
 * surface with every row tagged `pick`. Execution goes through the
 * `execute-rebase-plan` workflow (y-confirmed) — this hook only builds
 * and opens the plan.
 *
 * Reads its inputs through a render-fresh ref (the `useWorkflowAction`
 * pattern) so the memoized callback always targets the commit under the
 * cursor at CALL time.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import { getRebasePlanRows } from '../../../git/rebasePlanActions'
import { LogInkAction, LogInkState, getSelectedInkCommit } from '../inkViewModel'

export type UseRebasePlanActionsDeps = {
  git: SimpleGit
  state: LogInkState
  dispatch: (action: LogInkAction) => void
}

export type UseRebasePlanActionsResult = {
  startRebasePlan: () => Promise<void>
}

export function useRebasePlanActions(
  React: typeof ReactTypes,
  deps: UseRebasePlanActionsDeps,
): UseRebasePlanActionsResult {
  const depsRef = React.useRef(deps)
  depsRef.current = deps

  const startRebasePlan = React.useCallback(async () => {
    const { git, state, dispatch } = depsRef.current
    const commit = getSelectedInkCommit(state)
    if (!commit) {
      dispatch({ type: 'setStatus', value: 'No commit selected', kind: 'warning' })
      return
    }

    const result = await getRebasePlanRows(git, commit.hash)
    if (!result.ok) {
      dispatch({ type: 'setStatus', value: result.message, kind: 'error' })
      return
    }
    dispatch({ type: 'openRebasePlan', rows: result.rows })
    dispatch({
      type: 'setStatus',
      value: `Rebase plan: ${result.rows.length} commit${result.rows.length === 1 ? '' : 's'} onto ${commit.shortHash}^ — p/s/f/d/e retag · r reword · J/K reorder · enter run`,
    })
  }, [])

  return { startRebasePlan }
}
