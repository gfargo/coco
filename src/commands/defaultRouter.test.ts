import { decideDefaultRoute } from './defaultRouter'

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
