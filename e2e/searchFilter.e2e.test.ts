/**
 * Golden journey: history search filter (#1424).
 *
 * `/` enters FILTER mode, typing narrows the commit list live, enter
 * applies the filter back in NORMAL mode. Exercises the mode-switching
 * seam (NORMAL → FILTER → NORMAL) and the live list rectification that
 * runs on every keystroke of the query.
 */
import { createScenarioRepo, type ScenarioRepo } from './fixtures'
import { launchTui, type TuiSession } from './ptyHarness'

describe('history search filter', () => {
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

  it('typing a query in FILTER mode narrows the list live', async () => {
    tui.press('/')
    tui.type('baseline')
    const screen = await tui.waitForText('search: baseline')
    expect(screen).toContain('[FILTER]')
    expect(screen).toContain('1/7')
    expect(screen).toContain('test: add baseline widget tests')
    expect(screen).not.toContain('chore: initial commit')
  })

  it('enter applies the filter and returns to NORMAL mode', async () => {
    tui.press('enter')
    const screen = await tui.waitForText('filter: baseline')
    expect(screen).toContain('[NORMAL]')
    expect(screen).toContain('1/7')
    expect(screen).toContain('test: add baseline widget tests')
  })
})
