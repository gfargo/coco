import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import {
  getWorktreeHunks,
  stageHunk,
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
})
