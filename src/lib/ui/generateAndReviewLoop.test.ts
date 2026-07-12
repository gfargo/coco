/**
 * Unit tests for the real `generateAndReviewLoop` implementation (#1583).
 * Every command test suite (commit, review, recap, changelog) mocks this
 * module entirely, so the loop's own control flow — in particular the
 * agent-returned-no-content exit path — had no test coverage until now.
 */
import { generateAndReviewLoop } from './generateAndReviewLoop'
import { CommandExitError, isCommandExitError } from '../utils/commandExit'
import { Logger } from '../utils/logger'

function createLogger(): Logger {
  return {
    log: jest.fn(),
    error: jest.fn(),
    verbose: jest.fn(),
    setConfig: jest.fn(),
    startTimer: jest.fn().mockReturnThis(),
    stopTimer: jest.fn().mockReturnThis(),
    startSpinner: jest.fn().mockReturnThis(),
    stopSpinner: jest.fn().mockReturnThis(),
  } as unknown as Logger
}

describe('generateAndReviewLoop', () => {
  it('exits with a non-zero code (not 0) when the agent returns empty content', async () => {
    const logger = createLogger()

    const promise = generateAndReviewLoop({
      label: 'test artifact',
      factory: async () => ['some change'],
      parser: async () => 'some context',
      noResult: async () => undefined,
      agent: async () => '',
      options: { interactive: false, logger },
    })

    await expect(promise).rejects.toBeInstanceOf(CommandExitError)
    await expect(promise).rejects.toMatchObject({ code: 1 })
  })

  it('surfaces the failure via logger.error (stderr) so it is visible even when quiet/non-interactive', async () => {
    const logger = createLogger()

    await generateAndReviewLoop({
      label: 'test artifact',
      factory: async () => ['some change'],
      parser: async () => 'some context',
      noResult: async () => undefined,
      agent: async () => '',
      options: { interactive: false, logger },
    }).catch((error) => {
      if (!isCommandExitError(error)) throw error
    })

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Agent failed to return content'))
  })

  it('treats a null-ish agent result the same as an empty string', async () => {
    const logger = createLogger()

    const promise = generateAndReviewLoop({
      label: 'test artifact',
      factory: async () => ['some change'],
      parser: async () => 'some context',
      noResult: async () => undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agent: async () => null as any,
      options: { interactive: false, logger },
    })

    await expect(promise).rejects.toMatchObject({ code: 1 })
  })

  it('resolves normally (no exit) when the agent returns real content, non-interactive', async () => {
    const logger = createLogger()

    const result = await generateAndReviewLoop({
      label: 'test artifact',
      factory: async () => ['some change'],
      parser: async () => 'some context',
      noResult: async () => undefined,
      agent: async () => 'generated content',
      options: { interactive: false, logger },
    })

    expect(result).toBe('generated content')
  })
})
