import yargs from 'yargs'
import { options } from './config'

const parse = (args: string[]) => yargs(args).options(options).parseSync()

describe('amend config options (OSS-2217)', () => {
  // Guards the actual CLI surface: a mocked-handler test can't catch a
  // regression where --language is dropped from (or never registered on)
  // amend's yargs options, since the option would silently fall through as
  // an unrecognized flag instead of failing.
  it('registers --language and parses it onto argv', () => {
    expect(parse(['--language', 'Spanish']).language).toBe('Spanish')
  })

  it('leaves language undefined when --language is not passed', () => {
    expect(parse([]).language).toBeUndefined()
  })

  it('lists --language in --help output', async () => {
    const help = await yargs([]).options(options).getHelp()
    expect(help).toContain('--language')
  })
})
