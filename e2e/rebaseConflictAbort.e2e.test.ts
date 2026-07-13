/**
 * Golden journey: in-progress conflicted rebase → abort path (#1643).
 * Uses the pre-baked `mid-rebase-conflict` scenario rather than starting
 * a rebase from inside the TUI — a real conflicting rebase is
 * inherently timing/content-sensitive to construct live, where the
 * fixture gives a deterministic starting point for CI. Asserts the
 * in-progress operation chip (#1416/#1474) is visible on boot, then
 * drives the abort path via the conflicts view.
 */
import { createScenarioRepo, type ScenarioRepo } from './fixtures'
import { launchTui, type TuiSession } from './ptyHarness'

describe('rebase conflict → abort', () => {
  let repo: ScenarioRepo
  let tui: TuiSession

  beforeAll(async () => {
    repo = await createScenarioRepo('mid-rebase-conflict')
    tui = await launchTui({ cwd: repo.path })
    await tui.waitForReady('Commits *')
  })

  afterAll(async () => {
    await tui?.close()
    await repo?.cleanup()
  })

  it('boots with the REBASING operation chip visible in the header', async () => {
    const screen = tui.snapshot()
    expect(screen).toContain('REBASING (1 conflict)')
  })

  it('gx jumps to the conflicts view, listing the unresolved file', async () => {
    tui.press('g', 'x')
    const screen = await tui.waitForText('rebase — 1 conflict remaining')
    expect(screen).toContain('UU src/config.ts')
  })

  it('A opens the abort-operation confirmation', async () => {
    tui.press('A')
    const screen = await tui.waitForText('Abort operation')
    expect(screen).toContain('Press y to confirm')
  })

  it('y aborts — the rebase ends and the tree is clean again', async () => {
    tui.press('y')
    // Gate on the header settling to clean, not the status toast — the
    // toast paints a beat before the header's operation-chip clears.
    const screen = await tui.waitForText('✓ clean')
    expect(screen).toContain('Aborted rebase')
    expect(screen).not.toContain('REBASING')
  })

  it('the conflicts view reports no operation in progress', async () => {
    const screen = await tui.waitForText('no operation in progress')
    expect(screen).toContain('No merge, rebase, cherry-pick, or revert in progress.')
  })
})
