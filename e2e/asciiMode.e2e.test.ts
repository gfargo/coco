/**
 * Golden journey: `LANG=C` forces ASCII mode across the real TUI (#2163).
 *
 * `shouldUseAscii`/`detectAsciiMode` auto-detect ASCII from a non-UTF-8
 * locale; this is the seam the unit suite can't see — the real built
 * bundle, drawing box borders, cursors, and spinners through Ink and the
 * `wrapAsciiOutputStream` backstop, inside an actual PTY. Every screen this
 * journey inspects must render with no byte above `0x7e`. `--no-ascii`
 * under the same `LANG=C` env proves the escape hatch survives auto-detect.
 */
import { createScenarioRepo, type ScenarioRepo } from './fixtures'
import { launchTui, type TuiSession } from './ptyHarness'

/** First character in `screen` whose code point is above ASCII (`0x7e`), if any. */
function firstNonAscii(screen: string): { char: string; codePoint: number; index: number } | undefined {
  let index = 0
  for (const char of screen) {
    const codePoint = char.codePointAt(0) ?? 0
    if (codePoint > 0x7e) {
      return { char, codePoint, index }
    }
    index += char.length
  }
  return undefined
}

function expectAsciiOnly(screen: string): void {
  const found = firstNonAscii(screen)
  if (found) {
    const context = screen.slice(Math.max(0, found.index - 20), found.index + 20)
    throw new Error(
      `Expected an ASCII-only screen but found U+${found.codePoint
        .toString(16)
        .padStart(4, '0')} (${JSON.stringify(found.char)}) near ...${JSON.stringify(context)}...\n` +
        `--- full screen ---\n${screen}\n-------------------`
    )
  }
}

/**
 * `waitForReady`'s default "no `· loading`" gate is not ASCII-aware — under
 * `LANG=C` the separator itself transliterates to `.`, so `· loading` never
 * appears in the buffer and the check is vacuously true. Gate on the bare
 * `loading` token instead, then let the screen settle.
 */
async function waitForAsciiReady(tui: TuiSession, anchor: string): Promise<string> {
  await tui.waitFor(
    (screen) => screen.includes(anchor) && !screen.includes('loading'),
    `TUI ready (anchor ${anchor}, no loading chip)`
  )
  return tui.waitForIdle(400)
}

describe('LANG=C forces ASCII-only rendering', () => {
  let repo: ScenarioRepo
  let tui: TuiSession

  beforeAll(async () => {
    repo = await createScenarioRepo('feature-pr-ready')
    tui = await launchTui({ cwd: repo.path, env: { LANG: 'C' } })
  })

  afterAll(async () => {
    await tui?.close()
    await repo?.cleanup()
  })

  it('boots into history with no non-ASCII bytes on screen', async () => {
    const screen = await waitForAsciiReady(tui, 'Commits *')
    expect(screen).toContain('feat/widget-v2')
    expectAsciiOnly(screen)
  })

  it('the status/branches view stays ASCII', async () => {
    tui.press('g', 'b')
    const screen = await tui.waitForText('Branches *')
    expect(screen).toContain('feat/widget-v2')
    expectAsciiOnly(screen)
  })

  it('the help overlay stays ASCII', async () => {
    tui.press('?')
    const screen = await tui.waitForText('This view (branches)')
    expectAsciiOnly(screen)
    tui.press('?')
    await tui.waitFor((s) => !s.includes('This view (branches)'), 'help panel to close')
  })

  it('q quits with exit code 0', async () => {
    tui.press('q')
    const code = await tui.waitForExit()
    expect(code).toBe(0)
  })
})

describe('--no-ascii overrides LANG=C auto-detection', () => {
  let repo: ScenarioRepo
  let tui: TuiSession

  beforeAll(async () => {
    repo = await createScenarioRepo('feature-pr-ready')
    tui = await launchTui({ cwd: repo.path, args: ['ui', '--no-ascii'], env: { LANG: 'C' } })
  })

  afterAll(async () => {
    await tui?.close()
    await repo?.cleanup()
  })

  it('renders unicode chrome despite the non-UTF-8 locale', async () => {
    const screen = await tui.waitForReady('Commits *')
    expect(firstNonAscii(screen)).toBeDefined()
  })

  it('q quits with exit code 0', async () => {
    tui.press('q')
    const code = await tui.waitForExit()
    expect(code).toBe(0)
  })
})
