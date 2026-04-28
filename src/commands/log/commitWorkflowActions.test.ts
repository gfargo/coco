import { handler as commitHandler } from '../commit/handler'
import { createCommit } from '../../lib/simple-git/createCommit'
import { commitWorkflowTestInternals, runCommitWorkflow } from './commitWorkflowActions'

jest.mock('../commit/handler', () => ({
  handler: jest.fn(),
}))

jest.mock('../../lib/simple-git/createCommit', () => ({
  createCommit: jest.fn(),
  PreCommitHookError: class PreCommitHookError extends Error {
    readonly hookOutput: string

    constructor(hookOutput: string) {
      super('Pre-commit hook failed')
      this.name = 'PreCommitHookError'
      this.hookOutput = hookOutput
    }
  },
}))

const mockedCommitHandler = commitHandler as jest.MockedFunction<typeof commitHandler>
const mockedCreateCommit = createCommit as jest.MockedFunction<typeof createCommit>
const git = {} as Parameters<typeof createCommit>[1]

describe('log commit workflow actions', () => {
  beforeEach(() => {
    mockedCommitHandler.mockReset()
    mockedCreateCommit.mockReset()
  })

  it('builds quiet stdout argv and commits generated messages', async () => {
    mockedCommitHandler.mockImplementation(async () => {
      process.stdout.write('feat: generated message\n\nGenerated body.\n')
    })
    mockedCreateCommit.mockResolvedValue({} as Awaited<ReturnType<typeof createCommit>>)

    const result = await runCommitWorkflow({ action: 'commit', git })

    expect(result).toEqual({
      ok: true,
      message: 'feat: generated message',
    })
    expect(mockedCreateCommit).toHaveBeenCalledWith(
      'feat: generated message\n\nGenerated body.',
      git,
      undefined,
      { noVerify: false }
    )
    expect(mockedCommitHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        _: ['commit'],
        interactive: false,
        mode: 'stdout',
        split: false,
        plan: false,
        apply: false,
      }),
      expect.objectContaining({
        setConfig: expect.any(Function),
      })
    )
  })

  it('builds split plan argv for commit split planning', async () => {
    mockedCommitHandler.mockImplementation(async () => {
      process.stdout.write('## 1. feat: split plan\n')
    })

    const result = await runCommitWorkflow({ action: 'split-plan', git })

    expect(result.message).toBe('## 1. feat: split plan')
    expect(mockedCreateCommit).not.toHaveBeenCalled()
    expect(mockedCommitHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        _: ['commit', 'split'],
        split: true,
        plan: true,
        apply: false,
      }),
      expect.anything()
    )
  })

  it('builds split apply argv for commit split application', async () => {
    mockedCommitHandler.mockImplementation(async () => {
      process.stdout.write('Created 2 split commit(s).\n')
    })

    const result = await runCommitWorkflow({ action: 'split-apply', git })

    expect(result.message).toBe('Created 2 split commit(s).')
    expect(mockedCreateCommit).not.toHaveBeenCalled()
    expect(mockedCommitHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        _: ['commit', 'split'],
        split: true,
        plan: false,
        apply: true,
      }),
      expect.anything()
    )
  })

  it('uses a friendly fallback when command output is empty', () => {
    expect(commitWorkflowTestInternals.formatCommitWorkflowMessage('commit', '')).toBe(
      'Generated commit message.'
    )
    expect(commitWorkflowTestInternals.formatCommitWorkflowMessage('split-plan', '')).toBe(
      'Generated commit split plan.'
    )
    expect(commitWorkflowTestInternals.formatCommitWorkflowMessage('split-apply', '')).toBe(
      'Applied commit split plan.'
    )
  })
})
