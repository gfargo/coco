/**
 * Keys that share one stdin chunk must each run (`gz` written in a single
 * `write` used to match no binding, so both keys were dropped), while a
 * bracketed paste must stay whole and never trigger keybindings.
 */
import { createScenarioRepo, type ScenarioRepo } from './fixtures'
import { launchTui, type TuiSession } from './ptyHarness'

describe('keys coalesced into one stdin chunk', () => {
  let repo: ScenarioRepo
  let tui: TuiSession

  beforeAll(async () => {
    repo = await createScenarioRepo('feature-pr-ready')
    tui = await launchTui({ cwd: repo.path })
    await tui.waitForReady('Commits *')
  })

  afterAll(async () => {
    await tui?.close()
    await repo?.cleanup()
  })

  it('runs both keys of a chord written in a single chunk', async () => {
    tui.type('gs')
    const screen = await tui.waitForText('Worktree *')
    expect(screen).toContain('Worktree clean')

    tui.type('gb')
    expect(await tui.waitForText('Branches *')).toContain('* feat/widget-v2')

    tui.type('gz')
    expect(await tui.waitForText('Stash *')).toContain('No stashes')

    tui.type('gh')
    expect(await tui.waitForText('Commits *')).toContain('7 commits')
  })

  it('runs several chords written in a single chunk, in order', async () => {
    tui.type('gsgbgz')
    const screen = await tui.waitForText('Stash *')
    expect(screen).toContain('No stashes')

    tui.type('gh')
    await tui.waitForText('Commits *')
  })

  it('does not run keybindings for a bracketed paste', async () => {
    tui.type('\x1b[200~gz\x1b[201~')
    const screen = await tui.waitForIdle()
    expect(screen).toContain('Commits *')
    expect(screen).not.toContain('No stashes')
  })

  it('still reacts to a normal key after a paste', async () => {
    tui.type('gs')
    await tui.waitForText('Worktree *')
  })
})
