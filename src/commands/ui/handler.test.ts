import { createLogArgvFromUiArgv } from './handler'
import { UiArgv } from './config'

function argv(overrides: Partial<UiArgv> = {}): UiArgv {
  return {
    $0: 'coco',
    _: ['ui'],
    all: false,
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
})
