/**
 * Unit tests for the real `generateAndReviewLoop` implementation (#1583).
 * Every command test suite (commit, review, recap, changelog) mocks this
 * module entirely, so the loop's own control flow — in particular the
 * agent-returned-no-content exit path — had no test coverage until now.
 *
 * Extended (#1642) with table-driven coverage of the review-decision
 * branches (approve / edit / cancel / retryMessageOnly / retryFull /
 * modifyPrompt) and the REGENERATE_COMMIT_MESSAGE special-case, mocking
 * the review-decision prompt + editor prompt so each branch is reachable
 * without a real TTY. This locks in the exact surface the interactive-mode
 * fixes (#1470, #1508, #1510) kept touching.
 */
jest.mock('./getUserReviewDecision')
jest.mock('./inquirerPrompts')

import { generateAndReviewLoop, GenerateReviewLoopOptions } from './generateAndReviewLoop'
import { getUserReviewDecision, ReviewDecision } from './getUserReviewDecision'
import { editorPrompt } from './inquirerPrompts'
import { CommandExitError, isCommandExitError } from '../utils/commandExit'
import { Logger } from '../utils/logger'

const getUserReviewDecisionMock = getUserReviewDecision as jest.MockedFunction<typeof getUserReviewDecision>
const editorPromptMock = editorPrompt as jest.MockedFunction<typeof editorPrompt>

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

