import { createCommit, PreCommitHookError } from '../../lib/simple-git/createCommit'
import {
  applyCommitComposeAction,
  createCommitComposeState,
  createManualCommit,
  formatCommitComposeMessage,
  splitCommitDraft,
} from './commitCompose'

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

const mockedCreateCommit = createCommit as jest.MockedFunction<typeof createCommit>
const git = {} as Parameters<typeof createCommit>[1]

describe('log commit compose state', () => {
  beforeEach(() => {
    mockedCreateCommit.mockReset()
  })

  it('edits summary and body fields predictably', () => {
    let state = createCommitComposeState({ editing: true })

    state = applyCommitComposeAction(state, { type: 'append', value: 'feat' })
    expect(state.summary).toBe('feat')

    state = applyCommitComposeAction(state, { type: 'toggleField' })
    state = applyCommitComposeAction(state, { type: 'append', value: 'Body' })
    expect(state.body).toBe('Body')

    state = applyCommitComposeAction(state, { type: 'backspace' })
    expect(state.body).toBe('Bod')
  })

  it('splits AI drafts into editable summary and body fields', () => {
    expect(splitCommitDraft('feat: add ui\n\nBody line one\nBody line two')).toEqual({
      summary: 'feat: add ui',
      body: 'Body line one\nBody line two',
    })

    const state = applyCommitComposeAction(createCommitComposeState(), {
      type: 'setDraft',
      value: 'fix: generated draft\n\nDetails.',
    })

    expect(state.summary).toBe('fix: generated draft')
    expect(state.body).toBe('Details.')
    expect(state.editing).toBe(true)
  })

  it('formats and creates manual commits from staged drafts', async () => {
    mockedCreateCommit.mockResolvedValue({ commit: 'abc1234' } as Awaited<ReturnType<typeof createCommit>>)

    await expect(createManualCommit({
      git,
      summary: 'feat: add commit box',
      body: 'Adds manual compose support.',
    })).resolves.toEqual({
      ok: true,
      message: 'Created commit abc1234',
    })

    expect(formatCommitComposeMessage('feat: add commit box', 'Adds manual compose support.')).toBe(
      'feat: add commit box\n\nAdds manual compose support.'
    )
    expect(mockedCreateCommit).toHaveBeenCalledWith(
      'feat: add commit box\n\nAdds manual compose support.',
      git,
      undefined,
      { noVerify: false }
    )
  })

  it('returns hook failures as commit box feedback', async () => {
    mockedCreateCommit.mockRejectedValue(new PreCommitHookError([
      'eslint failed',
      'src/file.ts:1:1 error',
    ].join('\n')))

    await expect(createManualCommit({
      git,
      summary: 'fix: blocked',
    })).resolves.toEqual({
      ok: false,
      message: 'Commit blocked by hook: eslint failed',
      details: ['src/file.ts:1:1 error'],
    })
  })
})
