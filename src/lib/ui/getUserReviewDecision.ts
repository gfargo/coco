import { select } from '@inquirer/prompts'

export type ReviewDecision =
  | 'approve'
  | 'edit'
  | 'modifyPrompt'
  | 'retryMessageOnly'
  | 'retryFull'
  | 'cancel'

export async function getUserReviewDecision(): Promise<ReviewDecision> {
  return await select({
    message: 'Would you like to make any changes to the commit message?',
    choices: [
      {
        name: '✨ Looks good!',
        value: 'approve',
        description: 'Commit staged changes with generated commit message',
      },
      {
        name: '📝 Edit',
        value: 'edit',
        description: 'Edit the commit message before proceeding',
      },
      {
        name: '🪶  Modify Prompt',
        value: 'modifyPrompt',
        description: 'Modify the prompt template and regenerate the commit message',
      },
      {
        name: '🔄 Retry - Message Only',
        value: 'retryMessageOnly',
        description: 'Restart the function execution from generating the commit message',
      },
      {
        name: '🔄 Retry - Full',
        value: 'retryFull',
        description:
          'Restart the function execution from the beginning, regenerating both the diff summary and commit message',
      },
      {
        name: '💣 Cancel',
        value: 'cancel',
      },
    ],
  })
}
