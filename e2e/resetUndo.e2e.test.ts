/**
 * Golden journey: hard-reset a branch back, then reflog-powered undo
 * restores it (#1643). Proves the 0.81 undo story (#1361 global `z`)
 * end-to-end through a real `git reset --hard` + `git reset` recovery,
 * not just the unit-level reflog parsing.
 */
import { createScenarioRepo, type ScenarioRepo } from './fixtures'
import { launchTui, type TuiSession } from './ptyHarness'

describe('reset + undo', () => {
  let repo: ScenarioRepo
  let tui: TuiSession

  beforeAll(async () => {
    repo = await createScenarioRepo('multi-commit-branch')
    tui = await launchTui({ cwd: repo.path })
    await tui.waitForReady('Commits *')
  })

  afterAll(async () => {
    await tui?.close()
    await repo?.cleanup()
  })

  /** Press one key and let the screen settle before the next — batching
   * keystrokes with no render yield in between has been flaky here. */
  async function pressAndSettle(key: string): Promise<void> {
    tui.press(key)
    await tui.waitForIdle()
  }

  const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  it('boots on feat/dashboard with its full 10-commit history', async () => {
    const screen = await tui.waitForText('10 commits')
    expect(screen).toContain('⎇ feat/dashboard')
  })

  it('Z opens the reset mode picker for the cursored commit', async () => {
    await pressAndSettle('j')
    await pressAndSettle('j')
    tui.press('Z')
    const screen = await tui.waitForText('Reset branch tip')
    expect(screen).toContain('Hard')
    expect(screen).toContain('Soft')
    expect(screen).toContain('Mixed')
  })

  it('h then y resets --hard to the cursored commit, dropping the two above it', async () => {
    tui.press('h')
    // A destructive choice option no longer runs on one keypress (#2169): the
    // picker hands off to a y/n confirm that names the commit and the command.
    const confirm = await tui.waitForText('Press y to confirm')
    expect(confirm).toContain('git reset --hard')
    tui.press('y')
    // Wait for the header count AND the status toast together. Their order
    // depends on how long the refresh takes (about 1.5 s on a busy machine),
    // so waiting on either alone and then reading the other is a race. The
    // header count is the gate for the next test: it needs that refresh to
    // have landed. (The undo description is re-asked there regardless.)
    const screen = await tui.waitFor(
      (text) => text.includes('8 commits') && text.includes('Reset current branch to'),
      'the header to show 8 commits and the reset toast'
    )
    expect(screen).toContain('--hard')
    expect(screen).not.toContain('feat: add dashboard export-to-csv')
  })

  it('z surfaces the global reflog undo for the reset it just did', async () => {
    // The undo description comes from the reflog context, which is reloaded by
    // the refresh that follows the reset. That reload runs about 14 git
    // loaders in parallel and took 1.5 s on a busy machine, so for a moment
    // after the header shows 8 commits `z` still describes the previous
    // operation (the last commit). A fixed delay is either too long or too
    // short, so ask until the panel names the reset, cancelling the stale ones.
    let screen = ''
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      tui.press('z')
      screen = await tui.waitForText('Undo last operation')
      if (screen.includes('Undo reset')) break
      tui.press('n')
      await tui.waitForIdle()
      await delay(400)
    }
    expect(screen).toContain('Undo reset')
    expect(screen).toContain('Press y to confirm')
  })

  it('y confirms — the branch tip is restored to its pre-reset state', async () => {
    tui.press('y')
    const screen = await tui.waitForText('10 commits')
    expect(screen).toContain('Reset to the previous HEAD')
    expect(screen).toContain('feat: add dashboard export-to-csv')
  })
})