function baseOptions(overrides: Partial<GenerateReviewLoopOptions> = {}): GenerateReviewLoopOptions {
  return {
    interactive: true,
    logger: createLogger(),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

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

describe('generateAndReviewLoop — non-interactive extras', () => {
  it('applies reviewParser to shape the returned (non-interactive) result', async () => {
    const result = await generateAndReviewLoop({
      label: 'commit message',
      factory: async () => ({ file: 'x' }),
      parser: async () => 'diff context',
      noResult: jest.fn(),
      agent: async () => 'raw result',
      reviewParser: (r) => `parsed:${r}`,
      options: baseOptions({ interactive: false }),
    })

    expect(result).toBe('parsed:raw result')
    expect(getUserReviewDecisionMock).not.toHaveBeenCalled()
  })

  it('calls noResult when the factory yields no changes, but still proceeds through the loop', async () => {
    const noResult = jest.fn()
    const agent = jest.fn().mockResolvedValue('result')
    await generateAndReviewLoop({
      label: 'commit message',
      factory: async () => ({}),
      parser: async () => 'context',
      noResult,
      agent,
      options: baseOptions({ interactive: false }),
    })

    expect(noResult).toHaveBeenCalledWith(expect.objectContaining({ interactive: false }))
    expect(agent).toHaveBeenCalledTimes(1)
  })
})

describe('generateAndReviewLoop — interactive decisions', () => {
  it('approve: returns the (unedited) result in a single pass', async () => {
    getUserReviewDecisionMock.mockResolvedValue('approve')
    const agent = jest.fn().mockResolvedValue('generated message')
    const parser = jest.fn().mockResolvedValue('context')

    const result = await generateAndReviewLoop({
      label: 'commit message',
      factory: async () => ({ file: 'x' }),
      parser,
      noResult: jest.fn(),
      agent,
      options: baseOptions(),
    })

    expect(result).toBe('generated message')
    expect(agent).toHaveBeenCalledTimes(1)
    expect(parser).toHaveBeenCalledTimes(1)
    expect(editorPromptMock).not.toHaveBeenCalled()
  })

  it('edit: flips openInEditor and routes the result through editorPrompt', async () => {
    getUserReviewDecisionMock.mockResolvedValue('edit')
    editorPromptMock.mockResolvedValue('hand-edited message')
    const agent = jest.fn().mockResolvedValue('generated message')

    const options = baseOptions()
    const result = await generateAndReviewLoop({
      label: 'commit message',
      factory: async () => ({ file: 'x' }),
      parser: async () => 'context',
      noResult: jest.fn(),
      agent,
      options,
    })

    expect(options.openInEditor).toBe(true)
    expect(editorPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({ default: 'generated message' })
    )
    expect(result).toBe('hand-edited message')
  })

  it('cancel: exits via CommandExitError(0) without returning a result', async () => {
    getUserReviewDecisionMock.mockResolvedValue('cancel')
    const agent = jest.fn().mockResolvedValue('generated message')

    const promise = generateAndReviewLoop({
      label: 'commit message',
      factory: async () => ({ file: 'x' }),
      parser: async () => 'context',
      noResult: jest.fn(),
      agent,
      options: baseOptions(),
    })

    await expect(promise).rejects.toBeInstanceOf(CommandExitError)
    await expect(promise).rejects.toMatchObject({ code: 0 })
  })

  it('retryFull: clears context + prompt and regenerates from parser again', async () => {
    const decisions: ReviewDecision[] = ['retryFull', 'approve']
    getUserReviewDecisionMock.mockImplementation(async () => decisions.shift()!)
    const parser = jest.fn().mockResolvedValueOnce('context v1').mockResolvedValueOnce('context v2')
    const agent = jest.fn().mockResolvedValueOnce('draft 1').mockResolvedValueOnce('draft 2')

    const options = baseOptions({ prompt: 'original prompt' })
    const result = await generateAndReviewLoop({
      label: 'commit message',
      factory: async () => ({ file: 'x' }),
      parser,
      noResult: jest.fn(),
      agent,
      options,
    })

    expect(parser).toHaveBeenCalledTimes(2)
    expect(agent).toHaveBeenCalledTimes(2)
    expect(agent).toHaveBeenNthCalledWith(2, 'context v2', expect.anything())
    expect(result).toBe('draft 2')
  })

  it('retryMessageOnly: keeps the existing context, regenerates only via agent', async () => {
    const decisions: ReviewDecision[] = ['retryMessageOnly', 'approve']
    getUserReviewDecisionMock.mockImplementation(async () => decisions.shift()!)
    const parser = jest.fn().mockResolvedValue('stable context')
    const agent = jest.fn().mockResolvedValueOnce('draft 1').mockResolvedValueOnce('draft 2')

    const result = await generateAndReviewLoop({
      label: 'commit message',
      factory: async () => ({ file: 'x' }),
      parser,
      noResult: jest.fn(),
      agent,
      options: baseOptions(),
    })

    // context is never cleared on retryMessageOnly, so the parser (which
    // only re-runs when context is empty) fires once, not twice.
    expect(parser).toHaveBeenCalledTimes(1)
    expect(agent).toHaveBeenCalledTimes(2)
    expect(agent).toHaveBeenNthCalledWith(1, 'stable context', expect.anything())
    expect(agent).toHaveBeenNthCalledWith(2, 'stable context', expect.anything())
    expect(result).toBe('draft 2')
  })

  it('modifyPrompt: re-prompts for a new prompt template before the next agent call', async () => {
    const decisions: ReviewDecision[] = ['modifyPrompt', 'approve']
    getUserReviewDecisionMock.mockImplementation(async () => decisions.shift()!)
    editorPromptMock.mockResolvedValue('new prompt template')
    const agent = jest.fn().mockResolvedValueOnce('draft 1').mockResolvedValueOnce('draft 2')

    const options = baseOptions({ prompt: 'original prompt' })
    const result = await generateAndReviewLoop({
      label: 'commit message',
      factory: async () => ({ file: 'x' }),
      parser: async () => 'context',
      noResult: jest.fn(),
      agent,
      options,
    })

    expect(editorPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Edit the prompt' })
    )
    expect(options.prompt).toBe('new prompt template')
    expect(agent).toHaveBeenCalledTimes(2)
    expect(result).toBe('draft 2')
  })
})

describe('generateAndReviewLoop — agent error paths', () => {
  it('REGENERATE_COMMIT_MESSAGE: swallows the error and regenerates without consulting the reviewer', async () => {
    const agent = jest.fn()
      .mockRejectedValueOnce(new Error('REGENERATE_COMMIT_MESSAGE'))
      .mockResolvedValueOnce('final result')

    const result = await generateAndReviewLoop({
      label: 'commit message',
      factory: async () => ({ file: 'x' }),
      parser: async () => 'context',
      noResult: jest.fn(),
      agent,
      options: baseOptions({ interactive: false }),
    })

    expect(agent).toHaveBeenCalledTimes(2)
    expect(result).toBe('final result')
    expect(getUserReviewDecisionMock).not.toHaveBeenCalled()
  })

  it('propagates any other agent error', async () => {
    const agent = jest.fn().mockRejectedValue(new Error('boom'))

    await expect(
      generateAndReviewLoop({
        label: 'commit message',
        factory: async () => ({ file: 'x' }),
        parser: async () => 'context',
        noResult: jest.fn(),
        agent,
        options: baseOptions({ interactive: false }),
      })
    ).rejects.toThrow('boom')
  })
})
