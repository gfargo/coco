import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeHookHarness } from '../../../test/builders/makeHookHarness'
import type { CommitComposeState } from '../commitCompose'
import { createManualCommit } from '../commitCompose'
import { useCommitComposeActions, type UseCommitComposeActionsDeps } from './useCommitComposeActions'

// #2222. Committing from compose and editing the draft in $EDITOR are the two
// ways a user can lose or mangle a commit message, so both are pinned: what is
// refused, what is dispatched in what order, that a failed commit keeps the
// draft, that an editor that did not exit cleanly never overwrites it, and that
// the temp directory is always cleaned up.
jest.mock('node:child_process', () => ({ spawnSync: jest.fn() }))
// Real files, wrapped so a test can make one call fail. (An ES namespace import
// of `fs` cannot be spied on.)
jest.mock('node:fs', () => {
  const actual = jest.requireActual('node:fs')
  return {
    ...actual,
    mkdtempSync: jest.fn(actual.mkdtempSync),
    readFileSync: jest.fn(actual.readFileSync),
    writeFileSync: jest.fn(actual.writeFileSync),
  }
})
jest.mock('../editorHandoff', () => ({ runWithTerminalHandedOff: (_io: unknown, run: () => unknown) => run() }))
jest.mock('../commitCompose', () => ({
  ...jest.requireActual('../commitCompose'),
  createManualCommit: jest.fn(),
}))

const actualFs = jest.requireActual('node:fs') as typeof fs
const fsMock = fs as unknown as Record<'mkdtempSync' | 'readFileSync' | 'writeFileSync', jest.Mock>
// eslint-disable-next-line @typescript-eslint/no-var-requires
const spawnSyncMock = require('node:child_process').spawnSync as jest.Mock
const createCommitMock = createManualCommit as unknown as jest.Mock

const compose = (over: Partial<CommitComposeState> = {}): CommitComposeState =>
  ({ summary: 'feat: add thing', body: 'Why it matters.', field: 'summary', editing: false, loading: false, ...over }) as CommitComposeState

function mountActions(over: Partial<UseCommitComposeActionsDeps> = {}) {
  const dispatch = jest.fn()
  const calls: string[] = []
  const refreshHistoryRows = jest.fn(async () => { calls.push('history') })
  const refreshWorktreeContext = jest.fn(async () => { calls.push('worktree'); return undefined })
  const deps = {
    git: {} as never,
    dispatch,
    context: { worktree: { stagedCount: 2 } } as never,
    commitCompose: compose(),
    refreshHistoryRows,
    refreshWorktreeContext,
    ...over,
  } as UseCommitComposeActionsDeps
  const actions = makeHookHarness().render((React) => useCommitComposeActions(React, deps))
  const dispatched = () => dispatch.mock.calls.map(([action]) => action)
  const statuses = () => dispatched().filter((action) => action.type === 'setStatus')
  return { ...actions, dispatch, dispatched, statuses, calls, refreshHistoryRows, refreshWorktreeContext }
}

