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

  describe('streamingPreview (#881 phase 2)', () => {
    it('starts undefined and only persists when a setStreamingPreview action fires', () => {
      const state = createCommitComposeState()
      expect(state.streamingPreview).toBeUndefined()

      const withPreview = applyCommitComposeAction(state, {
        type: 'setStreamingPreview',
        value: 'partial commit message...',
      })
      expect(withPreview.streamingPreview).toBe('partial commit message...')
    })

    it('passes undefined through setStreamingPreview to explicitly clear the preview', () => {
      // The streaming workflow dispatches `setStreamingPreview: undefined`
      // on cancel / abort paths. Explicit clear is distinct from "not yet
      // set" semantically — both render the same way but the workflow
      // needs the explicit reset.
      const seeded = applyCommitComposeAction(createCommitComposeState(), {
        type: 'setStreamingPreview',
        value: 'in progress',
      })
      const cleared = applyCommitComposeAction(seeded, {
        type: 'setStreamingPreview',
        value: undefined,
      })
      expect(cleared.streamingPreview).toBeUndefined()
    })

    it('clears the preview when loading flips off via setLoading(false)', () => {
      // Loading and the preview are tightly coupled: a preview without a
      // loader running would render as stale fragments below an idle
      // compose panel. The reducer enforces the coupling so callers
      // don't need an extra clear dispatch on every code path that
      // transitions out of loading.
      const loading = applyCommitComposeAction(createCommitComposeState(), {
        type: 'setLoading',
        value: true,
      })
      const withPreview = applyCommitComposeAction(loading, {
        type: 'setStreamingPreview',
        value: 'streamed text',
      })
      expect(withPreview.streamingPreview).toBe('streamed text')

      const done = applyCommitComposeAction(withPreview, { type: 'setLoading', value: false })
      expect(done.loading).toBe(false)
      expect(done.streamingPreview).toBeUndefined()
    })

    it('preserves the preview when setLoading(true) is dispatched mid-stream', () => {
      // Defensive: if the workflow re-dispatches setLoading(true) for any
      // reason during a stream, we shouldn't lose the preview content
      // that's already accumulated.
      const seeded = applyCommitComposeAction(
        applyCommitComposeAction(createCommitComposeState(), { type: 'setLoading', value: true }),
        { type: 'setStreamingPreview', value: 'mid-stream' }
      )
      const reasserted = applyCommitComposeAction(seeded, { type: 'setLoading', value: true })
      expect(reasserted.streamingPreview).toBe('mid-stream')
    })

    it('clears the preview when setDraft lands the final validated draft', () => {
      // The final draft replacing the preview is the success-path
      // confirmation — the loader vanishes and the editable fields fill
      // in. Lingering preview text below an already-populated body would
      // be confusing.
      const seeded = applyCommitComposeAction(createCommitComposeState(), {
        type: 'setStreamingPreview',
        value: '{ "title": "feat: ',
      })
      const final = applyCommitComposeAction(seeded, {
        type: 'setDraft',
        value: 'feat: add streaming preview\n\nLands the live preview below the loader.',
      })
      expect(final.summary).toBe('feat: add streaming preview')
      expect(final.streamingPreview).toBeUndefined()
    })

    it('clears the preview when setResult lands a failure', () => {
      // Failure path: the AI draft errored out, the loader hides, the
      // message line surfaces the error. The half-streamed preview must
      // go too — leaving it would suggest content is still incoming.
      const seeded = applyCommitComposeAction(createCommitComposeState(), {
        type: 'setStreamingPreview',
        value: 'partial output before failure',
      })
      const failed = applyCommitComposeAction(seeded, {
        type: 'setResult',
        message: 'AI draft failed: no API key configured',
      })
      expect(failed.message).toMatch(/no API key/)
      expect(failed.streamingPreview).toBeUndefined()
    })

    it('clears the preview when reset is dispatched (post-commit teardown)', () => {
      const seeded = applyCommitComposeAction(createCommitComposeState(), {
        type: 'setStreamingPreview',
        value: 'lingering preview',
      })
      const reset = applyCommitComposeAction(seeded, { type: 'reset' })
      expect(reset.streamingPreview).toBeUndefined()
    })
  })
})
