import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { startCocoUi } from './handler'
import type { UiArgv } from './config'
import { startInkInteractiveLog } from '../../workstation/runtime/inkRuntime'
import { isCommandExitError } from '../../lib/utils/commandExit'

jest.mock('../../workstation/runtime/inkRuntime', () => ({
  startInkInteractiveLog: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../workstation/chrome/overviewCache', () => ({
  readCachedCommits: jest.fn().mockReturnValue(undefined),
  writeCachedCommits: jest.fn(),
}))

const mockedStart = startInkInteractiveLog as jest.MockedFunction<typeof startInkInteractiveLog>

const argvFor = (repo: string) =>
  ({ $0: 'coco', _: ['ui'], repo, all: true, interactive: false, verbose: false, version: false, help: false, view: 'history' }) as unknown as UiArgv

// #2205 — `coco ui` must refuse a directory it cannot drive, instead of
// opening a TUI full of errors; and #2199/#2201 — the direct `coco ui`
// path (not only the workspace drill-in) installs the headless git guards.
describe('startCocoUi preflight (#2205)', () => {
  let dir: string
  let originalCwd: string
  let stderr: jest.SpyInstance

  beforeEach(() => {
    originalCwd = process.cwd()
    dir = mkdtempSync(join(tmpdir(), 'coco-ui-preflight-'))
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    mockedStart.mockClear()
  })
  afterEach(() => {
    process.chdir(originalCwd)
    stderr.mockRestore()
    delete process.env.GIT_TERMINAL_PROMPT
    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses a bare repository before mounting the TUI', async () => {
    execFileSync('git', ['init', '-q', '--bare'], { cwd: dir })

    const error = await startCocoUi(argvFor(dir)).catch((e) => e)

    expect(isCommandExitError(error) && error.code).toBe(1)
    expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/bare repository/))
    expect(mockedStart).not.toHaveBeenCalled()
  })

  it('starts in a normal repo with the headless git guards installed', async () => {
    execFileSync('git', ['init', '-q'], { cwd: dir })

    await startCocoUi(argvFor(dir))

    expect(mockedStart).toHaveBeenCalledTimes(1)
    expect(process.env.GIT_TERMINAL_PROMPT).toBe('0')
  })
})
