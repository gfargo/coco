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
})
