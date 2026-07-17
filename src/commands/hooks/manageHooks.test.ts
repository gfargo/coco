import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import simpleGit, { SimpleGit } from 'simple-git'
import { getHooksStatus, HOOK_MARKER, installHooks, uninstallHooks } from './manageHooks'

describe('manageHooks (#1591)', () => {
  let repoDir: string
  let git: SimpleGit
  let originalCwd: string

  beforeEach(async () => {
    originalCwd = process.cwd()
    repoDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coco-hooks-')))
    git = simpleGit(repoDir)
    await git.init()
    // `resolveHooksDir` resolves `git rev-parse --git-path hooks`'s output
    // against `process.cwd()` — the same invariant `applyRepoFlag` maintains
    // in production (it chdir's before any command touches git). Match that
    // invariant here instead of relying on a mismatched SimpleGit baseDir.
    process.chdir(repoDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(repoDir, { recursive: true, force: true })
  })

  function hookPath(): string {
    return path.join(repoDir, '.git', 'hooks', 'prepare-commit-msg')
  }

  function backupPath(): string {
    return path.join(repoDir, '.git', 'hooks', 'prepare-commit-msg.pre-coco')
  }

  it('installs the hook when none exists', async () => {
    const result = await installHooks({ git })

    expect(result.ok).toBe(true)
    expect(fs.existsSync(hookPath())).toBe(true)
    const content = fs.readFileSync(hookPath(), 'utf8')
    expect(content).toContain(HOOK_MARKER)
    expect(fs.existsSync(backupPath())).toBe(false)
  })

  it('is idempotent when re-installing over its own hook', async () => {
    await installHooks({ git })
    const result = await installHooks({ git })

    expect(result.ok).toBe(true)
    expect(fs.existsSync(backupPath())).toBe(false)
  })

  it('backs up a pre-existing unmanaged hook instead of clobbering it', async () => {
    fs.mkdirSync(path.join(repoDir, '.git', 'hooks'), { recursive: true })
    fs.writeFileSync(hookPath(), '#!/bin/sh\necho "husky"\n', { mode: 0o755 })

    const result = await installHooks({ git })

    expect(result.ok).toBe(true)
    expect(result.message).toContain('backed up')
    expect(fs.readFileSync(backupPath(), 'utf8')).toContain('husky')
    expect(fs.readFileSync(hookPath(), 'utf8')).toContain(HOOK_MARKER)
  })

  it('refuses to overwrite an existing backup without --force', async () => {
    fs.mkdirSync(path.join(repoDir, '.git', 'hooks'), { recursive: true })
    fs.writeFileSync(hookPath(), '#!/bin/sh\necho "husky-v2"\n', { mode: 0o755 })
    fs.writeFileSync(backupPath(), '#!/bin/sh\necho "husky-v1"\n', { mode: 0o755 })

    const result = await installHooks({ git })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('--force')
    // Neither file touched.
    expect(fs.readFileSync(backupPath(), 'utf8')).toContain('husky-v1')
    expect(fs.readFileSync(hookPath(), 'utf8')).toContain('husky-v2')
  })

  it('overwrites an existing backup with --force', async () => {
    fs.mkdirSync(path.join(repoDir, '.git', 'hooks'), { recursive: true })
    fs.writeFileSync(hookPath(), '#!/bin/sh\necho "husky-v2"\n', { mode: 0o755 })
    fs.writeFileSync(backupPath(), '#!/bin/sh\necho "husky-v1"\n', { mode: 0o755 })

    const result = await installHooks({ git, force: true })

    expect(result.ok).toBe(true)
    expect(fs.readFileSync(backupPath(), 'utf8')).toContain('husky-v2')
    expect(fs.readFileSync(hookPath(), 'utf8')).toContain(HOOK_MARKER)
  })

  it('refuses to install over a symlinked hook without --force', async () => {
    fs.mkdirSync(path.join(repoDir, '.git', 'hooks'), { recursive: true })
    const dispatcherPath = path.join(repoDir, 'dispatch.sh')
    fs.writeFileSync(dispatcherPath, '#!/bin/sh\necho "dispatch"\n', { mode: 0o755 })
    fs.symlinkSync(dispatcherPath, hookPath())

    const result = await installHooks({ git })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('symlink')
    expect(result.message).toContain('--force')
    // The symlink and its shared target are both left untouched.
    expect(fs.lstatSync(hookPath()).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(dispatcherPath, 'utf8')).toContain('dispatch')
  })

  it('replaces a symlinked hook with --force without corrupting its shared target', async () => {
    fs.mkdirSync(path.join(repoDir, '.git', 'hooks'), { recursive: true })
    const dispatcherPath = path.join(repoDir, 'dispatch.sh')
    fs.writeFileSync(dispatcherPath, '#!/bin/sh\necho "dispatch"\n', { mode: 0o755 })
    fs.symlinkSync(dispatcherPath, hookPath())

    const result = await installHooks({ git, force: true })

    expect(result.ok).toBe(true)
    // hookPath is now a regular, coco-managed file — the symlink is gone.
    expect(fs.lstatSync(hookPath()).isSymbolicLink()).toBe(false)
    expect(fs.readFileSync(hookPath(), 'utf8')).toContain(HOOK_MARKER)
    // The shared dispatcher script other hooks still symlink to is untouched.
    expect(fs.readFileSync(dispatcherPath, 'utf8')).toContain('dispatch')
    // Its original content was preserved for restoration on uninstall.
    expect(fs.readFileSync(backupPath(), 'utf8')).toContain('dispatch')
  })

  it('reports not-installed status before installing', async () => {
    const status = await getHooksStatus({ git })
    expect(status.installed).toBe(false)
    expect(status.managedByCoco).toBe(false)
  })

  it('reports managed status after installing', async () => {
    await installHooks({ git })
    const status = await getHooksStatus({ git })
    expect(status.installed).toBe(true)
    expect(status.managedByCoco).toBe(true)
  })

  it('reports unmanaged status for a foreign hook', async () => {
    fs.mkdirSync(path.join(repoDir, '.git', 'hooks'), { recursive: true })
    fs.writeFileSync(hookPath(), '#!/bin/sh\necho "husky"\n', { mode: 0o755 })

    const status = await getHooksStatus({ git })
    expect(status.installed).toBe(true)
    expect(status.managedByCoco).toBe(false)
  })

  it('uninstalls the hook and restores a backed-up one', async () => {
    fs.mkdirSync(path.join(repoDir, '.git', 'hooks'), { recursive: true })
    fs.writeFileSync(hookPath(), '#!/bin/sh\necho "husky"\n', { mode: 0o755 })

    await installHooks({ git })
    const result = await uninstallHooks({ git })

    expect(result.ok).toBe(true)
    expect(result.message).toContain('restored')
    expect(fs.readFileSync(hookPath(), 'utf8')).toContain('husky')
    expect(fs.existsSync(backupPath())).toBe(false)
  })

  it('uninstalls cleanly when there was nothing to restore', async () => {
    await installHooks({ git })
    const result = await uninstallHooks({ git })

    expect(result.ok).toBe(true)
    expect(fs.existsSync(hookPath())).toBe(false)
  })

  it('is a no-op when uninstalling with nothing installed', async () => {
    const result = await uninstallHooks({ git })
    expect(result.ok).toBe(true)
    expect(result.message).toContain('No prepare-commit-msg hook')
  })

  it('refuses to remove a foreign hook it did not install', async () => {
    fs.mkdirSync(path.join(repoDir, '.git', 'hooks'), { recursive: true })
    fs.writeFileSync(hookPath(), '#!/bin/sh\necho "husky"\n', { mode: 0o755 })

    const result = await uninstallHooks({ git })

    expect(result.ok).toBe(false)
    expect(fs.existsSync(hookPath())).toBe(true)
  })
})
