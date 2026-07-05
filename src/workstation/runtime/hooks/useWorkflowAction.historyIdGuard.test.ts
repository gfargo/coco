import fs from 'fs'
import path from 'path'
import { getLogInkWorkflowActions } from '../inkWorkflows'
import { HISTORY_MUTATING_WORKFLOW_IDS, HISTORY_REWRITE_WORKFLOW_IDS } from './useWorkflowAction'

/**
 * Regression guard for #1428: `HISTORY_REWRITE_WORKFLOW_IDS` and
 * `HISTORY_MUTATING_WORKFLOW_IDS` are Sets of workflow ids maintained by
 * hand, separate from the actual dispatch table (`handlers` in
 * useWorkflowAction.ts) and the command-palette registry
 * (`getLogInkWorkflowActions`). A prior edit swapped in four ids
 * (`reset-hard-to-commit`, `reset-soft-to-commit`, `reset-mixed-to-commit`,
 * `interactive-rebase-to-commit`) that never existed anywhere, silently
 * disabling the reflog-recovery hint and the history-pane refresh for
 * every reset/rebase workflow. Nothing failed loudly because a dead id in
 * a Set is just a permanent no-op `.has()` miss.
 *
 * This test parses the real `handlers` object out of useWorkflowAction.ts
 * (its keys are the actual dispatchable ids — the object itself is never
 * invoked, just read as text) and unions it with the workflow registry, so
 * every id in the two tracking sets is checked against where dispatch
 * really happens.
 */
function readDispatchableHandlerIds(): Set<string> {
  const source = fs.readFileSync(path.join(__dirname, 'useWorkflowAction.ts'), 'utf8')
  const start = source.indexOf('const handlers: Record<string')
  const end = source.indexOf('const handler = handlers[id]')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('useWorkflowAction.ts: could not locate the `handlers` dispatch table — has it moved or been renamed?')
  }
  const handlersBlock = source.slice(start, end)
  const ids = Array.from(handlersBlock.matchAll(/^ {6}'([a-zA-Z0-9-]+)':/gm)).map((match) => match[1])
  return new Set(ids)
}

describe('history-tracking workflow id sets stay wired (#1428 guard)', () => {
  const handlerIds = readDispatchableHandlerIds()
  const registryIds = new Set(getLogInkWorkflowActions().map((action) => action.id))
  const dispatchableIds = new Set([...handlerIds, ...registryIds])

  it('parsed a non-trivial handler id list from useWorkflowAction.ts', () => {
    expect(handlerIds.size).toBeGreaterThan(50)
  })

  it.each([...HISTORY_REWRITE_WORKFLOW_IDS])(
    'HISTORY_REWRITE_WORKFLOW_IDS: %s dispatches somewhere real',
    (id) => {
      expect(dispatchableIds.has(id)).toBe(true)
    }
  )

  it.each([...HISTORY_MUTATING_WORKFLOW_IDS])(
    'HISTORY_MUTATING_WORKFLOW_IDS: %s dispatches somewhere real',
    (id) => {
      expect(dispatchableIds.has(id)).toBe(true)
    }
  )
})
