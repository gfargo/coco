import { promptHookFailureRecovery } from './hookFailurePrompt'
import { selectPrompt } from './inquirerPrompts'
import { Logger } from '../utils/logger'

jest.mock('./inquirerPrompts')

const mockedSelectPrompt = selectPrompt as jest.MockedFunction<typeof selectPrompt>

describe('promptHookFailureRecovery', () => {
  afterEach(() => jest.clearAllMocks())

  it('logs the header and hook output, then returns the prompted choice when interactive', async () => {
    const logger = new Logger({ silent: true })
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
    // error(), not log() (#1887) — see the dedicated quiet-mode test below
    // for why this distinction is the actual bug, not just an API choice.
    expect(errorSpy.mock.calls.some((call) => String(call[0]).includes('lint failed on file.ts'))).toBe(
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

  it('surfaces the actual hook output under quiet mode instead of only "fix the issues above" (#1887)', async () => {
    // The real bug: commit/handler.ts mutes the logger for every
    // non-interactive run (logger.setConfig({ quiet: true })). Spying on
    // the Logger method alone doesn't prove the content survived muting —
    // assert against the real process.stderr.write the way commit/handler
    // actually configures the logger, to lock in that this reaches the
    // user rather than just "the method was called".
    const logger = new Logger({ quiet: true })
    const writeSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      await promptHookFailureRecovery({
        logger,
        header: '✖ Commit blocked by pre-commit hook',
        hookOutput: 'lint failed on file.ts: unexpected console.log',
        interactive: false,
      })

      const written = writeSpy.mock.calls.map((call) => String(call[0])).join('')
      expect(written).toContain('lint failed on file.ts: unexpected console.log')
    } finally {
      writeSpy.mockRestore()
    }
  })
})
