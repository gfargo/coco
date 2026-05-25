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

    it('clears the preview when setEditing(false) fires AND no draft is in flight (audit #12)', () => {
      // Defensive: the current input pipeline never lands setEditing
      // off while a stream is still pumping (loading=true blocks the
      // user from toggling), but the reducer is the source of truth.
      const seeded = applyCommitComposeAction(createCommitComposeState({ editing: true }), {
        type: 'setStreamingPreview',
        value: 'orphan preview',
      })
      const cleared = applyCommitComposeAction(seeded, { type: 'setEditing', value: false })
      expect(cleared.streamingPreview).toBeUndefined()
    })

    it('preserves the preview when setEditing(false) fires while loading is still true', () => {
      // The opposite invariant: streaming workflow drives loading and
      // preview together. If editing somehow toggles off mid-stream,
      // the preview should survive because the loader is still showing.
      const loading = applyCommitComposeAction(createCommitComposeState({ editing: true }), {
        type: 'setLoading',
        value: true,
      })
      const seeded = applyCommitComposeAction(loading, {
        type: 'setStreamingPreview',
        value: 'mid-stream',
      })
      const cleared = applyCommitComposeAction(seeded, { type: 'setEditing', value: false })
      expect(cleared.streamingPreview).toBe('mid-stream')
    })
  })

  describe('pendingAiDraft confirmation (audit finding #7)', () => {
    it('routes setDraft to pendingAiDraft when summary or body has user content', () => {
      // Before the fix: a user mid-typing who fired the AI draft would
      // have their work silently clobbered when the draft landed. Now
      // the draft is staged in `pendingAiDraft` and a confirmation
      // message appears.
      let state = applyCommitComposeAction(createCommitComposeState(), {
        type: 'append',
        value: 'my partial title',
      })
      expect(state.summary).toBe('my partial title')

      state = applyCommitComposeAction(state, {
        type: 'setDraft',
        value: 'feat: AI version\n\nAI generated body',
      })
      // User's typing is preserved.
      expect(state.summary).toBe('my partial title')
      expect(state.body).toBe('')
      // AI draft is staged.
      expect(state.pendingAiDraft).toBe('feat: AI version\n\nAI generated body')
      // Confirmation message surfaces.
      expect(state.message).toMatch(/Press R to replace/)
    })

    it('routes setDraft to summary/body directly when fields are empty (no clobber risk)', () => {
      // Common path: user fires `I` without typing first; AI draft
      // lands straight into the editable fields as before.
      const state = applyCommitComposeAction(createCommitComposeState(), {
        type: 'setDraft',
        value: 'feat: from scratch\n\nbody text',
      })
      expect(state.summary).toBe('feat: from scratch')
      expect(state.body).toBe('body text')
      expect(state.pendingAiDraft).toBeUndefined()
      expect(state.editing).toBe(true)
    })

    it('treats whitespace-only fields as empty (no false positives on the clobber guard)', () => {
      // Spaces / newlines in the fields shouldn't trigger the
      // confirmation flow — those are no-op typing artifacts, not
      // meaningful content.
      let state = applyCommitComposeAction(createCommitComposeState(), {
        type: 'append',
        value: '   ',
      })
      state = applyCommitComposeAction(state, {
        type: 'setDraft',
        value: 'feat: real content\n\nbody',
      })
      expect(state.summary).toBe('feat: real content')
      expect(state.pendingAiDraft).toBeUndefined()
    })

    it('acceptPendingAiDraft swaps the staged draft into summary/body and clears the pending state', () => {
      const state = applyCommitComposeAction(
        applyCommitComposeAction(createCommitComposeState(), {
          type: 'append',
          value: 'user text',
        }),
        { type: 'setDraft', value: 'feat: AI draft\n\nAI body' }
      )
      expect(state.pendingAiDraft).toBeDefined()

      const accepted = applyCommitComposeAction(state, { type: 'acceptPendingAiDraft' })
      expect(accepted.summary).toBe('feat: AI draft')
      expect(accepted.body).toBe('AI body')
      expect(accepted.pendingAiDraft).toBeUndefined()
      expect(accepted.message).toBeUndefined()
      expect(accepted.editing).toBe(true)
    })

    it('dismissPendingAiDraft drops the staged draft and preserves user typing', () => {
      const state = applyCommitComposeAction(
        applyCommitComposeAction(createCommitComposeState(), {
          type: 'append',
          value: 'fix: my typing',
        }),
        { type: 'setDraft', value: 'feat: AI version\n\nbody' }
      )
      expect(state.summary).toBe('fix: my typing')
      expect(state.pendingAiDraft).toBeDefined()

      const dismissed = applyCommitComposeAction(state, { type: 'dismissPendingAiDraft' })
      expect(dismissed.summary).toBe('fix: my typing')
      expect(dismissed.pendingAiDraft).toBeUndefined()
      expect(dismissed.message).toBeUndefined()
    })

    it('acceptPendingAiDraft is a no-op when no draft is staged', () => {
      // Defensive: if the input handler somehow dispatched accept
      // without a pending draft (race, stale event, future bug), the
      // reducer should not throw or corrupt state.
      const state = createCommitComposeState()
      const after = applyCommitComposeAction(state, { type: 'acceptPendingAiDraft' })
      expect(after).toBe(state)
    })
  })
})
