/**
 * Coverage for #1894: `noResult()` printed the "Changes not staged for
 * commit:" / "Untracked changes:" headings via `logger.log` but the file
 * lists beneath them via `logger.verbose`, which no-ops unless `--verbose`
 * is passed. That left `coco commit` (with only unstaged/untracked work)
 * showing dangling headings with no file names — the actionable part of
 * the message. The lists should always print, regardless of `verbose`.
 */
import { SimpleGit } from 'simple-git'
import { noResult } from './noResult'
import { Logger } from '../../lib/utils/logger'
import { FileChange } from '../../lib/types'

jest.mock('../../lib/simple-git/getChanges')

import { getChanges } from '../../lib/simple-git/getChanges'

const mockedGetChanges = getChanges as jest.MockedFunction<typeof getChanges>

const fileChange = (filePath: string, summary: string): FileChange => ({
  filePath,
  status: 'modified',
  summary,
})

describe('noResult', () => {
  let consoleLogSpy: jest.SpyInstance
  let stderrWriteSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    stderrWriteSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    stderrWriteSpy.mockRestore()
  })

  const loggedLines = () => consoleLogSpy.mock.calls.map((call) => String(call[0])).join('\n')

  it('prints the unstaged heading and file summary without --verbose', async () => {
    mockedGetChanges.mockResolvedValue({
      staged: [],
      unstaged: [fileChange('src/foo.ts', 'modified src/foo.ts')],
      untracked: [],
    })

    await noResult({ git: {} as SimpleGit, logger: new Logger({ verbose: false }) })

    const output = loggedLines()
    expect(output).toContain('Changes not staged for commit:')
    expect(output).toContain('modified src/foo.ts')
  })

  it('prints the untracked heading and file summary without --verbose', async () => {
    mockedGetChanges.mockResolvedValue({
      staged: [],
      unstaged: [],
      untracked: [fileChange('src/bar.ts', 'new file src/bar.ts')],
    })

    await noResult({ git: {} as SimpleGit, logger: new Logger({ verbose: false }) })

    const output = loggedLines()
    expect(output).toContain('Untracked changes:')
    expect(output).toContain('new file src/bar.ts')
  })

  it('prints both headings and both file lists, in order, when unstaged and untracked are both present', async () => {
    mockedGetChanges.mockResolvedValue({
      staged: [],
      unstaged: [fileChange('src/foo.ts', 'modified src/foo.ts')],
      untracked: [fileChange('src/bar.ts', 'new file src/bar.ts')],
    })

    await noResult({ git: {} as SimpleGit, logger: new Logger({ verbose: false }) })

    const output = loggedLines()
    const unstagedHeadingIndex = output.indexOf('Changes not staged for commit:')
    const unstagedListIndex = output.indexOf('modified src/foo.ts')
    const untrackedHeadingIndex = output.indexOf('Untracked changes:')
    const untrackedListIndex = output.indexOf('new file src/bar.ts')

    expect(unstagedHeadingIndex).toBeGreaterThan(-1)
    expect(unstagedListIndex).toBeGreaterThan(unstagedHeadingIndex)
    expect(untrackedHeadingIndex).toBeGreaterThan(unstagedListIndex)
    expect(untrackedListIndex).toBeGreaterThan(untrackedHeadingIndex)
  })

  it('does not touch the staged (large-diff / ignored-file) branch', async () => {
    mockedGetChanges.mockResolvedValue({
      staged: [fileChange('src/big.ts', 'modified src/big.ts')],
      unstaged: [],
      untracked: [],
    })

    await noResult({ git: {} as SimpleGit, logger: new Logger({ verbose: false }) })

    expect(stderrWriteSpy).toHaveBeenCalledWith(
      expect.stringContaining('Staged files detected, but no summary generated')
    )
    const output = loggedLines()
    expect(output).toContain('Files are likely either')
    expect(output).not.toContain('src/big.ts')
  })

  it('prints the "no changes" message when nothing has changed', async () => {
    mockedGetChanges.mockResolvedValue({
      staged: [],
      unstaged: [],
      untracked: [],
    })

    await noResult({ git: {} as SimpleGit, logger: new Logger({ verbose: false }) })

    expect(loggedLines()).toContain('No repo changes detected. 👀')
  })
})
