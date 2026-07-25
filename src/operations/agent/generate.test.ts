/**
 * Unit tests for generateAgentCommitDraft (OSS-1326 / #1854).
 *
 * Covers the retryable flag behavior: validation failures must be marked
 * retryable: true because they are self-inflicted and a fresh sampling
 * attempt would likely succeed.
 */

import type { SimpleGit } from 'simple-git'
import { generateAgentCommitDraft } from './generate'
import { AgentOperationError } from './errors'
import type { AgentOperationContext } from './context'
import type { AgentTaskInput } from './schemas'
import { AGENT_PROTOCOL_VERSION } from './schemas'

jest.mock('../../commands/commit/generateCommitDraft')
jest.mock('./context')

// Pull in the mocked function so we can control its return value
import { generateCommitDraft } from '../../commands/commit/generateCommitDraft'
import { resolveChangeSource } from './context'

const mockGenerateCommitDraft = generateCommitDraft as jest.MockedFunction<
  typeof generateCommitDraft
>
const mockResolveChangeSource = resolveChangeSource as jest.MockedFunction<
  typeof resolveChangeSource
>

function makeContext(): AgentOperationContext {
  return {
    git: {} as SimpleGit,
    repoRoot: '/repo',
    signal: undefined,
    surface: 'agent-cli',
    logger: {
      log: jest.fn(),
      verbose: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      setConfig: jest.fn(),
    } as unknown as AgentOperationContext['logger'],
  }
}

function makeInput(): AgentTaskInput {
  return {
    version: AGENT_PROTOCOL_VERSION,
    source: { kind: 'repository', scope: { type: 'staged' } },
    options: {
      conventional: true,
      trustRepositoryConfig: false,
      previousCommitCount: 0,
      includeBranchName: false,
      author: false,
    },
  }
}

describe('generateAgentCommitDraft — retryable flag (OSS-1326 / #1854)', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    mockResolveChangeSource.mockResolvedValue({
      text: 'some diff context',
      meta: {
        kind: 'repository',
        digest: 'abc123',
        verification: 'repository-derived',
      },
    })
  })

  it('throws AgentOperationError with retryable:true when validation errors are present', async () => {
    mockGenerateCommitDraft.mockResolvedValue({
      ok: false,
      draft: 'chore: Update deps\n\nsome body',
      message: { title: 'chore: Update deps', body: 'some body', formatted: 'chore: Update deps\n\nsome body' },
      warnings: [],
      validationErrors: ["body's lines must not be longer than 100 characters"],
    })

    let caughtErr: unknown
    try {
      await generateAgentCommitDraft(makeInput(), makeContext())
    } catch (err) {
      caughtErr = err
    }
    expect(caughtErr).toBeInstanceOf(AgentOperationError)
    const agentErr = caughtErr as AgentOperationError
    expect(agentErr.code).toBe('GENERATION_FAILED')
    expect(agentErr.retryable).toBe(true)
  })

  it('throws AgentOperationError with retryable:false when failure has no validation errors', async () => {
    mockGenerateCommitDraft.mockResolvedValue({
      ok: false,
      draft: '',
      warnings: ['No staged changes detected.'],
      validationErrors: [],
    })

    let caughtErr: unknown
    try {
      await generateAgentCommitDraft(makeInput(), makeContext())
    } catch (err) {
      caughtErr = err
    }
    expect(caughtErr).toBeInstanceOf(AgentOperationError)
    const agentErr = caughtErr as AgentOperationError
    expect(agentErr.code).toBe('GENERATION_FAILED')
    expect(agentErr.retryable).toBe(false)
  })

  it('returns a success envelope when generation succeeds', async () => {
    mockGenerateCommitDraft.mockResolvedValue({
      ok: true,
      draft: 'fix: handle edge case\n\nDetails here.',
      message: {
        title: 'fix: handle edge case',
        body: 'Details here.',
        formatted: 'fix: handle edge case\n\nDetails here.',
      },
      warnings: [],
      validationErrors: [],
    })

    const result = await generateAgentCommitDraft(makeInput(), makeContext())
    expect(result.ok).toBe(true)
    expect(result.operation).toBe('commit-draft')
    expect(result.data.title).toBe('fix: handle edge case')
  })
})
