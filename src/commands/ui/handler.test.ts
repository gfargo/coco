import { createLogArgvFromUiArgv } from './handler'
import { UiArgv } from './config'

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
