import { select } from '@inquirer/prompts'

export type ReviewDecision =
  | 'approve'
  | 'edit'
  | 'modifyPrompt'
  | 'retryMessageOnly'
  | 'retryFull'
  | 'cancel'

type GetUserReviewDecisionInput = {
  label: string
  descriptions?: Partial<Record<ReviewDecision, string>>
  labels?: Partial<Record<ReviewDecision, string>>
  enableEdit?: boolean
  enableRetry?: boolean
  enableFullRetry?: boolean
  enableModifyPrompt?: boolean
  selectLabel?: string
}

export async function getUserReviewDecision({
  label,
  descriptions,
  labels,
  enableEdit = true,
  enableRetry = true,
  enableFullRetry = true,
  enableModifyPrompt = true,
  selectLabel,
}: GetUserReviewDecisionInput): Promise<ReviewDecision> {
  const choices = [
    {
      name: labels?.approve || '✨ Looks good!',
      value: 'approve',
      description: descriptions?.approve || `Continue with the generated ${label}`,
    },
  ]

  if (enableEdit) {
    choices.push({
      name: '📝 Edit',
      value: 'edit',
      description: descriptions?.edit || `Edit the generated ${label} before proceeding`,
    })
  }

  if (enableModifyPrompt) {
    choices.push({
      name: '🪶  Modify Prompt',
      value: 'modifyPrompt',
      description:
        descriptions?.modifyPrompt || `Modify the prompt template and regenerate the ${label}`,
    })
  }

  if (enableRetry) {
    choices.push({
      name: labels?.retryMessageOnly || '🔄 Retry',
      value: 'retryMessageOnly',
      description:
        descriptions?.retryMessageOnly ||
        `Restart the function execution from generating the ${label}`,
    })
  }

  if (enableFullRetry) {
    choices.push({
      name: labels?.retryFull || '🔄 Retry Full',
      value: 'retryFull',
      description:
        descriptions?.retryFull ||
        `Restart the function execution from the beginning, regenerating both the summary and ${label}`,
    })
  }

  choices.push({
    name: labels?.cancel || '💣 Cancel',
    value: 'cancel',
    description: descriptions?.cancel || `Cancel the ${label}`,
  })

  return (await select({
    message: selectLabel || `Would you like to make any changes to the ${label}?`,
    choices,
  })) as ReviewDecision
}
