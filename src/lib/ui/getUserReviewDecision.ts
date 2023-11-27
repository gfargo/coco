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
  enableRetry?: boolean
  enableFullRetry?: boolean
  enableModifyPrompt?: boolean
}

export async function getUserReviewDecision({
  label,
  descriptions,
  enableRetry = true,
  enableFullRetry = true,
  enableModifyPrompt = true,
}: GetUserReviewDecisionInput): Promise<ReviewDecision> {
  const choices = [
    {
      name: '✨ Looks good!',
      value: 'approve',
      description: descriptions?.approve || `Continue with the generated ${label}`,
    },
    {
      name: '📝 Edit',
      value: 'edit',
      description: descriptions?.edit || `Edit the generated ${label} before proceeding`,
    },
  ]

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
      name: '🔄 Retry',
      value: 'retryMessageOnly',
      description:
        descriptions?.retryMessageOnly ||
        `Restart the function execution from generating the ${label}`,
    })
  }

  if (enableFullRetry) {
    choices.push({
      name: '🔄 Retry Full',
      value: 'retryFull',
      description:
        descriptions?.retryFull ||
        `Restart the function execution from the beginning, regenerating both the summary and ${label}`,
    })
  }

  choices.push({
    name: '💣 Cancel',
    value: 'cancel',
    description: descriptions?.cancel || `Cancel the ${label}`,
  })

  return (await select({
    message: `Would you like to make any changes to the ${label}?`,
    choices,
  })) as ReviewDecision
}
