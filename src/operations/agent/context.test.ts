import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import simpleGit from 'simple-git'

import {
    createAgentOperationContext,
    digestOf,
    getBranchContext,
    getRecentLog,
    getRepoStatus,
    getStagedDiff,
    isPathWithinRoot,
    resolveAgentDirectoryRoot,
    resolveAgentRepoRoot,
    resolveChangeSource,
} from './context'
import { AgentOperationError } from './errors'
import { ChangeSource, MAX_AGENT_CONTEXT_BYTES } from './schemas'

jest.setTimeout(20000)

describe('agent repository context', () => {
  let tempRoot: string
  let repoRoot: string

  async function initializeRepo(directory: string): Promise<string> {
    fs.mkdirSync(directory, { recursive: true })
    const git = simpleGit(directory)
    await git.init()
    await git.addConfig('user.name', 'Agent Test')
    await git.addConfig('user.email', 'agent@example.test')
    fs.writeFileSync(path.join(directory, 'tracked.txt'), 'initial\n')
    await git.add('tracked.txt')
    await git.commit('initial')
    return fs.realpathSync(directory)
  }

  beforeEach(async () => {
    tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coco-agent-context-')))
    repoRoot = await initializeRepo(path.join(tempRoot, 'allowed', 'repo'))
  })

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it('resolves nested paths to the repository root within an allowed boundary', async () => {
    const nested = path.join(repoRoot, 'src', 'nested')
    fs.mkdirSync(nested, { recursive: true })

    const resolvedRepoRoot = await resolveAgentRepoRoot(nested, path.join(tempRoot, 'allowed'))
    expect(isPathWithinRoot(resolvedRepoRoot, repoRoot)).toBe(true)
    expect(isPathWithinRoot(repoRoot, path.join(tempRoot, 'allowed'))).toBe(true)
  })

  it('does not confuse sibling path prefixes with descendants', async () => {
    const allowed = path.join(tempRoot, 'allowed', 'repo')
    const sibling = await initializeRepo(path.join(tempRoot, 'allowed', 'repo-sibling'))

    expect(isPathWithinRoot(sibling, allowed)).toBe(false)
    await expect(resolveAgentRepoRoot(sibling, allowed)).rejects.toMatchObject({
      code: 'REPOSITORY_OUTSIDE_ROOT',
    })
  })

  it('uses real paths so a symlink cannot escape the allowed root', async () => {
    const outside = await initializeRepo(path.join(tempRoot, 'outside'))
    const link = path.join(tempRoot, 'allowed', 'linked-repo')
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')

    expect(resolveAgentDirectoryRoot(link)).toBe(outside)
    await expect(resolveAgentRepoRoot(link, path.join(tempRoot, 'allowed'))).rejects.toMatchObject({
      code: 'REPOSITORY_OUTSIDE_ROOT',
    })
  })

  it('resolves staged repository changes and records repository provenance', async () => {
    fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), 'staged content\n')
    await simpleGit(repoRoot).add('tracked.txt')
    const context = await createAgentOperationContext({ repoRoot })

    const resolved = await resolveChangeSource(
      { kind: 'repository', scope: { type: 'staged' } },
      context,
    )

    expect(resolved.text).toContain('+staged content')
    expect(resolved.meta).toMatchObject({
      kind: 'repository',
      verification: 'repository-derived',
      repositoryHead: await simpleGit(repoRoot).revparse(['HEAD']),
    })
    expect(resolved.meta.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('rejects worktree inspection unless repository configuration is trusted', async () => {
    fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), 'unstaged\n')
    const context = await createAgentOperationContext({ repoRoot })

    await expect(resolveChangeSource(
      { kind: 'repository', scope: { type: 'worktree' } },
      context,
    )).rejects.toMatchObject({ code: 'UNSAFE_SOURCE' })
  })

  it('includes staged, unstaged, and untracked changes for a trusted worktree', async () => {
    fs.writeFileSync(path.join(repoRoot, 'staged.txt'), 'staged\n')
    await simpleGit(repoRoot).add('staged.txt')
    fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), 'unstaged\n')
    fs.writeFileSync(path.join(repoRoot, 'untracked.txt'), 'untracked\n')
    const context = await createAgentOperationContext({ repoRoot })

    const resolved = await resolveChangeSource(
      { kind: 'repository', scope: { type: 'worktree' } },
      context,
      { trustRepositoryConfig: true },
    )

    expect(resolved.text).toContain('Staged changes:')
    expect(resolved.text).toContain('Unstaged changes:')
    expect(resolved.text).toContain('Untracked files:')
    expect(resolved.text).toContain('- untracked.txt')
  })

  it.each([
    { type: 'branch' as const, base: 'does-not-exist' },
    { type: 'range' as const, from: 'HEAD', to: 'does-not-exist' },
    { type: 'branch' as const, base: '-unsafe' },
  ])('returns INVALID_REVISION for unresolved or unsafe refs: %j', async (scope) => {
    const context = await createAgentOperationContext({ repoRoot })
    await expect(resolveChangeSource(
      { kind: 'repository', scope } as ChangeSource,
      context,
    )).rejects.toMatchObject({ code: 'INVALID_REVISION' })
  })

  it('formats supplied summaries and file provenance without reading repository HEAD', async () => {
    const context = await createAgentOperationContext({ repoRoot })
    const resolved = await resolveChangeSource({
      kind: 'summary',
      summary: 'Implemented safe agent transport.',
      files: [{ path: 'src/agent.ts', status: 'added' }],
      provenance: { generatedBy: 'calling-agent' },
    }, context)

    expect(resolved.text).toBe('Implemented safe agent transport.\n\nFiles:\n- added: src/agent.ts')
    expect(resolved.meta).toEqual({
      kind: 'summary',
      digest: `sha256:${createHash('sha256').update(resolved.text).digest('hex')}`,
      repositoryHead: undefined,
      verification: 'provided-unverified',
    })
  })

  it('computes patch digests and marks matching HEAD provenance as verified', async () => {
    const context = await createAgentOperationContext({ repoRoot })
    const head = (await simpleGit(repoRoot).revparse(['HEAD'])).trim()
    const patch = 'diff --git a/a.ts b/a.ts\n+const safe = true\n'

    const resolved = await resolveChangeSource({ kind: 'patch', patch, headRevision: head }, context)

    expect(resolved.meta).toEqual({
      kind: 'patch',
      digest: `sha256:${createHash('sha256').update(patch).digest('hex')}`,
      repositoryHead: head,
      verification: 'head-matched',
    })
  })

  it('reports no changes for blank supplied content', async () => {
    const context = await createAgentOperationContext({ repoRoot })
    await expect(resolveChangeSource(
      { kind: 'summary', summary: '   ' } as ChangeSource,
      context,
    )).rejects.toMatchObject({ code: 'NO_CHANGES' })
  })

  it('enforces the aggregate UTF-8 context limit after formatting files', async () => {
    const context = await createAgentOperationContext({ repoRoot })
    const source = {
      kind: 'files' as const,
      files: [
        { path: 'a.ts', status: 'modified' as const, summary: 'a'.repeat(MAX_AGENT_CONTEXT_BYTES / 2) },
        { path: 'b.ts', status: 'modified' as const, summary: 'b'.repeat(MAX_AGENT_CONTEXT_BYTES / 2) },
      ],
    }

    await expect(resolveChangeSource(source, context)).rejects.toMatchObject({
      code: 'CONTEXT_TOO_LARGE',
    })
  })

  it('fails immediately when the operation is cancelled before source resolution', async () => {
    const controller = new AbortController()
    const context = await createAgentOperationContext({ repoRoot, signal: controller.signal })
    controller.abort()

    await expect(resolveChangeSource(
      { kind: 'summary', summary: 'change' },
      context,
    )).rejects.toEqual(expect.objectContaining<Partial<AgentOperationError>>({
      code: 'CANCELLED',
      retryable: false,
    }))
  })

  it('computes a stable sha256 digest', () => {
    expect(digestOf('hello')).toBe(`sha256:${createHash('sha256').update('hello').digest('hex')}`)
  })

  it('reports repository status including untracked files', async () => {
    fs.writeFileSync(path.join(repoRoot, 'untracked.txt'), 'new\n')
    const context = await createAgentOperationContext({ repoRoot })

    const status = await getRepoStatus(context)

    expect(status).toContain('untracked.txt')
  })

  it('reports the staged diff', async () => {
    fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), 'staged content\n')
    await simpleGit(repoRoot).add('tracked.txt')
    const context = await createAgentOperationContext({ repoRoot })

    const diff = await getStagedDiff(context)

    expect(diff).toContain('+staged content')
  })

  it('reports an empty staged diff when nothing is staged', async () => {
    const context = await createAgentOperationContext({ repoRoot })

    const diff = await getStagedDiff(context)

    expect(diff.trim()).toBe('')
  })

  it('reports the current branch without an upstream', async () => {
    const context = await createAgentOperationContext({ repoRoot })

    const branchContext = await getBranchContext(context)

    expect(branchContext).toContain('Branch:')
    expect(branchContext).toContain('Upstream: none configured')
  })

  it('reports ahead/behind counts against a real diverged upstream', async () => {
    const bareRemote = path.join(tempRoot, 'origin.git')
    await simpleGit(tempRoot).raw(['init', '--bare', bareRemote])

    const git = simpleGit(repoRoot)
    const branchName = (await git.raw(['symbolic-ref', '--short', 'HEAD'])).trim()
    await git.raw(['remote', 'add', 'origin', bareRemote])
    await git.raw(['push', '-u', 'origin', branchName])

    const cloneDir = path.join(tempRoot, 'clone')
    await simpleGit(tempRoot).clone(bareRemote, cloneDir)
    const cloneGit = simpleGit(cloneDir)
    await cloneGit.addConfig('user.name', 'Agent Test')
    await cloneGit.addConfig('user.email', 'agent@example.test')
    fs.writeFileSync(path.join(cloneDir, 'tracked.txt'), 'remote change\n')
    await cloneGit.add('tracked.txt')
    await cloneGit.commit('remote commit')
    await cloneGit.push('origin', branchName)

    for (let index = 0; index < 2; index += 1) {
      fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), `local change ${index}\n`)
      await git.add('tracked.txt')
      await git.commit(`local commit ${index}`)
    }
    await git.fetch('origin', branchName)

    const context = await createAgentOperationContext({ repoRoot })

    const branchContext = await getBranchContext(context)

    expect(branchContext).toContain(`Upstream: origin/${branchName}`)
    expect(branchContext).toContain('Ahead: 2')
    expect(branchContext).toContain('Behind: 1')
  })

  it('labels a genuine git failure while computing counts distinctly from no-upstream', async () => {
    const bareRemote = path.join(tempRoot, 'origin-corrupt.git')
    await simpleGit(tempRoot).raw(['init', '--bare', bareRemote])

    const git = simpleGit(repoRoot)
    const branchName = (await git.raw(['symbolic-ref', '--short', 'HEAD'])).trim()
    await git.raw(['remote', 'add', 'origin', bareRemote])
    await git.raw(['push', '-u', 'origin', branchName])

    // Resolve @{u}'s ref without needing the object it points to, then delete that
    // object from the store so rev-list fails while @{u} itself still resolves.
    const remoteSha = (await git.raw(['rev-parse', `origin/${branchName}`])).trim()
    const objectPath = path.join(repoRoot, '.git', 'objects', remoteSha.slice(0, 2), remoteSha.slice(2))
    fs.rmSync(objectPath)

    const context = await createAgentOperationContext({ repoRoot })

    const branchContext = await getBranchContext(context)

    expect(branchContext).toContain(`Upstream: origin/${branchName}`)
    expect(branchContext).toContain('Ahead/Behind: unavailable (git error)')
    expect(branchContext).not.toContain('Upstream: none configured')
  })

  it('bounds the recent log to the maximum allowed entries', async () => {
    const git = simpleGit(repoRoot)
    for (let index = 0; index < 25; index += 1) {
      fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), `content ${index}\n`)
      await git.add('tracked.txt')
      await git.commit(`commit ${index}`)
    }
    const context = await createAgentOperationContext({ repoRoot })

    const log = await getRecentLog(context, 100)

    expect(log.trim().split('\n')).toHaveLength(20)
  })
})
