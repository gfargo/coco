/**
 * Golden journey: multi-select cherry-pick range onto another branch
 * (#1643). Against the `multi-commit-branch` scenario, checkout `main`
 * (history stays `--all` so `feat/dashboard`'s commits remain visible),
 * anchor a 2-commit range with `v`, extend with `j`, and cherry-pick the
 * whole range with `c` — exercises the multi-select range primitive
 * (#1361) driving a real `git cherry-pick` end-to-end.
 */
import { createScenarioRepo, type ScenarioRepo } from './fixtures'
import { launchTui, type TuiSession } from './ptyHarness'

describe('cherry-pick range', () => {
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

  it('checks out main, keeping feat/dashboard commits visible in --all history', async () => {
    tui.press('g', 'b')
    await tui.waitForText('2/2 local')
    tui.press('j', 'enter')
    const screen = await tui.waitForText('ℹ Synced history to branch main tip')
    expect(screen).toContain('⎇ main')
  })

  it('gh jumps to history, cursor starting on the checked-out HEAD commit', async () => {
    tui.press('g', 'h')
    const screen = await tui.waitForText('ℹ jumped to history')
    expect(screen).toContain('10 commits')
    expect(screen).toContain('[main] chore: baseline app shell')
    // feat/dashboard's commits are still listed (history defaults to --all).
    expect(screen).toContain('[feat/dashboard] feat: add dashboard export-to-csv')
  })

  it('v anchors a range at the cursor', async () => {
    // Cursor lands on the HEAD commit (main tip) after gh; walk up two rows
    // to `60ff18b` before anchoring. Settle before anchoring — otherwise
    // `v` can fire before both cursor moves land, anchoring one row off.
    tui.press('k', 'k')
    await tui.waitForIdle()
    tui.press('v')
    const screen = await tui.waitForText('Range anchor set')
    expect(screen).toContain('range: v..cursor')
  })

  it('j extends the range one row down to a6e44d1', async () => {
    tui.press('j')
    // The anchor message text doesn't change on extend, so settle instead
    // of waiting on new text — otherwise `c` below can fire on a
    // single-commit range if it races the reducer's cursor-move handling.
    await tui.waitForIdle()
  })

  it('c cherry-picks the whole range as one confirmable action', async () => {
    tui.press('c')
    const screen = await tui.waitForText('Cherry-pick commit')
    expect(screen).toContain('2 commits')
    expect(screen).toContain('Press y to confirm')
  })

  it('y confirms — both commits land on main in their original order', async () => {
    tui.press('y')
    // Gate on the history refetch (12 commits), not the status message —
    // the success toast can paint a beat before the header count refreshes.
    const screen = await tui.waitForText('12 commits')
    expect(screen).toContain('✓ Cherry-picked')
    expect(screen).toContain('[main] feat: wire dashboard to data source')
    expect(screen).toContain('feat: add dashboard layout')
    // feat/dashboard's own copies of these commits are still present too —
    // cherry-pick creates new commits, it doesn't move the originals.
    expect(screen).toContain('a6e44d1')
  })
})
