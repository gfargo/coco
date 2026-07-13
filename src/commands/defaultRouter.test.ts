import { buildSyntheticArgv, decideDefaultRoute, defaultRouteHandler, type DefaultRouteArgv } from './defaultRouter'
import { createLogArgvFromUiArgv } from './ui/handler'
import { UiArgv } from './ui/config'
import { buildLogArgs, getLogView } from '../git/logData'
import { handler as commitHandler } from './commit/handler'
import { Logger } from '../lib/utils/logger'

jest.mock('./commit/handler', () => ({
  handler: jest.fn(),
}))

function routeArgv(overrides: Partial<DefaultRouteArgv> = {}): DefaultRouteArgv {
  return {
    _: ['$0'],
    $0: 'coco',
    ...overrides,
  } as DefaultRouteArgv
}

describe('decideDefaultRoute', () => {
  it('routes fresh installs (no config sources) to init', () => {
    expect(
      decideDefaultRoute({
        hasConfigSource: false,
        isGitRepo: true,
        explicitCommit: false,
      })
    ).toEqual({ kind: 'init', reason: 'no-config' })
  })

  it('routes fresh installs to init even when not in a repo', () => {
    expect(
      decideDefaultRoute({
        hasConfigSource: false,
        isGitRepo: false,
        explicitCommit: false,
      })
    ).toEqual({ kind: 'init', reason: 'no-config' })
  })

  it('routes configured users in a git repo to the workstation TUI', () => {
    expect(
      decideDefaultRoute({
        hasConfigSource: true,
        isGitRepo: true,
        explicitCommit: false,
      })
    ).toEqual({ kind: 'ui', reason: 'config-and-repo' })
  })

  it('routes configured users outside a repo to the multi-repo workspace', () => {
    expect(
      decideDefaultRoute({
        hasConfigSource: true,
        isGitRepo: false,
        explicitCommit: false,
      })
    ).toEqual({ kind: 'workspace', reason: 'config-no-repo' })
  })

  it('honors `--commit` regardless of environment state', () => {
    // Explicit `--commit` means the user (or a script) is asking
    // for legacy behavior — wins over every other signal so
    // automation doesn't get yanked into a TUI it wasn't expecting.
    expect(
      decideDefaultRoute({
        hasConfigSource: true,
        isGitRepo: true,
        explicitCommit: true,
      })
    ).toEqual({ kind: 'commit', reason: 'explicit-flag' })
  })

  it('honors COCO_DEFAULT=commit env var', () => {
    expect(
      decideDefaultRoute({
        hasConfigSource: true,
        isGitRepo: true,
        explicitCommit: false,
        envOverride: 'commit',
      })
    ).toEqual({ kind: 'commit', reason: 'env-override' })
  })

  it('ignores unrecognized COCO_DEFAULT values', () => {
    // Defensive: anything other than `commit` falls through to the
    // normal routing. Future env values (e.g. `ui` / `ws`) can be
    // added later — no need to silently honor typos.
    expect(
      decideDefaultRoute({
        hasConfigSource: true,
        isGitRepo: false,
        explicitCommit: false,
        envOverride: 'something-else',
      })
    ).toEqual({ kind: 'workspace', reason: 'config-no-repo' })
  })
})

describe('bare `coco` → workstation history view (#1169 regression)', () => {
  // The bug: bare `coco` routes through buildSyntheticArgv, which
  // bypasses yargs, so the `all: true` default from ui/config.ts never
  // applied. The workstation booted in compact (`--first-parent
  // --no-merges`) mode — fewer commits, branches ahead of HEAD hidden,
  // and a graph that looped back to the initial commit when cursoring a
  // branch whose tip wasn't in the compact window. These tests lock the
  // full composed path: route argv → synthetic ui argv → log argv →
  // git log args.

  it('the synthetic ui argv leaves `all` unset (the gap being compensated for)', () => {
    // Documents the root cause: this projection does NOT carry the
    // ui command's yargs default. If a future refactor sets `all` here
    // directly, the `?? true` fallback downstream becomes belt-and-
    // suspenders rather than the sole guard — worth knowing.
    const synthetic = buildSyntheticArgv<UiArgv>(routeArgv())
    expect(synthetic.all).toBeUndefined()
  })

  it('resolves to the all-refs view end to end', () => {
    const synthetic = buildSyntheticArgv<UiArgv>(routeArgv())
    const logArgv = createLogArgvFromUiArgv(synthetic)

    expect(logArgv.all).toBe(true)
    // `getLogView` is what picks compact vs full; `all` must win so the
    // workstation walks every ref, not just HEAD's first-parent line.
    expect(getLogView(logArgv)).toBe('full')
  })

  it('emits `--all` and not the compact-mode flags', () => {
    const synthetic = buildSyntheticArgv<UiArgv>(routeArgv())
    const logArgv = createLogArgvFromUiArgv(synthetic)
    const args = buildLogArgs(logArgv)

    expect(args).toContain('--all')
    // Compact mode is exactly what produced the dropped count + looping
    // graph in #1169 — these must be absent on the bare-`coco` path.
    expect(args).not.toContain('--first-parent')
    expect(args).not.toContain('--no-merges')
  })
})

describe('buildSyntheticArgv interactive override', () => {
  it('defaults `interactive` to true when no override is given (ui/workspace/init regression guard)', () => {
    const synthetic = buildSyntheticArgv<UiArgv>(routeArgv())
    expect(synthetic.interactive).toBe(true)
  })

  it('honors an `interactive: false` override', () => {
    const synthetic = buildSyntheticArgv<UiArgv>(routeArgv(), { interactive: false })
    expect(synthetic.interactive).toBe(false)
  })
})

describe('legacy `--commit`/COCO_DEFAULT=commit route does not force interactive mode (#1442)', () => {
  const originalCocoDefault = process.env.COCO_DEFAULT

  afterEach(() => {
    if (originalCocoDefault === undefined) {
      delete process.env.COCO_DEFAULT
    } else {
      process.env.COCO_DEFAULT = originalCocoDefault
    }
    jest.clearAllMocks()
  })

  it('invokes commitHandler with interactive: false when routed via COCO_DEFAULT=commit', async () => {
    process.env.COCO_DEFAULT = 'commit'
    const logger = new Logger({ silent: true })

    await defaultRouteHandler(routeArgv(), logger)

    expect(commitHandler).toHaveBeenCalledTimes(1)
    const mockCommitHandler = commitHandler as jest.Mock
    expect(mockCommitHandler.mock.calls[0][0].interactive).toBe(false)
  })

  it('invokes commitHandler with interactive: false when routed via explicit --commit flag', async () => {
    delete process.env.COCO_DEFAULT
    const logger = new Logger({ silent: true })

    await defaultRouteHandler(routeArgv({ commit: true }), logger)

    expect(commitHandler).toHaveBeenCalledTimes(1)
    const mockCommitHandler = commitHandler as jest.Mock
    expect(mockCommitHandler.mock.calls[0][0].interactive).toBe(false)
  })
})
