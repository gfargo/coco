/**
 * Golden journey: boot the workstation and walk the core views (#1424).
 *
 * Boot lands on history, then `gs` → status, `gb` → branches,
 * `gz` → stash, `gh` → home, `q` → clean exit. This is the seam the
 * unit suite cannot see: raw keystrokes through the PTY, the g-chord
 * dispatcher, view push/pop, and the real Ink render of each view.
 */
import { createScenarioRepo, type ScenarioRepo } from './fixtures'
import { launchTui, type TuiSession } from './ptyHarness'

describe('boot and navigate core views', () => {
  let repo: ScenarioRepo
  let tui: TuiSession

  beforeAll(async () => {
    repo = await createScenarioRepo('feature-pr-ready')
    tui = await launchTui({ cwd: repo.path })
  })

  afterAll(async () => {
    await tui?.close()
    await repo?.cleanup()
  })

  it('boots into the history view with the fixture branch and commits', async () => {
    const screen = await tui.waitForReady('Commits *')
    expect(screen).toContain('coco · local repository')
    expect(screen).toContain('feat/widget-v2')
    expect(screen).toContain('7 commits')
    expect(screen).toContain('chore: initial commit')
    expect(screen).toContain('q quit')
  })

  it('gs pushes the working-tree status view', async () => {
    tui.press('g', 's')
    const screen = await tui.waitForText('Worktree *')
    expect(screen).toContain('Worktree clean')
  })

  it('gb pushes the branches view listing both branches', async () => {
    tui.press('g', 'b')
    const screen = await tui.waitForText('Branches *')
    expect(screen).toContain('* feat/widget-v2')
    expect(screen).toContain('main')
    expect(screen).toContain('enter checkout')
  })

  it('gz pushes the (empty) stash view', async () => {
    tui.press('g', 'z')
    const screen = await tui.waitForText('Stash *')
    expect(screen).toContain('No stashes')
    expect(screen).toContain('0/0 stashes')
  })

  it('gh jumps home to the history root', async () => {
    tui.press('g', 'h')
    const screen = await tui.waitForText('Commits *')
    expect(screen).toContain('7 commits')
  })

  it('q quits with exit code 0', async () => {
    tui.press('q')
    const code = await tui.waitForExit()
    expect(code).toBe(0)
  })
})
