/**
 * Golden journey: Ctrl+C respects the unsaved-draft guard (OSS-2795 /
 * coco#2154).
 *
 * Ink's own Ctrl+C handler used to exit the process before our
 * `useInput` listener ever ran (`exitOnCtrlC: true` in
 * `chrome/terminal.ts`), so a half-written commit message was lost
 * silently. With `exitOnCtrlC: false`, Ctrl+C now flows through the
 * same quit guard as `q`: a dirty compose draft raises the discard
 * confirm, and a second Ctrl+C is the hard escape hatch that always
 * exits. A clean boot still exits immediately on the first Ctrl+C —
 * no behavior change there.
 */
import { createScenarioRepo, type ScenarioRepo } from './fixtures'
import { launchTui, type TuiSession } from './ptyHarness'

describe('Ctrl+C unsaved-draft guard', () => {
  describe('with a dirty compose draft', () => {
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

    it('first Ctrl+C raises the discard-draft confirm instead of exiting', async () => {
      tui.press('g', 'c')
      await tui.waitForText('Compose commit')
      tui.press('e')
      tui.type('feat: wip commit message')
      tui.press('escape')

      tui.press('ctrl+c')
      const screen = await tui.waitForText('unsaved commit draft')
      expect(screen).toContain('Press y to discard it and quit.')
      expect(tui.exited).toBe(false)
    })

    it('second Ctrl+C is the hard escape hatch and exits', async () => {
      tui.press('ctrl+c')
      const code = await tui.waitForExit()
      expect(code).toBe(0)
    })
  })

  describe('with no draft', () => {
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

    it('Ctrl+C exits immediately — unchanged behavior', async () => {
      tui.press('ctrl+c')
      const code = await tui.waitForExit()
      expect(code).toBe(0)
    })
  })
})
