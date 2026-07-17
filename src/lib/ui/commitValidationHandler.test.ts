/**
 * Coverage for #1701 — "Edit manually" must actually open an editor even when
 * config.openInEditor is false/unset, otherwise editResult() is a silent
 * no-op and the user is trapped re-validating the same invalid message.
 */
jest.mock('./inquirerPrompts')
jest.mock('../utils/hasCommitlintConfig')
jest.mock('../utils/commitlintValidator')

import { selectPrompt, editorPrompt } from './inquirerPrompts'
import { hasCommitlintConfig } from '../utils/hasCommitlintConfig'
import { validateCommitMessage, ValidationResult } from '../utils/commitlintValidator'
import { handleValidationErrors, ValidationHandlerOptions } from './commitValidationHandler'
import { Logger } from '../utils/logger'

const selectPromptMock = selectPrompt as jest.MockedFunction<typeof selectPrompt>
const editorPromptMock = editorPrompt as jest.MockedFunction<typeof editorPrompt>
const hasCommitlintConfigMock = hasCommitlintConfig as jest.MockedFunction<typeof hasCommitlintConfig>
const validateCommitMessageMock = validateCommitMessage as jest.MockedFunction<typeof validateCommitMessage>

function makeLogger(): Logger {
  return {
    error: jest.fn(),
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger
}

function makeOptions(overrides: Partial<ValidationHandlerOptions> = {}): ValidationHandlerOptions {
  return {
    logger: makeLogger(),
    interactive: true,
    openInEditor: false,
    ...overrides,
  }
}

const invalidResult: ValidationResult = {
  valid: false,
  errors: ['subject may not be empty'],
  warnings: [],
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('handleValidationErrors', () => {
  it('opens the editor for "Edit manually" even when openInEditor is false', async () => {
    selectPromptMock.mockResolvedValue('edit')
    editorPromptMock.mockResolvedValue('fix: corrected message')
    hasCommitlintConfigMock.mockResolvedValue(true)
    validateCommitMessageMock.mockResolvedValue({ valid: true, errors: [], warnings: [] })

    const options = makeOptions({ openInEditor: false })
    const result = await handleValidationErrors('bad message', invalidResult, options)

    expect(editorPromptMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ message: 'fix: corrected message', action: 'edit' })
  })

  it('recurses back to the menu if the edited message is still invalid', async () => {
    selectPromptMock.mockResolvedValueOnce('edit').mockResolvedValueOnce('abort')
    editorPromptMock.mockResolvedValue('still bad')
    hasCommitlintConfigMock.mockResolvedValue(true)
    validateCommitMessageMock.mockResolvedValue({
      valid: false,
      errors: ['still invalid'],
      warnings: [],
    })

    const options = makeOptions()
    const result = await handleValidationErrors('bad message', invalidResult, options)

    expect(editorPromptMock).toHaveBeenCalledTimes(1)
    expect(selectPromptMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ message: 'still bad', action: 'abort' })
  })

  it('returns abort without prompting in non-interactive mode', async () => {
    const options = makeOptions({ interactive: false })
    const result = await handleValidationErrors('bad message', invalidResult, options)

    expect(selectPromptMock).not.toHaveBeenCalled()
    expect(editorPromptMock).not.toHaveBeenCalled()
    expect(result).toEqual({ message: 'bad message', action: 'abort' })
  })
})
