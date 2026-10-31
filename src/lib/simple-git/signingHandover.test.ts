import * as childProcess from 'child_process'
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { simpleGit, SimpleGit } from 'simple-git'
import {
  commitWithSigningHandover,
  InteractiveGitError,
  isCommitSigningEnabled,
  registerTerminalHandoff,
  runCommitCommand,
} from './signingHandover'

// Real git runs untouched; only the Enter-to-continue pause is stubbed below.
jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process')
  return { ...actual, spawnSync: jest.fn(actual.spawnSync) }
})
const spawnSyncMock = childProcess.spawnSync as unknown as jest.Mock
const actualSpawnSync = jest.requireActual('child_process').spawnSync as typeof childProcess.spawnSync

/** A git whose `config commit.gpgsign` answers as given (undefined = unset, exit 1). */
function fakeGit(gpgsign: string | undefined): SimpleGit & { raw: jest.Mock; commit: jest.Mock } {
  return {
    raw: jest.fn(async (args: string[]) => {
      if (args[0] === 'config') {
        if (gpgsign === undefined) throw new Error('exit 1')
        return `${gpgsign}\n`
      }
      return 'raw-output'
    }),
    commit: jest.fn(async () => ({ commit: 'abc1234' })),
    revparse: jest.fn(async () => '/repo\n'),
  } as never
}

describe('isCommitSigningEnabled (#2199)', () => {
  it.each([
    ['true', true],
    ['false', false],
    [undefined, false],
  ])('reads commit.gpgsign = %s', async (value, expected) => {
    await expect(isCommitSigningEnabled(fakeGit(value))).resolves.toBe(expected)
  })

  it('lets the commit flags decide over the config', async () => {
    await expect(isCommitSigningEnabled(fakeGit('false'), ['commit', '-S'])).resolves.toBe(true)
    await expect(isCommitSigningEnabled(fakeGit('false'), ['commit', '--gpg-sign=ABCD'])).resolves.toBe(true)
    await expect(isCommitSigningEnabled(fakeGit('true'), ['commit', '--no-gpg-sign'])).resolves.toBe(false)
  })

  it('asks git for the bool form, which predates git 2.18', async () => {
    const git = fakeGit('true')
    await isCommitSigningEnabled(git)
    expect(git.raw).toHaveBeenCalledWith(['config', '--bool', '--get', 'commit.gpgsign'])
  })
})

describe('without a registered terminal handoff', () => {
  afterEach(() => registerTerminalHandoff(undefined))

  it('runs commit commands straight through git and never reads the signing config', async () => {
    const git = fakeGit('true')
    await expect(runCommitCommand(git, ['commit', '--amend', '--no-edit'])).resolves.toBe('raw-output')
    expect(git.raw).toHaveBeenCalledTimes(1)
    await commitWithSigningHandover(git, 'msg', ['--no-verify'])
    expect(git.commit).toHaveBeenCalledWith('msg', ['--no-verify'])
  })

  it('does not hand over when stdin is not a terminal, even if one is registered', async () => {
    const handoff = jest.fn((run: () => unknown) => run())
    registerTerminalHandoff(handoff as never)
    const git = fakeGit('true')
    const isTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
    try {
      await runCommitCommand(git, ['commit', '--amend', '--no-edit'])
    } finally {
      if (isTTY) Object.defineProperty(process.stdin, 'isTTY', isTTY)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
    }
    expect(handoff).not.toHaveBeenCalled()
    expect(git.raw).toHaveBeenLastCalledWith(['commit', '--amend', '--no-edit'])
  })
})

