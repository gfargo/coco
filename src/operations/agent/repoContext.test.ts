/**
 * Tests for the repo-context operation: hardened section readers in context.ts
 * and the runRepoContext dispatch in generate.ts.
 *
 * Uses real temporary git repositories (same pattern as context.test.ts).
 */

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import simpleGit from 'simple-git'

import {
  createAgentOperationContext,
  readRepoBranchContext,
  readRepoCapabilitiesContext,
  readRepoConflictsContext,
  readRepoHistoryContext,
  readRepoStatusContext,
} from './context'
import { runAgentOperation, runRepoContext } from './generate'
import { RepoContextRequestSchema } from './schemas'

jest.setTimeout(30000)

describe('repo-context readers', () => {
  let tempRoot: string
  let repoRoot: string

  async function initializeRepo(directory: string): Promise<string> {
    fs.mkdirSync(directory, { recursive: true })
    const git = simpleGit(directory)
    await git.init()
    await git.addConfig('user.name', 'Repo Context Test')
    await git.addConfig('user.email', 'repo-context@example.test')
    fs.writeFileSync(path.join(directory, 'README.md'), '# Test\n')
    await git.add('README.md')
    await git.commit('feat: initial commit')
    return fs.realpathSync(directory)
  }

  beforeEach(async () => {
    tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coco-repo-ctx-')))
    repoRoot = await initializeRepo(path.join(tempRoot, 'repo'))
  })

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  // ─── Branch section ──────────────────────────────────────────────────────

  describe('readRepoBranchContext', () => {
    it('returns the current branch name with detached=false', async () => {
      const context = await createAgentOperationContext({ repoRoot })
      const branch = await readRepoBranchContext(context)

      expect(branch.current).toMatch(/^(main|master)$/)
      expect(branch.detached).toBe(false)
    })

    it('detects detached HEAD and returns a short SHA', async () => {
      const git = simpleGit(repoRoot)
      const sha = (await git.revparse(['HEAD'])).trim()
      // Detach HEAD by checking out the SHA directly
      execFileSync('git', ['checkout', '--detach', sha], { cwd: repoRoot })

      const context = await createAgentOperationContext({ repoRoot })
      const branch = await readRepoBranchContext(context)

      expect(branch.detached).toBe(true)
      expect(branch.current).toMatch(/^[0-9a-f]+$/)
    })

    it('returns upstream and divergence when an upstream is configured', async () => {
      // Clone the repo so we have an upstream
      const cloneDir = path.join(tempRoot, 'clone')
      execFileSync('git', ['clone', repoRoot, cloneDir])
      const cloneRoot = fs.realpathSync(cloneDir)

      const context = await createAgentOperationContext({ repoRoot: cloneRoot })
      const branch = await readRepoBranchContext(context)

      expect(branch.upstream).toBeDefined()
      expect(branch.ahead).toBeGreaterThanOrEqual(0)
      expect(branch.behind).toBeGreaterThanOrEqual(0)
    })

    it('returns no upstream when none is configured', async () => {
      const context = await createAgentOperationContext({ repoRoot })
      const branch = await readRepoBranchContext(context)

      expect(branch.upstream).toBeUndefined()
      expect(branch.ahead).toBeUndefined()
      expect(branch.behind).toBeUndefined()
    })
  })

  // ─── Status section ──────────────────────────────────────────────────────

  describe('readRepoStatusContext', () => {
    it('returns empty status for a clean repository', async () => {
      const context = await createAgentOperationContext({ repoRoot })
      const status = await readRepoStatusContext(context)

      expect(status.staged).toHaveLength(0)
      expect(status.unstaged).toHaveLength(0)
      expect(status.untracked).toHaveLength(0)
      expect(status.conflicted).toHaveLength(0)
      expect(status.totalCount).toBe(0)
      expect(status.truncated).toBe(false)
    })

    it('reports staged files with index status characters', async () => {
      const git = simpleGit(repoRoot)
      fs.writeFileSync(path.join(repoRoot, 'staged.txt'), 'content\n')
      await git.add('staged.txt')

      const context = await createAgentOperationContext({ repoRoot })
      const status = await readRepoStatusContext(context)

      expect(status.staged).toHaveLength(1)
      expect(status.staged[0]).toMatchObject({
        path: 'staged.txt',
        indexStatus: 'A',
      })
      expect(status.counts.staged).toBe(1)
    })

    it('reports unstaged modified files', async () => {
      fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Modified\n')

      const context = await createAgentOperationContext({ repoRoot })
      const status = await readRepoStatusContext(context)

      expect(status.unstaged).toHaveLength(1)
      expect(status.unstaged[0].path).toBe('README.md')
      expect(status.counts.unstaged).toBe(1)
    })

    it('reports untracked files', async () => {
      fs.writeFileSync(path.join(repoRoot, 'untracked.txt'), 'new\n')

      const context = await createAgentOperationContext({ repoRoot })
      const status = await readRepoStatusContext(context)

      expect(status.untracked).toHaveLength(1)
      expect(status.untracked[0].path).toBe('untracked.txt')
      expect(status.counts.untracked).toBe(1)
    })

    it('includes numstat additions/deletions for staged changes', async () => {
      const git = simpleGit(repoRoot)
      fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Updated\nNew line\n')
      await git.add('README.md')

      const context = await createAgentOperationContext({ repoRoot })
      const status = await readRepoStatusContext(context)

      expect(status.staged).toHaveLength(1)
      expect(status.staged[0].additions).toBeGreaterThanOrEqual(0)
      expect(status.staged[0].deletions).toBeGreaterThanOrEqual(0)
    })

    it('does not include diff/patch content in the response', async () => {
      const git = simpleGit(repoRoot)
      fs.writeFileSync(path.join(repoRoot, 'secret.txt'), 'top-secret-data\n')
      await git.add('secret.txt')

      const context = await createAgentOperationContext({ repoRoot })
      const status = await readRepoStatusContext(context)

      const serialized = JSON.stringify(status)
      expect(serialized).not.toContain('top-secret-data')
    })
  })

  // ─── History section ─────────────────────────────────────────────────────

  describe('readRepoHistoryContext', () => {
    it('returns the initial commit in history', async () => {
      const context = await createAgentOperationContext({ repoRoot })
      const history = await readRepoHistoryContext(context)

      expect(history.entries).toHaveLength(1)
      expect(history.entries[0].subject).toBe('feat: initial commit')
      expect(history.entries[0].sha).toMatch(/^[0-9a-f]{40}$/)
      expect(history.entries[0].author).toBe('Repo Context Test')
      expect(history.truncated).toBe(false)
    })

    it('truncates history at the requested limit and sets truncated=true', async () => {
      const git = simpleGit(repoRoot)
      // Create 5 more commits
      for (let i = 1; i <= 5; i++) {
        fs.writeFileSync(path.join(repoRoot, `file${i}.txt`), `content ${i}\n`)
        await git.add(`file${i}.txt`)
        await git.commit(`feat: commit ${i}`)
      }

      const context = await createAgentOperationContext({ repoRoot })
      const history = await readRepoHistoryContext(context, 3)

      expect(history.entries).toHaveLength(3)
      expect(history.truncated).toBe(true)
    })

    it('returns empty history for a repo with no commits', async () => {
      const emptyDir = path.join(tempRoot, 'empty-repo')
      fs.mkdirSync(emptyDir)
      execFileSync('git', ['init'], { cwd: emptyDir })
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: emptyDir })
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: emptyDir })
      const emptyRoot = fs.realpathSync(emptyDir)

      const context = await createAgentOperationContext({ repoRoot: emptyRoot })
      const history = await readRepoHistoryContext(context)

      expect(history.entries).toHaveLength(0)
      expect(history.totalCount).toBe(0)
      expect(history.truncated).toBe(false)
    })

    it('does not include diff/patch content in history entries', async () => {
      const git = simpleGit(repoRoot)
      fs.writeFileSync(path.join(repoRoot, 'private.txt'), 'sensitive-value\n')
      await git.add('private.txt')
      await git.commit('chore: add private file')

      const context = await createAgentOperationContext({ repoRoot })
      const history = await readRepoHistoryContext(context)

      const serialized = JSON.stringify(history)
      expect(serialized).not.toContain('sensitive-value')
    })
  })

  // ─── Conflicts section ───────────────────────────────────────────────────

  describe('readRepoConflictsContext', () => {
    it('returns inProgress=false and empty files for a clean repo', async () => {
      const context = await createAgentOperationContext({ repoRoot })
      const conflicts = await readRepoConflictsContext(context)

      expect(conflicts.inProgress).toBe(false)
      expect(conflicts.operation).toBe('none')
      expect(conflicts.files).toHaveLength(0)
      expect(conflicts.totalCount).toBe(0)
      expect(conflicts.truncated).toBe(false)
    })

    it('detects a mid-merge state and reports the conflicted files', async () => {
      const git = simpleGit(repoRoot)
      // Get the name of the default branch
      const defaultBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim()

      // Create a feature branch with conflicting changes
      await git.checkoutBranch('feature', 'HEAD')
      fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Feature branch\n')
      await git.add('README.md')
      await git.commit('feat: feature branch change')

      // Switch back to the default branch and make a conflicting change
      await git.checkout(defaultBranch)
      fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Main branch\n')
      await git.add('README.md')
      await git.commit('feat: main branch change')

      // Attempt merge — expect it to fail with a conflict
      try {
        await git.merge(['feature'])
      } catch {
        // Expected conflict
      }

      const context = await createAgentOperationContext({ repoRoot })
      const conflicts = await readRepoConflictsContext(context)

      expect(conflicts.inProgress).toBe(true)
      expect(conflicts.operation).toBe('merge')
      expect(conflicts.files.length).toBeGreaterThan(0)
      expect(conflicts.files[0].path).toBe('README.md')
    })
  })

  // ─── Capabilities section ────────────────────────────────────────────────

  describe('readRepoCapabilitiesContext', () => {
    it('detects a non-shallow, non-worktree repo without commitlint', async () => {
      const context = await createAgentOperationContext({ repoRoot })
      const caps = await readRepoCapabilitiesContext(context)

      expect(caps.isShallow).toBe(false)
      expect(caps.isWorktree).toBe(false)
      expect(caps.hasCommitlintConfig).toBe(false)
    })

    it('detects hasCommitlintConfig=true when .commitlintrc exists', async () => {
      fs.writeFileSync(path.join(repoRoot, '.commitlintrc'), '{"extends":["@commitlint/config-conventional"]}\n')

      const context = await createAgentOperationContext({ repoRoot })
      const caps = await readRepoCapabilitiesContext(context)

      expect(caps.hasCommitlintConfig).toBe(true)
    })

    it('detects hasCommitlintConfig=true when package.json has commitlint field', async () => {
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({ name: 'test', commitlint: { extends: [] } }),
      )

      const context = await createAgentOperationContext({ repoRoot })
      const caps = await readRepoCapabilitiesContext(context)

      expect(caps.hasCommitlintConfig).toBe(true)
    })

    it('detects isShallow=true for a shallow clone', async () => {
      const shallowDir = path.join(tempRoot, 'shallow-clone')
      // Use file:// protocol to force a real shallow clone (local path clones ignore --depth)
      execFileSync('git', ['clone', '--depth=1', `file://${repoRoot}`, shallowDir])
      const shallowRoot = fs.realpathSync(shallowDir)

      const context = await createAgentOperationContext({ repoRoot: shallowRoot })
      const caps = await readRepoCapabilitiesContext(context)

      expect(caps.isShallow).toBe(true)
    })

    it('detects isWorktree=true for a linked worktree', async () => {
      const worktreeDir = path.join(tempRoot, 'linked-worktree')
      const git = simpleGit(repoRoot)
      // Create a branch for the worktree
      await git.checkoutBranch('worktree-branch', 'HEAD')
      await git.checkout('main').catch(() => git.checkout('master'))
      execFileSync('git', ['worktree', 'add', worktreeDir, 'worktree-branch'], { cwd: repoRoot })
      const worktreeRoot = fs.realpathSync(worktreeDir)

      const context = await createAgentOperationContext({ repoRoot: worktreeRoot })
      const caps = await readRepoCapabilitiesContext(context)

      expect(caps.isWorktree).toBe(true)
    })

    it('detects github forge when origin remote is github.com', async () => {
      const git = simpleGit(repoRoot)
      // Set a fake github remote
      await git.addRemote('origin', 'https://github.com/example/repo.git').catch(() => {
        // Remote already exists — update it
        return git.remote(['set-url', 'origin', 'https://github.com/example/repo.git'])
      })

      const context = await createAgentOperationContext({ repoRoot })
      const caps = await readRepoCapabilitiesContext(context)

      expect(caps.forge).toBe('github')
    })
  })

  // ─── runRepoContext dispatch ─────────────────────────────────────────────

  describe('runRepoContext', () => {
    it('returns branch and status by default (include defaults to ["branch","status"])', async () => {
      const git = simpleGit(repoRoot)
      fs.writeFileSync(path.join(repoRoot, 'staged.txt'), 'staged\n')
      await git.add('staged.txt')

      const context = await createAgentOperationContext({ repoRoot })
      const input = RepoContextRequestSchema.parse({})
      const result = await runRepoContext(input, context)

      expect(result.ok).toBe(true)
      expect(result.operation).toBe('repo-context')
      expect(result.data.branch).toBeDefined()
      expect(result.data.status).toBeDefined()
      expect(result.data.history).toBeUndefined()
      expect(result.data.conflicts).toBeUndefined()
      expect(result.data.capabilities).toBeUndefined()
    })

    it('only fetches requested sections', async () => {
      const context = await createAgentOperationContext({ repoRoot })
      const input = RepoContextRequestSchema.parse({ include: ['history'] })
      const result = await runRepoContext(input, context)

      expect(result.data.history).toBeDefined()
      expect(result.data.branch).toBeUndefined()
      expect(result.data.status).toBeUndefined()
    })

    it('returns all five sections when explicitly requested', async () => {
      const context = await createAgentOperationContext({ repoRoot })
      const input = RepoContextRequestSchema.parse({
        include: ['branch', 'status', 'history', 'conflicts', 'capabilities'],
      })
      const result = await runRepoContext(input, context)

      expect(result.data.branch).toBeDefined()
      expect(result.data.status).toBeDefined()
      expect(result.data.history).toBeDefined()
      expect(result.data.conflicts).toBeDefined()
      expect(result.data.capabilities).toBeDefined()
    })

    it('produces a well-formed success envelope with digest provenance', async () => {
      const context = await createAgentOperationContext({ repoRoot })
      const input = RepoContextRequestSchema.parse({})
      const result = await runRepoContext(input, context)

      expect(result.version).toBe(1)
      expect(result.ok).toBe(true)
      expect(result.status).toBe('completed')
      expect(result.warnings).toEqual([])
      expect(result.meta.kind).toBe('repository')
      expect(result.meta.verification).toBe('repository-derived')
      expect(result.meta.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(result.meta.repositoryHead).toMatch(/^[0-9a-f]{40}$/)
    })

    it('never includes diff content in the response', async () => {
      const git = simpleGit(repoRoot)
      fs.writeFileSync(path.join(repoRoot, 'private.ts'), 'export const SECRET = "do-not-leak"\n')
      await git.add('private.ts')

      const context = await createAgentOperationContext({ repoRoot })
      const input = RepoContextRequestSchema.parse({
        include: ['branch', 'status', 'history', 'conflicts', 'capabilities'],
      })
      const result = await runRepoContext(input, context)

      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('do-not-leak')
      expect(serialized).not.toContain('export const')
    })

    it('respects the historyLimit parameter', async () => {
      const git = simpleGit(repoRoot)
      for (let i = 1; i <= 10; i++) {
        fs.writeFileSync(path.join(repoRoot, `f${i}.txt`), `${i}\n`)
        await git.add(`f${i}.txt`)
        await git.commit(`chore: commit ${i}`)
      }

      const context = await createAgentOperationContext({ repoRoot })
      const input = RepoContextRequestSchema.parse({ include: ['history'], historyLimit: 5 })
      const result = await runRepoContext(input, context)

      expect(result.data.history?.entries).toHaveLength(5)
      expect(result.data.history?.truncated).toBe(true)
    })
  })

  // ─── runAgentOperation INVALID_OPERATION guard ───────────────────────────

  describe('runAgentOperation with repo-context', () => {
    it('throws INVALID_OPERATION when dispatched via runAgentOperation', async () => {
      const context = await createAgentOperationContext({ repoRoot })
      // repo-context is not a valid operation for runAgentOperation;
      // it must be dispatched via runRepoContext directly.
      await expect(
        runAgentOperation(
          'repo-context',
          // Cast: repo-context doesn't use AgentTaskInput but we need to pass something
          {} as Parameters<typeof runAgentOperation>[1],
          context,
        ),
      ).rejects.toMatchObject({
        code: 'INVALID_OPERATION',
        message: expect.stringContaining('runRepoContext'),
      })
    })
  })
})
