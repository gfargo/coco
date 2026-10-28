import type { LogInkState } from './inkViewModel'

/**
 * The central y/n gate for `runWorkflowAction` events (#1445). A workflow
 * that `requiresConfirmation` is held behind the confirmation overlay
 * unless consent is already on record. Consent is recorded when:
 *   (a) the event carries `confirmed: true`;
 *   (b) the confirmation overlay for THIS workflow is open (its `y` press
 *       emitted the event); or
 *   (c) the event is the pick of an option in the choice prompt that is
 *       open (#1867): consent is per option, so only a workflow the open
 *       prompt actually offered counts. The old clause treated any open
 *       choice as blanket consent for every workflow id, so an event for
 *       an unrelated destructive workflow emitted while a recovery prompt
 *       was on screen would have run without a y/n.
 */
export function needsConfirmation(
  workflow: { requiresConfirmation?: boolean } | undefined,
  event: { id: string; confirmed?: boolean },
  state: Pick<LogInkState, 'pendingConfirmationId' | 'pendingChoice'>
): boolean {
  if (!workflow?.requiresConfirmation) return false
  const offeredByOpenChoice = Boolean(
    state.pendingChoice?.options.some((option) => option.workflowId === event.id)
  )
  const alreadyConfirmed =
    Boolean(event.confirmed) ||
    state.pendingConfirmationId === event.id ||
    offeredByOpenChoice
  return !alreadyConfirmed
}
