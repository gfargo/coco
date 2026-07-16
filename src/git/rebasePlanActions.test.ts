import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  buildRebaseTodo,
  executeRebasePlan,
  getRebasePlanRows,
  type RebasePlanRow,
} from './rebasePlanActions'

const row = (over: Partial<RebasePlanRow> = {}): RebasePlanRow => ({
  sha: 'a'.repeat(40),
  shortSha: 'aaaaaaa',
  subject: 'feat: first',
  author: 'Coco',
  date: '2026-05-01',
  action: 'pick',
  ...over,
})

describe('getRebasePlanRows', () => {
  it('parses oldest-first rows from base^..HEAD', async () => {
    const git = {
      raw: jest.fn()
        // rev-parse --verify base^
        .mockResolvedValueOnce('parent\n')
        .mockResolvedValueOnce([
          `${'a'.repeat(40)}\x1faaaaaaa\x1fCoco\x1f2026-05-01\x1ffeat: first`,
          `${'b'.repeat(40)}\x1fbbbbbbb\x1fCoco\x1f2026-05-02\x1ffix: second`,
        ].join('\n')),
    }
    const result = await getRebasePlanRows(git as never, 'a'.repeat(40))
    expect(result).toEqual({
      ok: true,
      rows: [
        expect.objectContaining({ shortSha: 'aaaaaaa', subject: 'feat: first', action: 'pick' }),
        expect.objectContaining({ shortSha: 'bbbbbbb', subject: 'fix: second', action: 'pick' }),
      ],
    })
    expect(git.raw).toHaveBeenNthCalledWith(1, ['rev-parse', '--verify', `${'a'.repeat(40)}^`])
  })

  it('refuses the root commit cleanly', async () => {
    const git = { raw: jest.fn().mockRejectedValueOnce(new Error('fatal: bad revision')) }
    await expect(getRebasePlanRows(git as never, 'a'.repeat(40))).resolves.toEqual({
      ok: false,
      message: 'Cannot rebase from the root commit.',
    })
  })
})

describe('buildRebaseTodo', () => {
  it('emits actions in row order, with drop lines kept explicit', () => {
    const build = buildRebaseTodo([
      row(),
      row({ sha: 'b'.repeat(40), shortSha: 'bbbbbbb', subject: 'wip', action: 'fixup' }),
      row({ sha: 'c'.repeat(40), shortSha: 'ccccccc', subject: 'debug', action: 'drop' }),
    ])
    expect(build).toMatchObject({ ok: true })
    if (!build.ok) return
    expect(build.todo).toBe([
      `pick ${'a'.repeat(40)} feat: first`,
      `fixup ${'b'.repeat(40)} wip`,
      `drop ${'c'.repeat(40)} debug`,
      '',
    ].join('\n'))
  })

  it('expresses reword as pick + exec amend with a message-file placeholder', () => {
    const build = buildRebaseTodo([
      row({ action: 'reword', newMessage: 'feat: better title' }),
    ])
    expect(build).toMatchObject({ ok: true })
    if (!build.ok) return
    expect(build.todo).toContain(`pick ${'a'.repeat(40)} feat: first`)
    expect(build.todo).toContain(`exec git commit --amend -F {{reword:${'a'.repeat(40)}}}`)
    expect(build.rewordMessages).toEqual([{ sha: 'a'.repeat(40), message: 'feat: better title' }])
  })

  it('rejects invalid plans with actionable messages', () => {
    expect(buildRebaseTodo([])).toMatchObject({ ok: false })
    expect(buildRebaseTodo([row({ action: 'drop' })])).toMatchObject({
      ok: false,
      message: expect.stringContaining('Every commit is dropped'),
    })
    expect(buildRebaseTodo([row({ action: 'squash' })])).toMatchObject({
      ok: false,
      message: expect.stringContaining('nothing above it'),
    })
    // A dropped first row shifts the "first kept" check to the survivor.
    expect(buildRebaseTodo([
      row({ action: 'drop' }),
      row({ sha: 'b'.repeat(40), shortSha: 'bbbbbbb', action: 'fixup' }),
    ])).toMatchObject({ ok: false, message: expect.stringContaining('bbbbbbb') })
    expect(buildRebaseTodo([row({ action: 'reword' })])).toMatchObject({
      ok: false,
      message: expect.stringContaining('no message'),
    })
  })
})

