import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import * as states from './surfaceStates'

/**
 * #2166 acceptance: every empty or error message a surface can show names
 * the key that gets the user out (retry, clear the filter, add one, go
 * back). Messages without a next step leave people staring at a blank panel.
 */
const KEY_HINT = /\b(?:[Pp]ress|[Ee]nter|[Aa]dd one with)\b|\besc\b|\bctrl\+\w/

const filters = ['', 'zzz']

type Case = { name: string; text: string | undefined }

function cases(): Case[] {
  const out: Case[] = []
  const withFilter = (name: string, fn: (filter: string) => string | undefined) =>
    filters.forEach((filter) => out.push({ name: `${name} (filter ${JSON.stringify(filter)})`, text: fn(filter) }))

  withFilter('branches', (filter) => states.formatLogInkBranchesEmpty({ filter }))
  withFilter('tags', (filter) => states.formatLogInkTagsEmpty({ filter }))
  withFilter('stash', (filter) => states.formatLogInkStashEmpty({ filter }))
  withFilter('reflog', (filter) => states.formatLogInkReflogEmpty({ filter }))
  withFilter('submodules', (filter) => states.formatLogInkSubmodulesEmpty({ filter }))
  withFilter('remotes', (filter) => states.formatLogInkRemotesEmpty({ filter }))
  withFilter('worktrees', (filter) => states.formatLogInkWorktreesEmpty({ filter }))
  withFilter('issues', (filter) => states.formatLogInkIssuesEmpty({ filter }))
  withFilter('pull request triage', (filter) => states.formatLogInkPullRequestTriageEmpty({ filter }))
  for (const totalCommits of [0, 5]) {
    withFilter(`history (total ${totalCommits})`, (filter) => states.formatLogInkHistoryEmpty({ filter, totalCommits }))
  }

  out.push({ name: 'blame (no failure)', text: states.formatLogInkBlameEmpty({ path: 'a.ts' }) })
  out.push({ name: 'blame (failure)', text: states.formatLogInkBlameEmpty({ path: 'a.ts', failureMessage: 'binary file' }) })
  out.push({ name: 'notes', text: states.formatLogInkNotesEmpty() })
  out.push({ name: 'forge unauthenticated', text: states.formatLogInkForgeUnauthenticated({ resource: 'Pull requests' }) })
  out.push({ name: 'forge unauthenticated (auth hint)', text: states.formatLogInkForgeUnauthenticated({ resource: 'Issues', authHint: 'Run `glab auth login`.' }) })
  out.push({ name: 'forge no remote', text: states.formatLogInkForgeNoRemote({ resource: 'Pull requests' }) })
  out.push({ name: 'pull request diff error', text: states.formatLogInkPullRequestDiffError({ message: 'timeout.' }) })
  out.push({ name: 'pull request diff empty', text: states.formatLogInkPullRequestDiffEmpty() })
  return out
}

describe('surface empty and error states name a key (#2166)', () => {
  it.each(cases().map((c) => [c.name, c.text] as const))('%s', (_name, text) => {
    // A state that is legitimately blank (nothing to say) returns undefined.
    if (text === undefined) return
    expect(text).toMatch(KEY_HINT)
  })

  it('covers every empty/error formatter the module exports', () => {
    const exported = Object.keys(states).filter((name) => /^formatLogInk.*(Empty|Error|Unauthenticated|NoRemote)$/.test(name))
    const covered = [
      'Branches', 'Tags', 'Stash', 'Reflog', 'Submodules', 'Remotes', 'Worktrees', 'Issues', 'PullRequestTriage',
      'History', 'Blame', 'Notes', 'ForgeUnauthenticated', 'ForgeNoRemote', 'PullRequestDiff',
    ]
    const uncovered = exported.filter((name) => !covered.some((fragment) => name.includes(fragment)))
    // Status and compose are checked below because they can return undefined.
    expect(uncovered.sort()).toEqual(['formatLogInkComposeEmpty', 'formatLogInkStatusEmpty'])
  })

  it('status and compose say what to do when they do show something', () => {
    const texts = [
      states.formatLogInkStatusEmpty({ hasChanges: false }),
      states.formatLogInkStatusEmpty({ hasChanges: false, sparse: true }),
      states.formatLogInkComposeEmpty({ hasStaged: false }),
    ].filter((text): text is string => typeof text === 'string')
    expect(texts.length).toBeGreaterThan(0)
    for (const text of texts) expect(text).toMatch(KEY_HINT)
  })
})

describe('source-level copy conventions (#2166)', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name: string) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return sources(path)
      return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : []
    })
  }

  const files = sources(join(__dirname, '..'))

  /** Lines of non-comment source that match, as `file:line  text`. */
  function matches(pattern: RegExp): string[] {
    const hits: string[] = []
    for (const file of files) {
      readFileSync(file, 'utf8').split('\n').forEach((line: string, index: number) => {
        const code = line.trim()
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return
        if (pattern.test(code)) hits.push(`${file.replace(join(__dirname, '..'), 'workstation')}:${index + 1}  ${code}`)
      })
    }
    return hits
  }

  it('uses the ellipsis character, not three dots, in loading text', () => {
    // `…` goes through the glyph table in ASCII mode; `...` does not.
    expect(matches(/['"`][^'"`]*\b(?:Loading|Fetching|Resolving|Generating|Summarizing)\b[^'"`]*\.\.\.['"`]/)).toEqual([])
  })
})
