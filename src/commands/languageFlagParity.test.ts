import yargs, { Options } from 'yargs'
import { options as commitOptions } from './commit/config'
import { options as amendOptions } from './amend/config'
import { options as reviewOptions } from './review/config'
import { options as recapOptions } from './recap/config'
import { options as changelogOptions } from './changelog/config'
import { options as lintOptions } from './lint/config'

// Locks --language parity across every generating command (OSS-2217). Each
// of these commands independently threads `argv.language || config.language`
// into getLanguageContext (directly in handler.ts, or via
// commit/generateCommitDraft.ts for commit and amend) — see each command's
// own test suite for that functional coverage. This test guards the CLI
// surface itself: a future edit to any one command's options object that
// drops `language` would otherwise silently regress --help and flag parsing
// without failing any test.
const GENERATING_COMMANDS: Array<{ name: string; options: Record<string, Options> }> = [
  { name: 'commit', options: commitOptions },
  { name: 'amend', options: amendOptions },
  { name: 'review', options: reviewOptions },
  { name: 'recap', options: recapOptions },
  { name: 'changelog', options: changelogOptions },
  { name: 'lint', options: lintOptions },
]

describe('--language flag parity across generating commands (OSS-2217)', () => {
  it.each(GENERATING_COMMANDS)('$name declares a string --language option', ({ options }) => {
    expect(options.language).toMatchObject({ type: 'string' })
    expect(typeof options.language.description).toBe('string')
  })

  it.each(GENERATING_COMMANDS)('$name parses --language onto argv', ({ options }) => {
    const argv = yargs(['--language', 'Spanish']).options(options).parseSync()
    expect(argv.language).toBe('Spanish')
  })

  it.each(GENERATING_COMMANDS)('$name lists --language in --help output', async ({ options }) => {
    const help = await yargs([]).options(options).getHelp()
    expect(help).toContain('--language')
  })
})
