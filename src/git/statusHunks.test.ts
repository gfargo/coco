import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import {
  getWorktreeHunks,
  revertHunk,
  revertHunkLines,
  sliceHunkLines,
  stageHunk,
  stageHunkLines,
  statusHunkTestInternals,
  unstageHunk,
} from './statusHunks'
import { WorktreeFile } from './statusData'

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}))

const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>

const unstagedFile: WorktreeFile = {
  path: 'src/file.ts',
  indexStatus: ' ',
  worktreeStatus: 'M',
  state: 'unstaged',
}

const stagedFile: WorktreeFile = {
  path: 'src/file.ts',
  indexStatus: 'M',
  worktreeStatus: ' ',
  state: 'staged',
}

const diff = [
  'diff --git a/src/file.ts b/src/file.ts',
  'index 1111111..2222222 100644',
  '--- a/src/file.ts',
  '+++ b/src/file.ts',
  '@@ -1,3 +1,3 @@',
  ' const value = 1',
  '-const oldName = true',
  '+const newName = true',
  ' export { value }',
  '',
].join('\n')

function createGit(diffOutput = diff) {
  return {
    diff: jest.fn().mockResolvedValue(diffOutput),
    revparse: jest.fn().mockResolvedValue('/repo'),
  }
}

function mockSpawnSuccess() {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter
    stdin: {
      write: jest.Mock
      end: jest.Mock
    }
  }
  child.stderr = new EventEmitter()
  child.stdin = {
    write: jest.fn(),
    end: jest.fn(),
  }

  mockedSpawn.mockReturnValue(child as never)

  return child
}

