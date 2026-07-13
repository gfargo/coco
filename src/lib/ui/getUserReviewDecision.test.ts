/**
 * Coverage for the review-decision choice list (#1642) — asserts which
 * options `getUserReviewDecision` composes under each `enable*` flag, since
 * `generateAndReviewLoop.ts` branches on exactly these value strings.
 */
jest.mock('./inquirerPrompts')

import { selectPrompt } from './inquirerPrompts'
import { getUserReviewDecision } from './getUserReviewDecision'

const selectPromptMock = selectPrompt as jest.MockedFunction<typeof selectPrompt>

type SelectPromptConfig = {
  message: string
  choices: Array<{ name: string; value: string; description: string }>
}

function lastConfig(callIndex = 0): SelectPromptConfig {
  return selectPromptMock.mock.calls[callIndex][0] as SelectPromptConfig
}

function choiceValues(): string[] {
  return lastConfig().choices.map((c) => c.value)
}

beforeEach(() => {
  jest.clearAllMocks()
  selectPromptMock.mockResolvedValue('approve')
})

describe('getUserReviewDecision', () => {
  it('always includes approve and cancel', async () => {
    await getUserReviewDecision({ label: 'commit message', enableEdit: false, enableRetry: false, enableFullRetry: false, enableModifyPrompt: false })
    expect(choiceValues()).toEqual(['approve', 'cancel'])
  })

  it('defaults every enable* flag to true when omitted', async () => {
    await getUserReviewDecision({ label: 'commit message' })
    expect(choiceValues()).toEqual(['approve', 'edit', 'modifyPrompt', 'retryMessageOnly', 'retryFull', 'cancel'])
  })

  it('adds edit only when enableEdit is true', async () => {
    await getUserReviewDecision({ label: 'x', enableEdit: true, enableRetry: false, enableFullRetry: false, enableModifyPrompt: false })
    expect(choiceValues()).toEqual(['approve', 'edit', 'cancel'])
  })

  it('adds modifyPrompt only when enableModifyPrompt is true', async () => {
    await getUserReviewDecision({ label: 'x', enableEdit: false, enableRetry: false, enableFullRetry: false, enableModifyPrompt: true })
    expect(choiceValues()).toEqual(['approve', 'modifyPrompt', 'cancel'])
  })

  it('adds retryMessageOnly only when enableRetry is true', async () => {
    await getUserReviewDecision({ label: 'x', enableEdit: false, enableRetry: true, enableFullRetry: false, enableModifyPrompt: false })
    expect(choiceValues()).toEqual(['approve', 'retryMessageOnly', 'cancel'])
  })

  it('adds retryFull only when enableFullRetry is true', async () => {
    await getUserReviewDecision({ label: 'x', enableEdit: false, enableRetry: false, enableFullRetry: true, enableModifyPrompt: false })
    expect(choiceValues()).toEqual(['approve', 'retryFull', 'cancel'])
  })

  it('falls back to default names/descriptions but honors overrides', async () => {
    await getUserReviewDecision({
      label: 'changelog',
      enableEdit: false,
      enableRetry: true,
      enableFullRetry: false,
      enableModifyPrompt: false,
      labels: { retryMessageOnly: '🔁 Redo' },
      descriptions: { approve: 'Ship it' },
    })
    const choices = lastConfig().choices
    expect(choices.find((c) => c.value === 'approve')?.description).toBe('Ship it')
    expect(choices.find((c) => c.value === 'retryMessageOnly')?.name).toBe('🔁 Redo')
  })

  it('uses selectLabel as the prompt message when provided, else a default mentioning the label', async () => {
    await getUserReviewDecision({ label: 'PR description', selectLabel: 'Custom prompt?' })
    expect(lastConfig(0).message).toBe('Custom prompt?')

    await getUserReviewDecision({ label: 'PR description' })
    expect(lastConfig(1).message).toContain('PR description')
  })

  it('returns whatever selectPrompt resolves to', async () => {
    selectPromptMock.mockResolvedValue('retryFull')
    await expect(getUserReviewDecision({ label: 'x' })).resolves.toBe('retryFull')
  })
})
