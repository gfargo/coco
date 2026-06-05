import { buildSyntheticArgv, decideDefaultRoute, type DefaultRouteArgv } from './defaultRouter'
import { createLogArgvFromUiArgv } from './ui/handler'
import { UiArgv } from './ui/config'
import { buildLogArgs, getLogView } from './log/data'

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
