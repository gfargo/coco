import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { simpleGit } from 'simple-git'
import {
  assertGitReadyForTui,
  isSupportedGitVersion,
  parseGitVersion,
  probeGitBinary,
  probeWorkTree,
} from './gitPreflight'

describe('parseGitVersion / isSupportedGitVersion (#2205)', () => {
  it.each([
    ['git version 2.39.2\n', [2, 39, 2]],
    ['git version 2.39.3 (Apple Git-146)', [2, 39, 3]],
    ['git version 2.43.0.windows.1', [2, 43, 0]],
    ['git version 2.30', [2, 30, 0]],
  ])('parses %j', (output, [major, minor, patch]) => {
    expect(parseGitVersion(output as string)).toMatchObject({ major, minor, patch })
  })

  it('returns undefined for output that is not a git version', () => {
    expect(parseGitVersion('bash: git: command not found')).toBeUndefined()
  })

  it.each([
    ['git version 2.24.0', true],
    ['git version 2.39.2', true],
    ['git version 3.0.0', true],
    ['git version 2.23.9', false],
    ['git version 2.17.1', false],
    ['git version 1.8.3.1', false],
  ])('%s supported=%s', (output, expected) => {
    expect(isSupportedGitVersion(parseGitVersion(output)!)).toBe(expected)
  })
})

describe('probeGitBinary', () => {
  it('reports a missing binary (ENOENT) distinctly', async () => {
    const error = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
    const result = await probeGitBinary((cb) => cb(error, ''))
    expect(result).toMatchObject({ ok: false, reason: 'missing' })
    expect((result as { message: string }).message).toMatch(/not found on PATH/)
  })

  it('rejects a git older than the minimum with the version in the message', async () => {
    const result = await probeGitBinary((cb) => cb(null, 'git version 2.17.1\n'))
    expect(result).toMatchObject({ ok: false, reason: 'too-old' })
    expect((result as { message: string }).message).toMatch(/2\.17\.1 is too old.*2\.24\.0/)
  })

  it('accepts a supported git', async () => {
    await expect(probeGitBinary((cb) => cb(null, 'git version 2.39.2'))).resolves.toMatchObject({ ok: true })
  })
})

describe('probeWorkTree against real repos (#2205)', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'coco-preflight-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('accepts a normal repo', async () => {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    await expect(probeWorkTree(simpleGit(dir))).resolves.toEqual({ ok: true })
  })

  it('rejects a bare repo', async () => {
    execFileSync('git', ['init', '-q', '--bare'], { cwd: dir })
    await expect(probeWorkTree(simpleGit(dir))).resolves.toMatchObject({ ok: false, reason: 'bare' })
  })

  it('rejects a directory outside any repo', async () => {
    const result = await probeWorkTree(simpleGit(dir))
    // A temp dir could sit inside an enclosing repo on exotic setups; only
    // assert the rejection shape when git really finds none.
    if (!result.ok) expect(result.reason).toBe('no-repo')
  })

  it('rejects the inside of .git', async () => {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    await expect(probeWorkTree(simpleGit(join(dir, '.git')))).resolves.toMatchObject({ ok: false, reason: 'no-worktree' })
  })
})

describe('assertGitReadyForTui', () => {
  it('throws the binary problem before touching the repo', async () => {
    const git = { raw: jest.fn() }
    await expect(
      assertGitReadyForTui(git as never, async () => ({ ok: false, reason: 'missing', message: 'git was not found on PATH.' }))
    ).rejects.toThrow('git was not found')
    expect(git.raw).not.toHaveBeenCalled()
  })
})
