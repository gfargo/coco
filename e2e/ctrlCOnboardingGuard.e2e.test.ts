/**
 * Golden journey: Ctrl+C quits from the first-run onboarding overlay
 * (OSS-2795 review follow-up).
 *
 * `useInputHandler`'s onboarding branch used to run before any Ctrl+C
 * check, so the very first Ctrl+C on a fresh machine only dismissed the
 * welcome overlay (`dismissOnboarding()` swallows the keystroke) instead
 * of quitting — a second Ctrl+C was needed. Ctrl+C is now checked first,
 * so it quits immediately even while the overlay is still showing (a
 * clean repo has no draft to guard).
 */
import { createScenarioRepo, type ScenarioRepo } from './fixtures'
import { launchTui, type TuiSession } from './ptyHarness'

describe('Ctrl+C onboarding guard', () => {
  let repo: ScenarioRepo
  let tui: TuiSession

  beforeAll(async () => {
    repo = await createScenarioRepo('feature-pr-ready')
    tui = await launchTui({ cwd: repo.path, skipOnboardingMarker: true })
    await tui.waitForText('Welcome to coco')
  })

  afterAll(async () => {
    await tui?.close()
    await repo?.cleanup()
  })

  it('first Ctrl+C quits instead of only dismissing the overlay', async () => {
    tui.press('ctrl+c')
    const code = await tui.waitForExit()
    expect(code).toBe(0)
  })
})
