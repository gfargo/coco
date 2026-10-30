/**
 * #2041 — source shorthands expand against a real repository.
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createAgentOperationContext, expandChangeSource } from './context'
import { AgentTaskInputSchema, ChangeSourceShorthandSchema } from './schemas'

jest.setTimeout(30_000)

describe('expandChangeSource', () => {
  let dir: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  const expand = async (source: string) =>
    expandChangeSource(source, await createAgentOperationContext({ repoRoot: dir }))

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coco-shorthand-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 't@example.com')
    git('config', 'user.name', 't')
    git('commit', '-q', '--allow-empty', '-m', 'one')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it.each([
    ['staged', { type: 'staged' }],
    ['worktree', { type: 'worktree' }],
    ['branch', { type: 'branch', base: 'main' }],
    ['branch:develop', { type: 'branch', base: 'develop' }],
    ['HEAD~3', { type: 'branch', base: 'HEAD~3' }],
  ])('expands %s', async (shorthand, scope) => {
    await expect(expand(shorthand)).resolves.toEqual({ kind: 'repository', scope })
  })

  it('uses origin/HEAD for "branch" when it is set', async () => {
    git('update-ref', 'refs/remotes/origin/trunk', 'HEAD')
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
    await expect(expand('branch')).resolves.toEqual({ kind: 'repository', scope: { type: 'branch', base: 'origin/trunk' } })
  })

  it('expands since-last-tag to a range from the most recent tag', async () => {
    git('tag', 'v1.0.0')
    git('commit', '-q', '--allow-empty', '-m', 'two')
    await expect(expand('since-last-tag')).resolves.toEqual({
      kind: 'repository',
      scope: { type: 'range', from: 'v1.0.0', to: 'HEAD' },
    })
  })

  it('reports INVALID_REVISION for since-last-tag without a tag', async () => {
    await expect(expand('since-last-tag')).rejects.toMatchObject({ code: 'INVALID_REVISION' })
  })

  it('passes an object source through unchanged', async () => {
    const source = { kind: 'summary' as const, summary: 'x' }
    await expect(expandChangeSource(source, await createAgentOperationContext({ repoRoot: dir }))).resolves.toBe(source)
  })
})

describe('source shorthand schema', () => {
  it.each(['staged', 'worktree', 'since-last-tag', 'branch', 'branch:release/1.2', 'HEAD~12'])('accepts %s', (value) => {
    expect(ChangeSourceShorthandSchema.safeParse(value).success).toBe(true)
    expect(AgentTaskInputSchema.safeParse({ source: value }).success).toBe(true)
  })

  it.each(['yesterday', 'branch:-x', 'HEAD~', 'HEAD^2', ''])('rejects %p and lists the options', (value) => {
    const result = AgentTaskInputSchema.safeParse({ source: value })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('since-last-tag')
  })

  it('still accepts the object form', () => {
    expect(AgentTaskInputSchema.safeParse({ source: { kind: 'repository', scope: { type: 'staged' } } }).success).toBe(true)
  })
})