// End to end against real git. A fake `gpg` stands in for the signer: git
// calls it as `gpg --status-fd=2 -bsau <key>` and accepts a status line on
// stderr plus a signature on stdout. It records the GPG_TTY it was given.
describe('a signed commit with the terminal handed over (#2199)', () => {
  let dir: string
  let gpgLog: string
  let git: SimpleGit
  const run = (...args: string[]) => childProcess.execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  const originalGpgTty = process.env.GPG_TTY

  function writeFakeGpg(exitCode: number) {
    const script = join(dir, 'fake-gpg.sh')
    writeFileSync(script, `#!/bin/sh
echo "GPG_TTY=\${GPG_TTY:-unset}" >> "${gpgLog}"
cat > /dev/null
if [ ${exitCode} -ne 0 ]; then echo "gpg: signing failed: No pinentry" >&2; exit ${exitCode}; fi
echo "[GNUPG:] SIG_CREATED D 1 8 00 0 ABCDEF" >&2
echo "-----BEGIN PGP SIGNATURE-----"
echo
echo "AAAA"
echo "-----END PGP SIGNATURE-----"
`)
    chmodSync(script, 0o755)
    run('config', 'gpg.program', script)
  }

  function stubTty(value: boolean) {
    const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true })
    return () => {
      if (original) Object.defineProperty(process.stdin, 'isTTY', original)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
    }
  }

  let restoreTty: () => void
  let handoffCalls: number

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'coco-signing-')))
    gpgLog = join(dir, 'gpg.log')
    run('init', '-q', '-b', 'main')
    run('config', 'user.email', 't@example.com')
    run('config', 'user.name', 't')
    run('config', 'commit.gpgsign', 'true')
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    run('add', 'a.txt')
    git = simpleGit(dir)
    restoreTty = stubTty(true)
    handoffCalls = 0
    registerTerminalHandoff((work) => {
      handoffCalls += 1
      return work()
    })
    process.env.GPG_TTY = '/dev/ttys-test'
    // The Enter-to-continue pause blocks on a terminal: skip it, keep real git.
    spawnSyncMock.mockImplementation(((cmd: string, args: string[], options: object) =>
      cmd === 'sh' || cmd === 'cmd'
        ? ({ status: 0, signal: null } as never)
        : (actualSpawnSync as (...a: unknown[]) => unknown)(cmd, args, options)) as never)
  })

  afterEach(() => {
    spawnSyncMock.mockReset()
    registerTerminalHandoff(undefined)
    restoreTty()
    if (originalGpgTty === undefined) delete process.env.GPG_TTY
    else process.env.GPG_TTY = originalGpgTty
    rmSync(dir, { recursive: true, force: true })
  })

  it('commits through the handover with the terminal named for gpg', async () => {
    writeFakeGpg(0)
    const result = await commitWithSigningHandover(git, 'feat: signed', [])

    expect(handoffCalls).toBe(1)
    expect(result.commit).toBe(run('rev-parse', '--short', 'HEAD').trim())
    expect(run('log', '-1', '--format=%s').trim()).toBe('feat: signed')
    expect(run('cat-file', 'commit', 'HEAD')).toContain('gpgsig')
    expect(readFileSync(gpgLog, 'utf8')).toContain('GPG_TTY=/dev/ttys-test')
  })

  it('amends through the same handover', async () => {
    writeFakeGpg(0)
    await commitWithSigningHandover(git, 'feat: first', [])
    writeFileSync(join(dir, 'a.txt'), 'two\n')
    run('add', 'a.txt')
    await runCommitCommand(git, ['commit', '--amend', '--no-edit'])
    expect(handoffCalls).toBe(2)
    expect(run('rev-list', '--count', 'HEAD').trim()).toBe('1')
    expect(run('cat-file', 'commit', 'HEAD')).toContain('gpgsig')
  })

  it('does not hand over a commit that will not sign', async () => {
    writeFakeGpg(0)
    run('config', 'commit.gpgsign', 'false')
    await commitWithSigningHandover(git, 'chore: unsigned', [])
    expect(handoffCalls).toBe(0)
    expect(run('cat-file', 'commit', 'HEAD')).not.toContain('gpgsig')
  })

  it('reports a failed signing as an InteractiveGitError and pauses so the output can be read', async () => {
    writeFakeGpg(2)
    await expect(commitWithSigningHandover(git, 'feat: nope', [])).rejects.toBeInstanceOf(InteractiveGitError)
    expect(handoffCalls).toBe(1)
    expect(spawnSyncMock.mock.calls.some(([cmd]) => cmd === 'sh' || cmd === 'cmd')).toBe(true)
    // Nothing was committed.
    expect(() => run('rev-parse', '--verify', 'HEAD')).toThrow()
  })

  it('leaves no SIGINT listener behind', async () => {
    writeFakeGpg(0)
    const before = process.listenerCount('SIGINT')
    await commitWithSigningHandover(git, 'feat: signed', [])
    expect(process.listenerCount('SIGINT')).toBe(before)
  })
})
