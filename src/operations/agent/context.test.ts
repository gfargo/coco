import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import simpleGit from 'simple-git'

import {
    createAgentOperationContext,
    getConventionsContext,
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

  it('returns an empty string when repository configuration is not trusted', () => {
    expect(getConventionsContext(repoRoot, false)).toBe('')
    expect(getConventionsContext(repoRoot, undefined)).toBe('')
  })

  it('returns non-empty guidance text when trusted and conventions exist', () => {
    const result = getConventionsContext(repoRoot, true)
    expect(result).toContain('House style.')
  })

  it('returns an empty string when trusted but no convention files exist', () => {
    const emptyRoot = path.join(tempRoot, 'empty-repo')
    fs.mkdirSync(emptyRoot, { recursive: true })
    expect(getConventionsContext(emptyRoot, true)).toBe('')
  })
})