describe('log status hunks', () => {
  beforeEach(() => {
    mockedSpawn.mockReset()
  })

  it('loads unstaged hunks for files with worktree changes', async () => {
    const git = createGit()

    const overview = await getWorktreeHunks(git as never, unstagedFile)

    expect(git.diff).toHaveBeenCalledWith(['--', 'src/file.ts'])
    expect(overview?.hunks).toHaveLength(1)
    expect(overview?.hunks[0]).toMatchObject({
      id: 'src/file.ts::unstaged-hunk-1',
      filePath: 'src/file.ts',
      state: 'unstaged',
      header: '@@ -1,3 +1,3 @@',
    })
  })

  it('loads staged hunks for files with index changes', async () => {
    const git = createGit()

    const overview = await getWorktreeHunks(git as never, stagedFile)

    expect(git.diff).toHaveBeenCalledWith(['--staged', '--', 'src/file.ts'])
    expect(overview?.hunks[0].state).toBe('staged')
  })

  it('does not load hunks for untracked files', async () => {
    const git = createGit()

    await expect(getWorktreeHunks(git as never, {
      ...unstagedFile,
      indexStatus: '?',
      worktreeStatus: '?',
      state: 'untracked',
    })).resolves.toBeUndefined()
    expect(git.diff).not.toHaveBeenCalled()
  })

  it('stages and unstages single hunks through git apply cached', async () => {
    const git = createGit()
    const child = mockSpawnSuccess()
    const [unstagedHunk] = statusHunkTestInternals.parseHunks('src/file.ts', 'unstaged', diff)
    const [stagedHunk] = statusHunkTestInternals.parseHunks('src/file.ts', 'staged', diff)

    const stagePromise = stageHunk(git as never, unstagedHunk)
    setImmediate(() => child.emit('close', 0))
    await stagePromise

    const unstagePromise = unstageHunk(git as never, stagedHunk)
    setImmediate(() => child.emit('close', 0))
    await unstagePromise

    expect(mockedSpawn).toHaveBeenNthCalledWith(1, 'git', ['apply', '--cached', '-'], {
      cwd: '/repo',
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    expect(mockedSpawn).toHaveBeenNthCalledWith(2, 'git', ['apply', '--cached', '--reverse', '-'], {
      cwd: '/repo',
      stdio: ['pipe', 'ignore', 'pipe'],
    })
  })

  it('reverts unstaged hunks from the worktree', async () => {
    const git = createGit()
    const child = mockSpawnSuccess()
    const [unstagedHunk] = statusHunkTestInternals.parseHunks('src/file.ts', 'unstaged', diff)

    const revertPromise = revertHunk(git as never, unstagedHunk)
    setImmediate(() => child.emit('close', 0))
    await revertPromise

    expect(mockedSpawn).toHaveBeenCalledWith('git', ['apply', '--reverse', '-'], {
      cwd: '/repo',
      stdio: ['pipe', 'ignore', 'pipe'],
    })
  })

  it('reverts staged hunks from the worktree and index', async () => {
    const git = createGit()
    const child = mockSpawnSuccess()
    const [stagedHunk] = statusHunkTestInternals.parseHunks('src/file.ts', 'staged', diff)

    const revertPromise = revertHunk(git as never, stagedHunk)
    setImmediate(() => {
      child.emit('close', 0)
      setImmediate(() => child.emit('close', 0))
    })
    await revertPromise

    expect(mockedSpawn).toHaveBeenNthCalledWith(1, 'git', ['apply', '--reverse', '-'], {
      cwd: '/repo',
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    expect(mockedSpawn).toHaveBeenNthCalledWith(2, 'git', ['apply', '--cached', '--reverse', '-'], {
      cwd: '/repo',
      stdio: ['pipe', 'ignore', 'pipe'],
    })
  })
})

describe('line-level staging (#1358)', () => {
  // A hunk with two separate changes so a selection can cover one and
  // leave the other untouched.
  const multiChangeDiff = [
    'diff --git a/src/file.ts b/src/file.ts',
    'index 1111111..2222222 100644',
    '--- a/src/file.ts',
    '+++ b/src/file.ts',
    '@@ -1,4 +1,4 @@',
    ' const keep = 1',
    '-const first = old',
    '+const first = new',
    ' const middle = 2',
    '-const second = old',
    '+const second = new',
    '',
  ].join('\n')

  const unstagedHunk = () =>
    statusHunkTestInternals.parseHunks('src/file.ts', 'unstaged', multiChangeDiff)[0]

  it('STAGE slice: unselected removals become context, unselected additions vanish', () => {
    // Select only the FIRST change pair (body lines 1-2).
    const sliced = sliceHunkLines(unstagedHunk(), { start: 1, end: 2 }, 'stage')
    expect(sliced?.hunk.lines).toEqual([
      ' const keep = 1',
      '-const first = old',
      '+const first = new',
      ' const middle = 2',
      ' const second = old', // unselected removal → context (index keeps it)
      // unselected addition omitted — not being staged
    ])
    expect(sliced?.hunk.oldLines).toBe(4)
    expect(sliced?.hunk.newLines).toBe(4)
    expect(sliced?.header).toBe('@@ -1,4 +1,4 @@')
  })

  it('DISCARD slice: unselected additions become context, unselected removals vanish', () => {
    const sliced = sliceHunkLines(unstagedHunk(), { start: 1, end: 2 }, 'discard')
    expect(sliced?.hunk.lines).toEqual([
      ' const keep = 1',
      '-const first = old',
      '+const first = new',
      ' const middle = 2',
      // unselected removal omitted — already absent from the worktree
      ' const second = new', // unselected addition → context (stays in file)
    ])
    expect(sliced?.hunk.oldLines).toBe(4)
    expect(sliced?.hunk.newLines).toBe(4)
  })

  it('returns undefined when the selection holds no changed lines', () => {
    expect(sliceHunkLines(unstagedHunk(), { start: 0, end: 0 }, 'stage')).toBeUndefined()
    expect(sliceHunkLines(unstagedHunk(), { start: 3, end: 3 }, 'discard')).toBeUndefined()
  })

  it('stageHunkLines applies the sliced patch to the index', async () => {
    const git = createGit(multiChangeDiff)
    const child = mockSpawnSuccess()
    const promise = stageHunkLines(git as never, unstagedHunk(), { start: 1, end: 2 })
    setImmediate(() => child.emit('close', 0))
    await promise

    expect(mockedSpawn).toHaveBeenCalledWith('git', expect.arrayContaining(['apply', '--cached']), expect.anything())
    const patch = child.stdin.write.mock.calls[0][0] as string
    expect(patch).toContain('+const first = new')
    expect(patch).toContain(' const second = old')
    expect(patch).not.toContain('+const second = new')
  })

  it('revertHunkLines reverse-applies the discard slice to the worktree', async () => {
    const git = createGit(multiChangeDiff)
    const child = mockSpawnSuccess()
    const promise = revertHunkLines(git as never, unstagedHunk(), { start: 4, end: 5 })
    setImmediate(() => child.emit('close', 0))
    await promise

    const [, args] = mockedSpawn.mock.calls[0]
    expect(args).toEqual(expect.arrayContaining(['apply', '--reverse']))
    expect(args).not.toEqual(expect.arrayContaining(['--cached']))
    const patch = child.stdin.write.mock.calls[0][0] as string
    // Selected second pair kept as changes; unselected first pair
    // neutralized per discard rules.
    expect(patch).toContain('-const second = old')
    expect(patch).toContain(' const first = new')
    expect(patch).not.toContain('-const first = old')
  })

  it('refuses staged hunks', async () => {
    const staged = statusHunkTestInternals.parseHunks('src/file.ts', 'staged', multiChangeDiff)[0]
    await expect(stageHunkLines({} as never, staged, { start: 1, end: 2 })).rejects.toThrow('unstaged')
    await expect(revertHunkLines({} as never, staged, { start: 1, end: 2 })).rejects.toThrow('unstaged')
  })
})
