import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import simpleGit from 'simple-git'
import { Logger } from '../../lib/utils/logger'
import { handler } from './handler'
import { HooksArgv } from './config'

describe('coco hooks <action> (#1591)', () => {
  let repoDir: string
  let originalCwd: string
  let logger: Logger

  beforeEach(async () => {
    originalCwd = process.cwd()
    repoDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coco-hooks-cmd-')))
    await simpleGit(repoDir).init()
    process.chdir(repoDir)
    logger = {
      log: jest.fn(),
      verbose: jest.fn(),
      setConfig: jest.fn(),
      error: jest.fn(),
      startTimer: jest.fn().mockReturnThis(),
      stopTimer: jest.fn(),
      startSpinner: jest.fn().mockReturnThis(),
      stopSpinner: jest.fn(),
    } as unknown as Logger
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(repoDir, { recursive: true, force: true })
  })

  function hookPath(): string {
    return path.join(repoDir, '.git', 'hooks', 'prepare-commit-msg')
  }

  function argv(action: HooksArgv['action']): HooksArgv {
    return { action, $0: 'coco', _: ['hooks'] } as unknown as HooksArgv
  }

  it('install: writes the hook and logs success', async () => {
    await handler(argv('install'), logger)

    expect(fs.existsSync(hookPath())).toBe(true)
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('Installed'),
      expect.objectContaining({ color: 'green' })
    )
  })

  it('install: emits JSON when --json is passed', async () => {
    const writes: string[] = []
    const writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: string) => {
        writes.push(String(chunk))
        return true
      }) as never)
    try {
      await handler({ ...argv('install'), json: true }, logger)
    } finally {
      writeSpy.mockRestore()
    }

    const jsonCall = writes.find((chunk) => {
      try {
        JSON.parse(chunk)
        return true
      } catch {
        return false
      }
    })
    expect(jsonCall).toBeDefined()
    expect(JSON.parse(jsonCall as string)).toEqual(expect.objectContaining({ ok: true }))
  })

  it('install: exits non-zero when it refuses (existing unmanaged backup, no --force)', async () => {
    const hooksDir = path.join(repoDir, '.git', 'hooks')
    fs.mkdirSync(hooksDir, { recursive: true })
    fs.writeFileSync(path.join(hooksDir, 'prepare-commit-msg'), '#!/bin/sh\necho "husky-v2"\n', {
      mode: 0o755,
    })
    fs.writeFileSync(
      path.join(hooksDir, 'prepare-commit-msg.pre-coco'),
      '#!/bin/sh\necho "husky-v1"\n',
      { mode: 0o755 }
    )

    await expect(handler(argv('install'), logger)).rejects.toMatchObject({ code: 1 })
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('--force'),
      expect.objectContaining({ color: 'red' })
    )
  })

  it('uninstall: reports a no-op when nothing is installed', async () => {
    await handler(argv('uninstall'), logger)
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('No prepare-commit-msg hook'),
      expect.anything()
    )
  })

  it('uninstall: removes a previously installed hook', async () => {
    await handler(argv('install'), logger)
    await handler(argv('uninstall'), logger)
    expect(fs.existsSync(hookPath())).toBe(false)
  })

  it('status: reports not installed', async () => {
    await handler(argv('status'), logger)
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('No prepare-commit-msg hook'),
      expect.objectContaining({ color: 'yellow' })
    )
  })

  it('status: reports installed after install, as JSON', async () => {
    await handler(argv('install'), logger)

    const writes: string[] = []
    const writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: string) => {
        writes.push(String(chunk))
        return true
      }) as never)
    try {
      await handler({ ...argv('status'), json: true }, logger)
    } finally {
      writeSpy.mockRestore()
    }

    const jsonCall = writes.find((chunk) => {
      try {
        JSON.parse(chunk)
        return true
      } catch {
        return false
      }
    })
    expect(jsonCall).toBeDefined()
    expect(JSON.parse(jsonCall as string)).toEqual(
      expect.objectContaining({ installed: true, managedByCoco: true })
    )
  })
})
