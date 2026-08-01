import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import simpleGit from 'simple-git'

import {
    createAgentOperationContext,
    digestOf,
    getBranchContext,
    getConventionsContext,
    getRecentLog,
    getRepoStatus,
    getStagedDiff,
    isPathWithinRoot,
    resolveAgentDirectoryRoot,
    resolveAgentRepoRoot,
    resolveChangeSource,
    resolveProjectConventions,
} from './context'
import { AgentOperationError } from './errors'
import { ChangeSource, MAX_AGENT_CONTEXT_BYTES, MAX_CONVENTIONS_BYTES } from './schemas'

jest.setTimeout(20000)

describe('agent repository context', () => {
  let tempRoot: string
  let repoRoot: string

  function configureCleanFilter(directory: string, filterName: string, command: string): void {
    // simple-git blocks configuring filter.*.clean for safety; use the git binary directly.
    execFileSync('git', ['config', `filter.${filterName}.clean`, command], { cwd: directory })
  }

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

  it('allows worktree inspection when the repository defines no clean filters', async () => {
    fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), 'unstaged\n')
    const context = await createAgentOperationContext({ repoRoot })

    const resolved = await resolveChangeSource(
      { kind: 'repository', scope: { type: 'worktree' } },
      context,
    )

    expect(resolved.text).toContain('Unstaged changes:')
  })

  it('rejects worktree inspection when a clean filter is configured and assigned to a tracked path', async () => {
    const git = simpleGit(repoRoot)
    configureCleanFilter(repoRoot, 'secret', 'cat')
    fs.writeFileSync(path.join(repoRoot, '.gitattributes'), 'tracked.txt filter=secret\n')
    await git.add('.gitattributes')
    await git.commit('assign clean filter')
    fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), 'unstaged\n')
    const context = await createAgentOperationContext({ repoRoot })

    await expect(resolveChangeSource(
      { kind: 'repository', scope: { type: 'worktree' } },
      context,
    )).rejects.toMatchObject({
      code: 'UNSAFE_SOURCE',
      message: expect.stringContaining('filter.secret.clean'),
    })
  })

  it('fails closed when the clean filter probe cannot be verified due to a git config error', async () => {
    fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), 'unstaged\n')
    const context = await createAgentOperationContext({ repoRoot })
    fs.appendFileSync(path.join(repoRoot, '.git', 'config'), '[bad\n')

    await expect(resolveChangeSource(
      { kind: 'repository', scope: { type: 'worktree' } },
      context,
    )).rejects.toMatchObject({
      code: 'UNSAFE_SOURCE',
      message: expect.stringContaining('Could not verify'),
    })
  })

  it('allows worktree inspection when a clean filter is configured but not assigned to any path', async () => {
    configureCleanFilter(repoRoot, 'secret', 'cat')
    fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), 'unstaged\n')
    const context = await createAgentOperationContext({ repoRoot })

    const resolved = await resolveChangeSource(
      { kind: 'repository', scope: { type: 'worktree' } },
      context,
    )

    expect(resolved.text).toContain('Unstaged changes:')
  })

  it('bypasses the clean filter probe when repository configuration is trusted', async () => {
    const git = simpleGit(repoRoot)
    configureCleanFilter(repoRoot, 'secret', 'cat')
    fs.writeFileSync(path.join(repoRoot, '.gitattributes'), 'tracked.txt filter=secret\n')
    await git.add('.gitattributes')
    await git.commit('assign clean filter')
    fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), 'unstaged\n')
    const context = await createAgentOperationContext({ repoRoot })

    const resolved = await resolveChangeSource(
      { kind: 'repository', scope: { type: 'worktree' } },
      context,
      { trustRepositoryConfig: true },
    )

    expect(resolved.text).toContain('Unstaged changes:')
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

  it('stores the supplied onProgress reporter on the context', async () => {
    const onProgress = jest.fn()
    const context = await createAgentOperationContext({ repoRoot, onProgress })

    expect(context.onProgress).toBe(onProgress)
  })

  it('leaves onProgress undefined when the caller does not supply one', async () => {
    const context = await createAgentOperationContext({ repoRoot })

    expect(context.onProgress).toBeUndefined()
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

describe('resolveProjectConventions', () => {
  let tempRoot: string
  let repoRoot: string

  beforeEach(() => {
    tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coco-agent-conventions-')))
    repoRoot = path.join(tempRoot, 'repo')
    fs.mkdirSync(repoRoot, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it('returns null when no convention files exist', () => {
    expect(resolveProjectConventions(repoRoot)).toBeNull()
  })

  it('reads the allowlisted files and orders AGENTS.md, CLAUDE.md, CONTRIBUTING.md, then steering docs', () => {
    fs.writeFileSync(path.join(repoRoot, 'CONTRIBUTING.md'), 'Contributing guide.')
    fs.writeFileSync(path.join(repoRoot, 'AGENTS.md'), 'House style.')
    fs.writeFileSync(path.join(repoRoot, 'CLAUDE.md'), 'Claude steering.')
    fs.mkdirSync(path.join(repoRoot, '.kiro', 'steering'), { recursive: true })
    fs.writeFileSync(path.join(repoRoot, '.kiro', 'steering', 'b-second.md'), 'Second steering doc.')
    fs.writeFileSync(path.join(repoRoot, '.kiro', 'steering', 'a-first.md'), 'First steering doc.')

    const conventions = resolveProjectConventions(repoRoot)

    expect(conventions).not.toBeNull()
    expect(conventions!.files).toEqual([
      'AGENTS.md',
      'CLAUDE.md',
      'CONTRIBUTING.md',
      '.kiro/steering/a-first.md',
      '.kiro/steering/b-second.md',
    ])
    expect(conventions!.text).toContain('House style.')
    expect(conventions!.text).toContain('Claude steering.')
    expect(conventions!.text).toContain('Contributing guide.')
    expect(conventions!.text).toContain('First steering doc.')
    expect(conventions!.text.indexOf('First steering doc.')).toBeLessThan(
      conventions!.text.indexOf('Second steering doc.')
    )
    expect(conventions!.digest).toBe(
      `sha256:${createHash('sha256').update(conventions!.text).digest('hex')}`
    )
  })

  it('produces a stable digest for identical content', () => {
    fs.writeFileSync(path.join(repoRoot, 'AGENTS.md'), 'House style.')

    const first = resolveProjectConventions(repoRoot)
    const second = resolveProjectConventions(repoRoot)

    expect(first!.digest).toBe(second!.digest)
  })

  it('truncates combined content to the byte budget', () => {
    fs.writeFileSync(path.join(repoRoot, 'AGENTS.md'), 'a'.repeat(MAX_CONVENTIONS_BYTES))
    fs.writeFileSync(path.join(repoRoot, 'CLAUDE.md'), 'b'.repeat(MAX_CONVENTIONS_BYTES))

    const conventions = resolveProjectConventions(repoRoot)

    expect(conventions).not.toBeNull()
    expect(Buffer.byteLength(conventions!.text, 'utf8')).toBeLessThanOrEqual(MAX_CONVENTIONS_BYTES)
  })

  it('honors the byte budget when joining several small files that individually fit', () => {
    // The first two files are tiny, leaving most of the budget for the third.
    // Its content is large enough to be truncated to exactly fill whatever
    // budget remains -- so if the '\n\n' join separators between all three
    // sections aren't reserved up front, the final joined text overflows
    // MAX_CONVENTIONS_BYTES by the separator bytes.
    fs.writeFileSync(path.join(repoRoot, 'AGENTS.md'), 'a')
    fs.writeFileSync(path.join(repoRoot, 'CLAUDE.md'), 'b')
    fs.writeFileSync(path.join(repoRoot, 'CONTRIBUTING.md'), 'c'.repeat(MAX_CONVENTIONS_BYTES))

    const conventions = resolveProjectConventions(repoRoot)

    expect(conventions).not.toBeNull()
    expect(conventions!.files).toEqual(['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md'])
    expect(Buffer.byteLength(conventions!.text, 'utf8')).toBeLessThanOrEqual(MAX_CONVENTIONS_BYTES)
  })

  it('excludes a symlinked steering file that escapes the repository root', () => {
    const outside = path.join(tempRoot, 'outside.md')
    fs.writeFileSync(outside, 'Should not be read.')
    fs.mkdirSync(path.join(repoRoot, '.kiro', 'steering'), { recursive: true })
    fs.symlinkSync(
      outside,
      path.join(repoRoot, '.kiro', 'steering', 'escape.md'),
      process.platform === 'win32' ? 'file' : undefined
    )

    expect(resolveProjectConventions(repoRoot)).toBeNull()
  })
})

describe('getConventionsContext', () => {
  let tempRoot: string
  let repoRoot: string

  beforeEach(() => {
    tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coco-agent-conventions-gate-')))
    repoRoot = path.join(tempRoot, 'repo')
    fs.mkdirSync(repoRoot, { recursive: true })
    fs.writeFileSync(path.join(repoRoot, 'AGENTS.md'), 'House style.')
  })

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it('returns empty text and null provenance when repository configuration is not trusted', () => {
    expect(getConventionsContext(repoRoot, false)).toEqual({ text: '', provenance: null })
    expect(getConventionsContext(repoRoot, undefined)).toEqual({ text: '', provenance: null })
  })

  it('returns non-empty guidance text and matching provenance when trusted and conventions exist', () => {
    const result = getConventionsContext(repoRoot, true)
    const conventions = resolveProjectConventions(repoRoot)

    expect(result.text).toContain('House style.')
    expect(result.provenance).not.toBeNull()
    expect(result.provenance!.digest).toBe(conventions!.digest)
    expect(result.provenance!.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.provenance!.files).toEqual(conventions!.files)
  })

  it('returns empty text and null provenance when trusted but no convention files exist', () => {
    const emptyRoot = path.join(tempRoot, 'empty-repo')
    fs.mkdirSync(emptyRoot, { recursive: true })
    expect(getConventionsContext(emptyRoot, true)).toEqual({ text: '', provenance: null })
  })
})
