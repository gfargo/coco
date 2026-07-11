/**
 * Golden journey: help overlay open → type-to-filter → close (#1424).
 *
 * `?` opens the contextual help panel, `/` enters its type-to-filter
 * input, typing narrows the binding table, esc clears, `?` closes.
 * Exercises the overlay input-routing seam — keystrokes must reach the
 * help filter rather than the underlying view while the overlay is up.
 */
import { createScenarioRepo, type ScenarioRepo } from './fixtures'
import { launchTui, type TuiSession } from './ptyHarness'

describe('help overlay with type-to-filter', () => {
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

  it('? opens the contextual help panel', async () => {
    tui.press('?')
    const screen = await tui.waitForText('This view (history)')
    expect(screen).toContain('Help')
    expect(screen).toContain('? close')
    expect(screen).toContain('/ filter')
  })

  it('typing after / filters the binding table', async () => {
    tui.press('/')
    tui.type('stash')
    const screen = await tui.waitForText('filter: stash')
    // The gz navigation binding survives the filter…
    expect(screen).toContain('Push the stash view')
    // …while unrelated movement bindings are filtered out.
    expect(screen).not.toContain('Move the current selection up.')
  })

  it('esc clears the filter, ? closes the panel', async () => {
    tui.press('escape')
    await tui.waitFor(
      (screen) => !screen.includes('filter: stash'),
      'help filter to clear'
    )
    tui.press('?')
    const screen = await tui.waitFor(
      (screen) => !screen.includes('This view (history)'),
      'help panel to close'
    )
    // Normal-mode global footer hints are back.
    expect(screen).toContain('g jump')
    expect(screen).toContain('? help')
  })
})
