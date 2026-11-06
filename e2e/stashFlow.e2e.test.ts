/**
 * Golden journey: stash list → preview → diff drill-in (#1424).
 *
 * Against the `stashed-changes` scenario (three WIP stashes), `gz`
 * opens the stash view with the list and preview panel, enter drills
 * into the stash diff, esc pops back. Exercises real `git stash`
 * subprocess reads and the diff renderer end-to-end.
 */
import { createScenarioRepo, type ScenarioRepo } from './fixtures'
import { launchTui, type TuiSession } from './ptyHarness'

describe('stash flow', () => {
  let repo: ScenarioRepo
  let tui: TuiSession

  beforeAll(async () => {
    repo = await createScenarioRepo('stashed-changes')
    tui = await launchTui({ cwd: repo.path })
    await tui.waitForReady('Commits *')
  })

  afterAll(async () => {
    await tui?.close()
    await repo?.cleanup()
  })

  it('boot sidebar counts the fixture stashes', async () => {
    const screen = await tui.waitForText('Stashes (3)')
    expect(screen).toContain('coco · local repository')
  })

  it('gz lists all stashes with a preview of the selected one', async () => {
    tui.press('g', 'z')
    const listed = await tui.waitForText('3/3 stashes')
    expect(listed).toContain('stash@{0}')
    expect(listed).toContain('WIP: experiment-c')
    expect(listed).toContain('WIP: experiment-a')
    // Stash files load lazily, only while a stash surface is showing (#2209),
    // so the preview fills in a moment after the list. Wait for the file
    // instead of reading the screen the instant the list appears.
    const screen = await tui.waitForText('src/feature-c.ts')
    expect(screen).toContain('Stash preview')
  })

  it('enter drills into the stash diff', async () => {
    tui.press('enter')
    // Anchor on the diff body — the panel title appears while the
    // diff content is still loading asynchronously.
    const screen = await tui.waitForText('+export const c = "experiment-c"')
    expect(screen).toContain('Stash diff *')
    expect(screen).toContain('WIP: experiment-c')
    expect(screen).toContain('-export const c = "baseline"')
  })

  it('esc pops back to the stash list', async () => {
    tui.press('escape')
    const screen = await tui.waitForText('3/3 stashes')
    expect(screen).not.toContain('Stash diff *')
  })
})
