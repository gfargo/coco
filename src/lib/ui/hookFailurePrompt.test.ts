import { promptHookFailureRecovery } from './hookFailurePrompt'
import { selectPrompt } from './inquirerPrompts'
import { Logger } from '../utils/logger'

jest.mock('./inquirerPrompts')

const mockedSelectPrompt = selectPrompt as jest.MockedFunction<typeof selectPrompt>

describe('promptHookFailureRecovery', () => {
  afterEach(() => jest.clearAllMocks())

  it('logs the header and hook output, then returns the prompted choice when interactive', async () => {
    const logger = new Logger({ silent: true })
    const logSpy = jest.spyOn(logger, 'log')
    const errorSpy = jest.spyOn(logger, 'error')
    mockedSelectPrompt.mockResolvedValue('retry')

    const choice = await promptHookFailureRecovery({
      logger,
      header: '✖ Commit blocked by pre-commit hook',
      hookOutput: 'lint failed on file.ts',
      interactive: true,
    })

    expect(choice).toBe('retry')
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('✖ Commit blocked by pre-commit hook'),
      expect.anything()
    )
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes('lint failed on file.ts'))).toBe(
      true
    )
    expect(mockedSelectPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'How would you like to proceed?',
        choices: expect.arrayContaining([
          expect.objectContaining({ value: 'retry' }),
          expect.objectContaining({ value: 'skip' }),
          expect.objectContaining({ value: 'abort' }),
        ]),
      })
    )
  })

  it('does not prompt when non-interactive and defaults to abort', async () => {
    const logger = new Logger({ silent: true })
    const errorSpy = jest.spyOn(logger, 'error')

    const choice = await promptHookFailureRecovery({
      logger,
      header: '✖ Commit blocked by pre-commit hook',
      hookOutput: 'lint failed on file.ts',
      interactive: false,
    })

    expect(choice).toBe('abort')
    expect(mockedSelectPrompt).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Fix the issues above'),
      expect.anything()
    )
  })
})
