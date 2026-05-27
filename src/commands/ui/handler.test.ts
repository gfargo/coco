import { createLogArgvFromUiArgv, createUiTheme } from './handler'
import { UiArgv } from './config'
import type { Config } from '../../lib/config/types'

function argv(overrides: Partial<UiArgv> = {}): UiArgv {
  return {
    $0: 'coco',
    _: ['ui'],
    // Mirror the yargs default from src/commands/ui/config.ts — `all`
    // defaults to true so the workstation shows the full multi-ref
    // graph out of the box. Pass `all: false` in overrides to
    // simulate `coco ui --no-all`.
    all: true,
    interactive: false,
    verbose: false,
    version: false,
    help: false,
    view: 'history',
    ...overrides,
  } as UiArgv
}

describe('ui command handler utilities', () => {
  it('maps ui history options to interactive log args', () => {
    const logArgv = createLogArgvFromUiArgv(argv({
      all: true,
      branch: 'feature/git-workstation',
      limit: 500,
      path: ['src', 'README.md'],
    }))

    expect(logArgv._).toEqual(['log'])
    expect(logArgv.interactive).toBe(true)
    expect(logArgv.format).toBe('table')
    expect(logArgv.all).toBe(true)
    expect(logArgv.branch).toBe('feature/git-workstation')
    expect(logArgv.limit).toBe(500)
    expect(logArgv.path).toEqual(['src', 'README.md'])
  })

  it('defaults `all: true` so the workstation shows the full multi-ref graph', () => {
    // 0.54.x+: user feedback consistently asked for the GitKraken-style
    // "see all branches, tags, stashes" view as the starting state.
    // The yargs default at src/commands/ui/config.ts is `true`; the
    // handler just passes it through. Empty overrides simulate
    // running `coco ui` with no flags.
    const logArgv = createLogArgvFromUiArgv(argv({}))
    expect(logArgv.all).toBe(true)
  })

  it('honours --no-all when the user explicitly opted out', () => {
    const logArgv = createLogArgvFromUiArgv(argv({ all: false }))
    expect(logArgv.all).toBe(false)
  })

  it('keeps --all true when --branch is passed alongside (highlight, not scope)', () => {
    // Deliberate UX call: `coco ui --branch feature/x` does NOT
    // narrow to that branch automatically. The all-refs default
    // stays in effect; --branch acts as a "land on this branch's
    // tip" hint within the full graph. Users who want strict scope
    // pass `--branch feature/x --no-all`.
    const logArgv = createLogArgvFromUiArgv(argv({ branch: 'feature/x' }))
    expect(logArgv.all).toBe(true)
    expect(logArgv.branch).toBe('feature/x')
  })
})

describe('createUiTheme', () => {
  function makeConfig(overrides: Partial<Config> = {}): Config {
    return {
      logTui: undefined,
      ...overrides,
    } as unknown as Config
  }

  it('returns undefined when neither config nor argv specify a theme', () => {
    // No theme anywhere → chrome picks its built-in default preset.
    const theme = createUiTheme(makeConfig(), argv({}))
    expect(theme).toBeUndefined()
  })

  it('passes through config.logTui.theme when no CLI override is given', () => {
    const config = makeConfig({
      logTui: { theme: { preset: 'gruvbox' } },
    } as unknown as Config)
    const theme = createUiTheme(config, argv({}))
    expect(theme).toEqual({ preset: 'gruvbox' })
  })

  it('CLI --theme overrides the config preset but preserves other theme fields', () => {
    // Critical merge behaviour: the user's `noColor`, `ascii`, etc.
    // configured in `logTui.theme` must survive a `--theme` flag.
    // This used to wipe the entire block and lost user
    // customizations on every CLI run.
    const config = makeConfig({
      logTui: {
        theme: { preset: 'default', noColor: true, ascii: true },
      },
    } as unknown as Config)
    const theme = createUiTheme(config, argv({ theme: 'catppuccin' }))
    expect(theme).toEqual({
      preset: 'catppuccin',
      noColor: true,
      ascii: true,
    })
  })

  it('CLI --theme works even when config has no logTui block', () => {
    const theme = createUiTheme(makeConfig(), argv({ theme: 'monochrome' }))
    expect(theme).toEqual({ preset: 'monochrome' })
  })
})
