/**
 * Golden journey: multi-select batch branch delete, plus the protected
 * current-branch refusal (#1643). Against `branch-sync-showcase` (five
 * local branches in five upstream-sync states), mark two non-current
 * branches and batch-delete them — one deletes cleanly, the other isn't
 * fully merged and needs its own force-confirm — then in a second pass,
 * confirm the current branch refuses to delete even when marked.
 */
import { createScenarioRepo, type ScenarioRepo } from './fixtures'
import { launchTui, type TuiSession } from './ptyHarness'

describe('batch branch delete', () => {
  let repo: ScenarioRepo
  let tui: TuiSession

  beforeAll(async () => {
    repo = await createScenarioRepo('branch-sync-showcase')
    tui = await launchTui({ cwd: repo.path })
    await tui.waitForReady('Commits *')
    tui.press('g', 'b')
    await tui.waitForText('5/5 local')
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

  it('x marks feat/synced and local-only for batch delete', async () => {
    // Cursor starts on `main` (current, top row); walk down past
    // feat/ahead-only and feat/diverged to feat/synced.
    await pressAndSettle('j')
    await pressAndSettle('j')
    await pressAndSettle('j')
    tui.press('x')
    let screen = await tui.waitForText('1 marked')
    expect(screen).toContain('feat/synced')

    await pressAndSettle('j')
    tui.press('x')
    screen = await tui.waitForText('2 marked')
    expect(screen).toContain('local-only')
  })

  it('D confirms a multi-target delete listing both marked branches', async () => {
    tui.press('D')
    const screen = await tui.waitForText('Delete branch')
    expect(screen).toContain('2 branches')
    expect(screen).toContain('Press y to confirm')
  })

  it('y deletes the fully-merged branch and offers a force-confirm for the unmerged one', async () => {
    tui.press('y')
    const screen = await tui.waitForText('Force-delete branch')
    expect(screen).toContain('local-only')
    expect(screen).toContain('Not fully merged')
  })

  it('y force-confirms — both branches are gone', async () => {
    tui.press('y')
    const screen = await tui.waitForText('3/3 local')
    expect(screen).not.toContain('feat/synced')
    expect(screen).not.toContain('local-only')
  })

  it('marking and attempting to delete the current branch is refused, not silently dropped', async () => {
    // The cursor doesn't reset to the top on this refresh — it stays
    // wherever it last was, clamped against the just-shrunk list, and
    // exactly where that clamps to isn't deterministic across runs. `k`
    // at row 0 is a no-op, so pressing it more times than any possible
    // list length reliably lands on `main` regardless of start position.
    for (let i = 0; i < 5; i++) await pressAndSettle('k')
    const screen = tui.snapshot()
    expect(screen).toContain('> * main')

    await pressAndSettle('x')
    tui.press('D')
    await tui.waitForText('Delete branch')
    tui.press('y')
    const result = await tui.waitForText('Cannot delete the current branch')
    expect(result).toContain('3/3 local')
  })
})