describe('createCommitFromCompose (#2222)', () => {
  beforeEach(() => createCommitMock.mockReset())

  it('refuses with a hint, and commits nothing, when nothing is staged', async () => {
    const { createCommitFromCompose, statuses } = mountActions({ context: { worktree: { stagedCount: 0 } } as never })
    await createCommitFromCompose()
    expect(createCommitMock).not.toHaveBeenCalled()
    expect(statuses()).toEqual([{ type: 'setStatus', value: 'stage changes before committing', kind: 'warning' }])
  })

  it('treats a worktree that has not loaded as nothing staged', async () => {
    const { createCommitFromCompose, statuses } = mountActions({ context: {} as never })
    await createCommitFromCompose()
    expect(createCommitMock).not.toHaveBeenCalled()
    expect(statuses()[0]).toMatchObject({ kind: 'warning' })
  })

  it('commits the draft it was given, through the active git', async () => {
    createCommitMock.mockResolvedValue({ ok: true, message: 'Created commit abc1234' })
    const git = { tag: 'active' } as never
    const { createCommitFromCompose } = mountActions({ git, commitCompose: compose({ summary: 'fix: a', body: 'because' }) })
    await createCommitFromCompose()
    expect(createCommitMock).toHaveBeenCalledWith({ git, summary: 'fix: a', body: 'because' })
  })

  describe('when the commit lands', () => {
    beforeEach(() => createCommitMock.mockResolvedValue({ ok: true, message: 'Created commit abc1234' }))

    it('shows progress, then the result with the next-step hint as a success', async () => {
      const { createCommitFromCompose, dispatched } = mountActions()
      await createCommitFromCompose()
      const types = dispatched().map((action) => (action.type === 'commitCompose' ? `compose:${action.action.type}` : action.type === 'setStatus' ? `status:${action.kind ?? 'info'}` : action.type))
      expect(types.slice(0, 5)).toEqual(['compose:setLoading', 'status:info', 'compose:setResult', 'status:success', 'compose:reset'])
      const success = dispatched().filter((action) => action.type === 'setStatus').at(-1)
      expect(success.value).toBe('Created commit abc1234 — P push · gh history')
    })

    it('clears the draft, then refreshes history before the worktree', async () => {
      const { createCommitFromCompose, dispatched, calls } = mountActions()
      await createCommitFromCompose()
      expect(dispatched().some((action) => action.type === 'commitCompose' && action.action.type === 'reset')).toBe(true)
      // The new commit has to be in the log view, not just the staged counts.
      expect(calls).toEqual(['history', 'worktree'])
    })

    it.each([
      ['staged', { stagedCount: 1, unstagedCount: 0, untrackedCount: 0 }, true],
      ['unstaged', { stagedCount: 0, unstagedCount: 2, untrackedCount: 0 }, true],
      ['untracked', { stagedCount: 0, unstagedCount: 0, untrackedCount: 1 }, true],
      ['clean', { stagedCount: 0, unstagedCount: 0, untrackedCount: 0 }, false],
    ])('returns from the commit knowing the tree is %s: stillDirty=%s', async (_label, counts, stillDirty) => {
      const { createCommitFromCompose, dispatched } = mountActions({ refreshWorktreeContext: jest.fn(async () => counts) as never })
      await createCommitFromCompose()
      expect(dispatched().at(-1)).toEqual({ type: 'returnFromCommit', stillDirty })
    })

    it('counts the tree as clean when the refresh could not read it', async () => {
      const { createCommitFromCompose, dispatched } = mountActions()
      await createCommitFromCompose()
      expect(dispatched().at(-1)).toEqual({ type: 'returnFromCommit', stillDirty: false })
    })
  })

  describe('when the commit fails', () => {
    beforeEach(() => createCommitMock.mockResolvedValue({ ok: false, message: 'hook failed', details: ['lint: 2 errors'] }))

    it('reports the failure and its details as an error', async () => {
      const { createCommitFromCompose, dispatched } = mountActions()
      await createCommitFromCompose()
      expect(dispatched()).toContainEqual({ type: 'commitCompose', action: { type: 'setResult', message: 'hook failed', details: ['lint: 2 errors'] } })
      expect(dispatched().filter((action) => action.type === 'setStatus').at(-1)).toEqual({ type: 'setStatus', value: 'hook failed', kind: 'error' })
    })

    it('keeps the draft, refreshes nothing, and stays in compose', async () => {
      const { createCommitFromCompose, dispatched, calls } = mountActions()
      await createCommitFromCompose()
      expect(dispatched().some((action) => action.type === 'commitCompose' && action.action.type === 'reset')).toBe(false)
      expect(dispatched().some((action) => action.type === 'returnFromCommit')).toBe(false)
      expect(calls).toEqual([])
    })
  })
})

