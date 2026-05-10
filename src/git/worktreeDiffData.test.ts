import { SimpleGit } from 'simple-git'
import { getWorktreeFileDiff } from './worktreeDiffData'
import { WorktreeFile } from './statusData'

function gitWithDiffs(outputs: string[]): SimpleGit {
  return {
    diff: jest.fn()
      .mockImplementation(() => Promise.resolve(outputs.shift() || '')),
  } as unknown as SimpleGit
}

describe('worktree diff data', () => {
  it('loads staged and unstaged diffs for a modified file', async () => {
    const file: WorktreeFile = {
      path: 'src/app.ts',
      indexStatus: 'M',
      worktreeStatus: 'M',
      state: 'staged',
    }
    const diff = await getWorktreeFileDiff(gitWithDiffs([
      'diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n+staged\n',
      'diff --git a/src/app.ts b/src/app.ts\n@@ -2 +2 @@\n+unstaged\n',
    ]), file)

    expect(diff?.filePath).toBe('src/app.ts')
    expect(diff?.staged).toBe(true)
    expect(diff?.unstaged).toBe(true)
    expect(diff?.lines).toContain('Staged changes')
    expect(diff?.lines).toContain('Unstaged changes')
    expect(diff?.lines).toContain('+staged')
    expect(diff?.lines).toContain('+unstaged')
    expect(diff?.hunkOffsets).toHaveLength(2)
  })

  it('returns a useful placeholder for untracked files', async () => {
    const file: WorktreeFile = {
      path: 'src/new.ts',
      indexStatus: '?',
      worktreeStatus: '?',
      state: 'untracked',
    }
    const diff = await getWorktreeFileDiff(gitWithDiffs([]), file)

    expect(diff?.untracked).toBe(true)
    expect(diff?.lines.join('\n')).toContain('Untracked file: src/new.ts')
  })
})
