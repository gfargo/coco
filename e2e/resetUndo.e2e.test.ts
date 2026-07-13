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

  it('h resets --hard to the cursored commit, dropping the two above it', async () => {
    tui.press('h')
    // Gate on the header count, not the status toast — the toast paints a
    // beat before the header/reflog-undo-description refresh lands, and
    // the next test's `z` needs that refresh to have already happened.
    const screen = await tui.waitForText('8 commits')
    expect(screen).toContain('Reset current branch to')
    expect(screen).toContain('--hard')
    expect(screen).not.toContain('feat: add dashboard export-to-csv')
  })

  it('z surfaces the global reflog undo for the reset it just did', async () => {
    // The reflog context refetches off a debounced fs.watch (250ms) on
    // .git/logs/HEAD, independent of the header count's own refresh —
    // give it room to land before z reads context.reflogUndoDescription,
    // or it can still describe the entry from before this reset.
    await delay(800)
    tui.press('z')
    const screen = await tui.waitForText('Undo last operation')
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
