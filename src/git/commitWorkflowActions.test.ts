import { handler as commitHandler } from '../commands/commit/handler'
import { generateCommitDraft } from '../commands/commit/generateCommitDraft'
import { createCommit } from '../lib/simple-git/createCommit'
import {
  commitWorkflowTestInternals,
  runCommitDraftWorkflow,
} from './commitWorkflowActions'

jest.mock('../commands/commit/handler', () => ({
  handler: jest.fn(),
}))

jest.mock('../commands/commit/generateCommitDraft', () => ({
  generateCommitDraft: jest.fn(),
}))

jest.mock('../lib/simple-git/createCommit', () => ({
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
const mockedGenerateCommitDraft =
  generateCommitDraft as jest.MockedFunction<typeof generateCommitDraft>
const mockedCreateCommit = createCommit as jest.MockedFunction<typeof createCommit>
const git = {} as Parameters<typeof createCommit>[1]

describe('log commit workflow actions', () => {
  beforeEach(() => {
    mockedCommitHandler.mockReset()
    mockedGenerateCommitDraft.mockReset()
    mockedCreateCommit.mockReset()
  })

  it('generates commit drafts without creating commits or invoking the legacy handler', async () => {
    mockedGenerateCommitDraft.mockResolvedValue({
      ok: true,
      draft: 'feat: draft message\n\nDraft body.',
      warnings: [],
      validationErrors: [],
    })

    await expect(runCommitDraftWorkflow({ git })).resolves.toEqual({
      ok: true,
      message: 'feat: draft message',
      details: [],
      draft: 'feat: draft message\n\nDraft body.',
    })

    // Bug 2 (issue #757): the legacy commitHandler must not run inside the
    // TUI — it leaks ora spinners and Inquirer prompts onto the alt screen.
    expect(mockedCommitHandler).not.toHaveBeenCalled()
    expect(mockedCreateCommit).not.toHaveBeenCalled()
    expect(mockedGenerateCommitDraft).toHaveBeenCalledWith(expect.objectContaining({
      git,
      argv: expect.objectContaining({
        _: ['commit'],
        interactive: false,
        mode: 'stdout',
      }),
    }))
  })

  it('surfaces validation failures as structured workflow feedback', async () => {
    mockedGenerateCommitDraft.mockResolvedValue({
      ok: false,
      draft: 'foo: bad type',
      warnings: [],
      validationErrors: ['type must be one of [feat, fix, ...]', 'subject too long'],
    })

    await expect(runCommitDraftWorkflow({ git })).resolves.toEqual({
      ok: false,
      message: 'type must be one of [feat, fix, ...]',
      details: ['subject too long'],
      draft: 'foo: bad type',
    })
  })

  it('surfaces user-initiated cancellation as a neutral workflow result (#881 phase 3)', async () => {
    // The streaming attempt aborted; `generateCommitDraft` returned
    // `{ cancelled: true }`. The workflow must translate this into a
    // neutral result — `ok: false`, `cancelled: true`, no error
    // styling. Distinct from a validation failure so the runtime can
    // render "AI draft cancelled." instead of treating cancel like an
    // LLM error.
    mockedGenerateCommitDraft.mockResolvedValue({
      ok: false,
      draft: '',
      warnings: [],
      validationErrors: [],
      cancelled: true,
    })

    await expect(runCommitDraftWorkflow({ git })).resolves.toEqual({
      ok: false,
      message: 'AI draft cancelled.',
      details: [],
      draft: '',
      cancelled: true,
    })
  })

  it('forwards an AbortSignal into generateCommitDraft (#881 phase 3)', async () => {
    // The signal threading is what makes cancel actually work — the
    // runtime creates an AbortController, passes its signal, and the
    // generator forwards it into executeChainStreaming. Verify the
    // signal makes it across the workflow boundary.
    mockedGenerateCommitDraft.mockResolvedValue({
      ok: true,
      draft: 'feat: ok',
      warnings: [],
      validationErrors: [],
    })

    const controller = new AbortController()
    await runCommitDraftWorkflow({ git, signal: controller.signal })

    expect(mockedGenerateCommitDraft).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
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
