import yargs from 'yargs'
import { options } from './config'

const parse = (args: string[]) => yargs(args).options(options).parseSync()

describe('commit config options', () => {
  // Repro for #1437: `default: true` on `includeBranchName` meant yargs
  // always populated argv with a value, so loadConfig's final
  // `{ ...config, ...argv }` merge silently clobbered a documented
  // `includeBranchName: false` from config with the yargs default.
  it('does not default includeBranchName so config can supply it', () => {
    expect(parse([]).includeBranchName).toBeUndefined()
  })

  it('still honors explicit --includeBranchName / --no-includeBranchName', () => {
    expect(parse(['--includeBranchName']).includeBranchName).toBe(true)
    expect(parse(['--no-includeBranchName']).includeBranchName).toBe(false)
  })

  // #1892: openInEditor was part of CommitOptions (read at handler.ts:480)
  // and settable via config, but had no yargs entry — under the CLI's real
  // .strictOptions() (src/index.ts), --open-in-editor was rejected as an
  // unknown argument even though the type it's meant to control is public.
  it('accepts --open-in-editor under strictOptions instead of "Unknown arguments" (#1892)', () => {
    let failMessage: string | null = null
    const argv = yargs(['--open-in-editor'])
      .options(options)
      .strictOptions()
      .fail((msg) => {
        failMessage = msg
      })
      .exitProcess(false)
      .parseSync()

    expect(failMessage).toBeNull()
    expect(argv.openInEditor).toBe(true)
  })
})
