import { options as amendOptions } from './amend/config'
import { options as changelogOptions } from './changelog/config'
import { options as commitOptions } from './commit/config'
import { options as doctorOptions } from './doctor/config'
import { options as initOptions } from './init/config'
import { options as issuesOptions } from './issues/config'
import { options as logOptions } from './log/config'
import { options as prCreateOptions } from './prCreate/config'
import { options as prsOptions } from './prs/config'
import { options as recapOptions } from './recap/config'
import { options as reviewOptions } from './review/config'
import { options as uiOptions } from './ui/config'
import { options as workspaceOptions } from './workspace/config'

/**
 * Guards short-flag consistency.
 *
 * 1. The #1245 reconciliation: the two letters that previously meant different
 *    things across commands now resolve to one flag each — `-t` is `--tag`
 *    (changelog) and `-c` is `--conventional` (commit); the conflicting
 *    `commit --appendTicket -t` and `log --commit -c` aliases were dropped.
 * 2. The structural invariant that prevents a yargs conflict: within any single
 *    command, no single-letter alias may map to two different options. (Reusing
 *    a letter across *different* commands is intentional — e.g. `-b` is `branch`
 *    in some commands — and is deliberately NOT asserted here.)
 */

/** Each command's option map, keyed by command name for clear failures. */
const COMMAND_OPTIONS: Record<
  string,
  Record<string, { alias?: string | readonly string[] }>
> = {
  amend: amendOptions,
  changelog: changelogOptions,
  commit: commitOptions,
  doctor: doctorOptions,
  init: initOptions,
  issues: issuesOptions,
  log: logOptions,
  prCreate: prCreateOptions,
  prs: prsOptions,
  recap: recapOptions,
  review: reviewOptions,
  ui: uiOptions,
  workspace: workspaceOptions,
}

/** Normalize a yargs `alias` (string | string[] | undefined) to an array. */
const toAliases = (alias: string | readonly string[] | undefined): string[] =>
  alias == null ? [] : Array.isArray(alias) ? [...alias] : [alias as string]

describe('short-flag alias consistency (#1245)', () => {
  it('reserves -t for changelog --tag only', () => {
    expect(changelogOptions.tag.alias).toBe('t')
    expect(commitOptions.appendTicket.alias).toBeUndefined()
  })

  it('reserves -c for commit --conventional only', () => {
    expect(commitOptions.conventional.alias).toBe('c')
    expect(logOptions.commit.alias).toBeUndefined()
  })
})

describe('no duplicate single-letter alias within a command', () => {
  it.each(Object.entries(COMMAND_OPTIONS))(
    '%s: each short flag maps to exactly one option',
    (_command, options) => {
      const optionsByLetter: Record<string, string[]> = {}
      for (const [optionKey, def] of Object.entries(options)) {
        for (const alias of toAliases(def.alias)) {
          if (alias.length === 1) {
            ;(optionsByLetter[alias] ??= []).push(optionKey)
          }
        }
      }
      // A letter claimed by >1 option in the same command is a yargs conflict.
      const conflicts = Object.entries(optionsByLetter).filter(
        ([, keys]) => keys.length > 1,
      )
      expect(conflicts).toEqual([])
    },
  )
})