describe('executeRebasePlan', () => {
  it('spawns rebase -i with the generated todo installed via GIT_SEQUENCE_EDITOR', async () => {
    let capturedTodo = ''
    let capturedEnv: Record<string, string | undefined> = {}
    let capturedArgs: string[] = []
    let capturedCwd = ''
    const git = {
      // operation probe + --show-toplevel both resolve via revparse
      revparse: jest.fn().mockResolvedValue('/repo/root'),
      raw: jest.fn().mockResolvedValue(''),
    }
    const runner = jest.fn(async (args: string[], options: { cwd: string; env: Record<string, string | undefined> }) => {
      capturedArgs = args
      capturedEnv = options.env
      capturedCwd = options.cwd
      const match = /^cp '(.+)'$/.exec(options.env.GIT_SEQUENCE_EDITOR || '')
      if (match) {
        capturedTodo = readFileSync(match[1], 'utf8')
      }
      return ''
    })
    const rows = [
      row(),
      row({ sha: 'b'.repeat(40), shortSha: 'bbbbbbb', subject: 'wip', action: 'squash' }),
    ]
    const result = await executeRebasePlan(git as never, rows, runner)
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining('2 of 2 commits kept') })

    expect(capturedArgs).toEqual(['rebase', '-i', `${'a'.repeat(40)}^`])
    expect(capturedCwd).toBe('/repo/root')
    // The editor overrides are ENV-scoped to this one spawn — never
    // written into config or the shared simple-git instance.
    expect(capturedEnv.GIT_EDITOR).toBe('true')
    expect(capturedTodo).toBe([
      `pick ${'a'.repeat(40)} feat: first`,
      `squash ${'b'.repeat(40)} wip`,
      '',
    ].join('\n'))
  })

  it('surfaces a stopped (conflict) rebase with conflicts-view guidance', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('/repo/root'),
      raw: jest.fn().mockResolvedValue(''),
    }
    const runner = jest.fn(async () => {
      throw new Error('CONFLICT (content): Merge conflict in src/app.ts\ncould not apply bbbbbbb')
    })
    const result = await executeRebasePlan(git as never, [row()], runner)
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('Rebase stopped'),
      details: [expect.stringContaining('conflicts view (gx)')],
    })
  })

  it('treats a zero-exit edit stop as not-done: keeps the temp dir and reports paused', async () => {
    const fakeGitDir = mkdtempSync(join(tmpdir(), 'coco-fake-git-'))
    let capturedTodoFile = ''
    const git = {
      revparse: jest.fn(async (args: string[]) => {
        if (args[0] === '--git-path') {
          return join(fakeGitDir, args[1])
        }
        return '/repo/root'
      }),
      raw: jest.fn().mockResolvedValue(''),
    }
    const runner = jest.fn(async (_args: string[], options: { env: Record<string, string | undefined> }) => {
      const match = /^cp '(.+)'$/.exec(options.env.GIT_SEQUENCE_EDITOR || '')
      if (match) {
        capturedTodoFile = match[1]
      }
      // Simulate git stopping at an `edit` todo line with exit 0.
      mkdirSync(join(fakeGitDir, 'rebase-merge'))
      return ''
    })
    const rows = [
      row({ action: 'edit' }),
      row({ sha: 'b'.repeat(40), shortSha: 'bbbbbbb', subject: 'wip', action: 'reword', newMessage: 'better' }),
    ]
    const result = await executeRebasePlan(git as never, rows, runner)

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('paused'),
      details: [expect.stringContaining('conflicts view (gx)')],
    })
    // The temp dir (holding the pending reword message file) must survive
    // so `git rebase --continue`'s exec line can still find it.
    expect(existsSync(dirname(capturedTodoFile))).toBe(true)
  })

  it('refuses invalid plans before touching git', async () => {
    const git = { revparse: jest.fn().mockResolvedValue('/tmp/none'), raw: jest.fn() }
    const result = await executeRebasePlan(git as never, [row({ action: 'drop' })])
    expect(result).toMatchObject({ ok: false })
    expect(git.raw).not.toHaveBeenCalled()
  })
})