describe('openComposeInEditor (#2222)', () => {
  const savedEnv = { VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR }
  let seen: { command: string; args: string[]; file: string; seeded: string } | undefined

  /** An editor that records how it was launched and what the file held, then rewrites it. */
  const editorThat = (edited: string | undefined, result: Record<string, unknown> = { status: 0 }) => {
    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      const file = args[args.length - 1]
      seen = { command, args, file, seeded: fs.readFileSync(file, 'utf8') }
      if (edited !== undefined) fs.writeFileSync(file, edited)
      return result
    })
  }

  beforeEach(() => {
    seen = undefined
    spawnSyncMock.mockReset()
    delete process.env.VISUAL
    delete process.env.EDITOR
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    // Back to the real implementations after a test made one fail.
    for (const name of ['mkdtempSync', 'readFileSync', 'writeFileSync'] as const) {
      fsMock[name].mockReset()
      fsMock[name].mockImplementation(actualFs[name] as never)
    }
  })

  it('seeds a temp file with the draft as a real commit message: summary, a blank line, body', () => {
    editorThat('unchanged')
    mountActions({ commitCompose: compose({ summary: 'feat: x', body: 'Body text.' }) }).openComposeInEditor()
    expect(seen?.seeded).toBe('feat: x\n\nBody text.')
    expect(path.basename(seen?.file ?? '')).toBe('COMMIT_EDITMSG.md')
  })

  it('opens an empty file for an empty draft', () => {
    editorThat('x')
    mountActions({ commitCompose: compose({ summary: '', body: '' }) }).openComposeInEditor()
    expect(seen?.seeded).toBe('')
  })

  describe('choosing the editor', () => {
    const launched = (visual?: string, editor?: string) => {
      delete process.env.VISUAL
      delete process.env.EDITOR
      if (visual !== undefined) process.env.VISUAL = visual
      if (editor !== undefined) process.env.EDITOR = editor
      editorThat('x')
      mountActions().openComposeInEditor()
      return seen
    }

    it('prefers $VISUAL over $EDITOR, and falls back to vi', () => {
      expect(launched('nvim', 'nano')?.command).toBe('nvim')
      expect(launched(undefined, 'nano')?.command).toBe('nano')
      expect(launched()?.command).toBe('vi')
    })

    it('splits an editor with arguments, so "code -w" runs code with -w', () => {
      const run = launched('code -w')
      expect(run?.command).toBe('code')
      expect(run?.args.slice(0, -1)).toEqual(['-w'])
    })
  })

  it('hands the terminal to the editor with the user\'s git environment, not the headless guards', () => {
    editorThat('x')
    mountActions().openComposeInEditor()
    expect(spawnSyncMock.mock.calls[0][2]).toMatchObject({ stdio: 'inherit', env: expect.any(Object) })
  })

  describe('when the editor exits cleanly', () => {
    it('reads the file back into the draft as the user\'s own text, and says so', () => {
      editorThat('fix: reworded\n\nA better body.')
      const { openComposeInEditor, dispatched } = mountActions()
      openComposeInEditor()
      expect(dispatched()).toContainEqual({ type: 'commitCompose', action: { type: 'setDraft', value: 'fix: reworded\n\nA better body.', source: 'user' } })
      expect(dispatched().filter((action) => action.type === 'setStatus').at(-1)).toEqual({ type: 'setStatus', value: 'Commit draft updated from editor.', kind: 'success' })
    })

    it('reports a file it cannot read back as an error, and does not set a draft', () => {
      // The editor exits cleanly, and then the file cannot be read back.
      let editorDone = false
      spawnSyncMock.mockImplementation((_command: string, args: string[]) => {
        seen = { command: '', args, file: args[args.length - 1], seeded: '' }
        editorDone = true
        return { status: 0 }
      })
      fsMock.readFileSync.mockImplementation(((file: string, ...rest: unknown[]) => {
        if (editorDone) throw new Error('EIO')
        return (actualFs.readFileSync as (...args: unknown[]) => unknown)(file, ...rest)
      }) as never)
      const { openComposeInEditor, dispatched } = mountActions()
      openComposeInEditor()
      expect(dispatched().some((action) => action.type === 'commitCompose')).toBe(false)
      expect(dispatched().filter((action) => action.type === 'setStatus').at(-1)).toMatchObject({ kind: 'error' })
    })
  })

  describe('when the editor does not exit cleanly, the draft is left alone', () => {
    it.each([
      ['a non-zero exit', { status: 1 }, 'warning', 'vi exited with status 1'],
      ['being killed by a signal', { status: null, signal: 'SIGTERM' }, 'warning', 'vi interrupted by SIGTERM'],
      ['failing to launch', { status: null, error: new Error('spawn vi ENOENT') }, 'error', 'Failed to launch vi: spawn vi ENOENT'],
    ])('after %s', (_label, result, kind, message) => {
      editorThat('this edit must not be read back', result)
      const { openComposeInEditor, dispatched, statuses } = mountActions()
      openComposeInEditor()
      expect(dispatched().some((action) => action.type === 'commitCompose')).toBe(false)
      expect(statuses().at(-1)).toEqual({ type: 'setStatus', value: message, kind })
    })
  })

  it('repaints the screen once the editor returns, whatever happened', () => {
    for (const result of [{ status: 0 }, { status: 2 }]) {
      editorThat('x', result)
      const resumeRef = { current: jest.fn() }
      mountActions({ resumeRef }).openComposeInEditor()
      expect(resumeRef.current).toHaveBeenCalledTimes(1)
    }
  })

  it('still repaints, and cleans up, when launching the editor throws', () => {
    spawnSyncMock.mockImplementation((_command: string, args: string[]) => { seen = { command: '', args, file: args[args.length - 1], seeded: '' }; throw new Error('boom') })
    const resumeRef = { current: jest.fn() }
    const { openComposeInEditor } = mountActions({ resumeRef })
    expect(() => openComposeInEditor()).toThrow('boom')
    expect(resumeRef.current).toHaveBeenCalledTimes(1)
  })

  describe('the temp directory', () => {
    it.each([
      ['an edit that was kept', 'edited', { status: 0 }],
      ['an editor that failed', 'edited', { status: 1 }],
    ])('is removed after %s', (_label, edited, result) => {
      editorThat(edited, result)
      mountActions().openComposeInEditor()
      expect(fs.existsSync(path.dirname(seen?.file as string))).toBe(false)
    })

    it('is removed even if the user deleted the file from inside the editor', () => {
      spawnSyncMock.mockImplementation((_command: string, args: string[]) => {
        seen = { command: '', args, file: args[args.length - 1], seeded: '' }
        fs.rmSync(args[args.length - 1])
        return { status: 0 }
      })
      const { openComposeInEditor, statuses } = mountActions()
      openComposeInEditor()
      expect(fs.existsSync(path.dirname(seen?.file as string))).toBe(false)
      expect(statuses().at(-1)).toMatchObject({ kind: 'error' })
    })
  })

  describe('failures before the editor starts', () => {
    it('reports a temp directory it cannot create and does not launch the editor', () => {
      fsMock.mkdtempSync.mockImplementationOnce((() => { throw new Error('EACCES') }) as never)
      const { openComposeInEditor, statuses } = mountActions()
      openComposeInEditor()
      expect(spawnSyncMock).not.toHaveBeenCalled()
      expect(statuses().at(-1)).toEqual({ type: 'setStatus', value: 'Failed to create temp file for editor: EACCES', kind: 'error' })
    })

    it('reports a draft it cannot write, removes the directory, and does not launch the editor', () => {
      let created: string | undefined
      fsMock.mkdtempSync.mockImplementationOnce(((prefix: string) => { created = actualFs.mkdtempSync(prefix); return created }) as never)
      fsMock.writeFileSync.mockImplementationOnce((() => { throw new Error('ENOSPC') }) as never)
      const { openComposeInEditor, statuses } = mountActions()
      openComposeInEditor()
      expect(spawnSyncMock).not.toHaveBeenCalled()
      expect(statuses().at(-1)).toEqual({ type: 'setStatus', value: 'Failed to seed temp file: ENOSPC', kind: 'error' })
      expect(fs.existsSync(created as string)).toBe(false)
    })
  })
})
