import { handler as commitHandler } from '../commit/handler'
import { createCommit } from '../../lib/simple-git/createCommit'
import {
  commitWorkflowTestInternals,
  runCommitDraftWorkflow,
  runCommitWorkflow,
} from './commitWorkflowActions'

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

  it('generates commit drafts without creating commits', async () => {
    mockedCommitHandler.mockImplementation(async () => {
      process.stdout.write('feat: draft message\n\nDraft body.\n')
    })

    await expect(runCommitDraftWorkflow()).resolves.toEqual({
      ok: true,
      message: 'feat: draft message',
      draft: 'feat: draft message\n\nDraft body.',
    })
    expect(mockedCreateCommit).not.toHaveBeenCalled()
  })

  it('passes no-verify into TUI commit workflows', async () => {
    mockedCommitHandler.mockImplementation(async () => {
      process.stdout.write('fix: skip hooks\n')
    })
    mockedCreateCommit.mockResolvedValue({} as Awaited<ReturnType<typeof createCommit>>)

    await expect(runCommitWorkflow({ action: 'commit', git, noVerify: true })).resolves.toEqual({
      ok: true,
      message: 'fix: skip hooks',
    })
    expect(mockedCommitHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        noVerify: true,
      }),
      expect.anything()
    )
    expect(mockedCreateCommit).toHaveBeenCalledWith(
      'fix: skip hooks',
      git,
      undefined,
      { noVerify: true }
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

  it('returns hook output as structured feedback details', async () => {
    mockedCommitHandler.mockImplementation(async () => {
      process.stdout.write('feat: generated message\n')
    })
    mockedCreateCommit.mockRejectedValue(new Error([
      'Pre-commit hook failed',
      'eslint failed',
      'src/file.ts:1:1 error',
    ].join('\n')))

    await expect(runCommitWorkflow({ action: 'commit', git })).resolves.toEqual({
      ok: false,
      message: 'Pre-commit hook failed',
      details: [
        'eslint failed',
        'src/file.ts:1:1 error',
      ],
    })
  })

  it('splits command-exit output into a status message and details', async () => {
    mockedCommitHandler.mockImplementation(async () => {
      process.stdout.write('Commitlint failed\nsubject may not be empty\nbody may not be empty\n')

      const { CommandExitError } = await import('../../lib/utils/commandExit')
      throw new CommandExitError(1)
    })

    await expect(runCommitWorkflow({ action: 'commit', git })).resolves.toEqual({
      ok: false,
      message: 'Commitlint failed',
      details: [
        'subject may not be empty',
        'body may not be empty',
      ],
    })
  })
})
