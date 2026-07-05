/**
 * Tests for yargs .strictOptions() rejection of unknown flags.
 *
 * Verifies that misspelled or unknown CLI flags produce an error with a
 * non-zero exit rather than being silently ignored (#1438).
 *
 * Strategy: build a minimal yargs instance per command with the real
 * option builders + .strictOptions(), capture the fail() callback, and
 * assert on the message. This avoids slow subprocess spawns while testing
 * the actual declared option sets.
 */

import yargs, { Argv } from 'yargs'
import { builder as amendBuilder } from './amend/config'
import { builder as changelogBuilder } from './changelog/config'
import { builder as commitBuilder } from './commit/config'
import { builder as doctorBuilder } from './doctor/config'
import { builder as initBuilder } from './init/config'
import { builder as issuesBuilder } from './issues/config'
import { builder as logBuilder } from './log/config'
import { builder as prCreateBuilder } from './prCreate/config'
import { builder as prsBuilder } from './prs/config'
import { builder as recapBuilder } from './recap/config'
import { builder as reviewBuilder } from './review/config'
import { builder as uiBuilder } from './ui/config'
import { builder as workspaceBuilder } from './workspace/config'

interface ParseResult {
  /** The message passed to yargs fail(), or null if parsing succeeded. */
  failMessage: string | null
}

/**
 * Build a single-command yargs instance with .strictOptions() and parse
 * the given args. Returns the fail() message (unknown-flag errors land here)
 * or null if no failure was triggered.
 *
 * Global flags (--repo, --verbose, --quiet, --json) are registered on the
 * instance so they aren't treated as unknown arguments.
 */
function parseWithStrict(
  builder: (y: Argv) => Argv,
  args: string[],
): ParseResult {
  let failMessage: string | null = null

  const y = yargs()

  // Register the globals that src/index.ts wires at the root level.
  y.option('repo', { type: 'string', alias: 'cwd', global: true })
  y.option('verbose', { type: 'boolean', alias: 'v', global: true })
  y.option('quiet', { type: 'boolean', alias: 'q', global: true })
  y.option('json', { type: 'boolean', global: true })

  builder(y)

  y.strictOptions()
    .fail((msg) => {
      failMessage = msg
    })
    .exitProcess(false) // don't call process.exit() in tests
    .parse(args)

  return { failMessage }
}

// ---------------------------------------------------------------------------
// The exact repro case from the issue
// ---------------------------------------------------------------------------

describe('strict mode rejects misspelled flags (issue #1438 repro)', () => {
  it('rejects --interactve (typo of --interactive) on commit', () => {
    const { failMessage } = parseWithStrict(commitBuilder, ['--interactve'])
    expect(failMessage).not.toBeNull()
    expect(failMessage).toMatch(/unknown argument/i)
    expect(failMessage).toMatch(/interactve/)
  })

  it('accepts --interactive (correct spelling) on commit', () => {
    const { failMessage } = parseWithStrict(commitBuilder, ['--interactive'])
    expect(failMessage).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Unknown flag rejection across all commands
// ---------------------------------------------------------------------------

describe('strict mode rejects unknown flags on each command', () => {
  const unknownFlag = '--completelymadeupflag'

  it.each([
    ['amend', amendBuilder],
    ['changelog', changelogBuilder],
    ['commit', commitBuilder],
    ['doctor', doctorBuilder],
    ['init', initBuilder],
    ['issues', issuesBuilder],
    ['log', logBuilder],
    ['pr create', prCreateBuilder],
    ['prs', prsBuilder],
    ['recap', recapBuilder],
    ['review', reviewBuilder],
    ['ui', uiBuilder],
    ['workspace', workspaceBuilder],
  ] as const)('%s rejects an unknown flag', (_name, builder) => {
    const { failMessage } = parseWithStrict(builder, [unknownFlag])
    expect(failMessage).not.toBeNull()
    expect(failMessage).toMatch(/unknown argument/i)
  })
})

// ---------------------------------------------------------------------------
// Global flags must NOT be rejected
// ---------------------------------------------------------------------------

describe('global flags are accepted on every command', () => {
  it.each([
    ['amend', amendBuilder],
    ['commit', commitBuilder],
    ['recap', recapBuilder],
    ['review', reviewBuilder],
  ] as const)('%s accepts --quiet', (_name, builder) => {
    const { failMessage } = parseWithStrict(builder, ['--quiet'])
    expect(failMessage).toBeNull()
  })

  it.each([
    ['amend', amendBuilder],
    ['commit', commitBuilder],
    ['log', logBuilder],
  ] as const)('%s accepts --json', (_name, builder) => {
    const { failMessage } = parseWithStrict(builder, ['--json'])
    expect(failMessage).toBeNull()
  })

  it.each([
    ['commit', commitBuilder],
    ['changelog', changelogBuilder],
  ] as const)('%s accepts --repo <dir>', (_name, builder) => {
    const { failMessage } = parseWithStrict(builder, ['--repo', '/tmp/myrepo'])
    expect(failMessage).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Declared command-specific flags must NOT be rejected
// ---------------------------------------------------------------------------

describe('declared flags are accepted (no false positives)', () => {
  it('commit accepts --noDiff', () => {
    const { failMessage } = parseWithStrict(commitBuilder, ['--noDiff'])
    expect(failMessage).toBeNull()
  })

  it('commit accepts --split', () => {
    const { failMessage } = parseWithStrict(commitBuilder, ['--split'])
    expect(failMessage).toBeNull()
  })

  it('commit accepts --noVerify', () => {
    const { failMessage } = parseWithStrict(commitBuilder, ['--noVerify'])
    expect(failMessage).toBeNull()
  })

  it('changelog accepts --tag <value>', () => {
    const { failMessage } = parseWithStrict(changelogBuilder, ['--tag', 'v1.0.0'])
    expect(failMessage).toBeNull()
  })

  it('recap accepts --tag (boolean alias for --last-tag)', () => {
    const { failMessage } = parseWithStrict(recapBuilder, ['--tag'])
    expect(failMessage).toBeNull()
  })

  it('recap accepts --last-tag', () => {
    const { failMessage } = parseWithStrict(recapBuilder, ['--last-tag'])
    expect(failMessage).toBeNull()
  })

  it('ui accepts --no-all (boolean negation of --all)', () => {
    // yargs automatically allows --no-<booleanFlag> for any declared boolean;
    // strict mode must not reject it.
    const { failMessage } = parseWithStrict(uiBuilder, ['--no-all'])
    expect(failMessage).toBeNull()
  })

  it('prs accepts --no-cache (boolean negation of declared --cache)', () => {
    const { failMessage } = parseWithStrict(prsBuilder, ['--no-cache'])
    expect(failMessage).toBeNull()
  })

  it('issues accepts --no-cache (boolean negation of declared --cache)', () => {
    const { failMessage } = parseWithStrict(issuesBuilder, ['--no-cache'])
    expect(failMessage).toBeNull()
  })

  it('review accepts --staged', () => {
    const { failMessage } = parseWithStrict(reviewBuilder, ['--staged'])
    expect(failMessage).toBeNull()
  })

  it('doctor accepts --cost', () => {
    const { failMessage } = parseWithStrict(doctorBuilder, ['--cost'])
    expect(failMessage).toBeNull()
  })
})
