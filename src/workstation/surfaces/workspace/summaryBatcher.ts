import type { WorkspaceRepoSummary } from '../../../git/workspaceData'

/**
 * Coalesces per-repo summaries into a few state updates while a workspace
 * scan runs (#2210). Each repo's summary arrives as its git calls finish;
 * dispatching one reducer action per repo would re-render the whole list
 * hundreds of times for a big root. `push` queues a summary and arms one
 * flush timer; `flush` hands the queued batch over and `cancel` drops
 * whatever is still queued (the final full overview supersedes it).
 */
export function createSummaryBatcher(
  emit: (batch: WorkspaceRepoSummary[]) => void,
  options: {
    intervalMs?: number
    schedule?: (fn: () => void, ms: number) => unknown
    unschedule?: (handle: unknown) => void
  } = {}
): {
  push: (summary: WorkspaceRepoSummary) => void
  flush: () => void
  cancel: () => void
} {
  const intervalMs = options.intervalMs ?? 150
  const schedule = options.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const unschedule = options.unschedule ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout))
  let queue: WorkspaceRepoSummary[] = []
  let handle: unknown

  const flush = () => {
    if (handle !== undefined) {
      unschedule(handle)
      handle = undefined
    }
    if (queue.length === 0) return
    const batch = queue
    queue = []
    emit(batch)
  }

  return {
    push(summary) {
      queue.push(summary)
      if (handle === undefined) handle = schedule(flush, intervalMs)
    },
    flush,
    cancel() {
      if (handle !== undefined) {
        unschedule(handle)
        handle = undefined
      }
      queue = []
    },
  }
}
