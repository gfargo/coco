/**
 * Shared fake-`git` builder for tests (#1421 / #1381×#1407 postmortem).
 *
 * The incident: #1407 added an apply-time drift guard that reads
 * `status().files` (per-file index/working-tree codes), while #1381's
 * tests hand-rolled a `status()` fake with a placeholder `files: []`.
 * Each PR was green against the `main` it branched from; merged together,
 * the guard read a `files` array that didn't agree with the fixture's
 * `staged` array and broke. Dozens of test files each hand-roll their own
 * `status()` shape, so a new guard reading a field none of them populate
 * can drift silently across N fixtures instead of failing loudly in one
 * place.
 *
 * `deriveStatus` is the fix: callers describe the worktree ONCE, as a list
 * of `{ path, index, working_dir }` porcelain entries, and every array on
 * `StatusResult` (`staged`, `created`, `modified`, `renamed`, `not_added`,
 * `files`, ...) is derived from that single description using the same
 * index/working_dir → bucket mapping simple-git's own porcelain parser
 * uses (see `StatusSummary.ts` in the `simple-git` package). It is not
 * possible to end up with a `files` array that disagrees with `staged`.
 */
import type { FileStatusResult, StatusResult, StatusResultRenamed } from 'simple-git'

export type FakeWorktreeFile = {
  path: string
  /** First porcelain status column (index/staged side). */
  index: string
  /** Second porcelain status column (working-tree side). */
  working_dir: string
  /** Rename source, for `index`/`working_dir` codes of `R`. */
  from?: string
}

export function deriveStatus(worktree: FakeWorktreeFile[]): StatusResult {
  const status: StatusResult = {
    not_added: [],
    conflicted: [],
    created: [],
    deleted: [],
    modified: [],
    renamed: [],
    staged: [],
    files: [],
    ahead: 0,
    behind: 0,
    current: null,
    tracking: null,
    detached: false,
    isClean: () => status.files.length === 0,
  }

  for (const file of worktree) {
    const { path, index, working_dir } = file
    const code = `${index}${working_dir}`

    switch (code) {
      case ' A':
        status.created.push(path)
        break
      case ' D':
        status.deleted.push(path)
        break
      case ' M':
        status.modified.push(path)
        break
      case 'A ':
        status.created.push(path)
        status.staged.push(path)
        break
      case 'AM':
        status.created.push(path)
        status.staged.push(path)
        status.modified.push(path)
        break
      case 'D ':
        status.deleted.push(path)
        status.staged.push(path)
        break
      case 'M ':
      case 'MM':
        status.modified.push(path)
        status.staged.push(path)
        break
      case 'R ': {
        const renamed: StatusResultRenamed = { from: file.from ?? path, to: path }
        status.renamed.push(renamed)
        break
      }
      case 'RM': {
        const renamed: StatusResultRenamed = { from: file.from ?? path, to: path }
        status.renamed.push(renamed)
        status.modified.push(path)
        break
      }
      case '??':
        status.not_added.push(path)
        break
      case '!!':
        status.ignored = status.ignored ?? []
        status.ignored.push(path)
        break
      case 'AA':
      case 'AU':
      case 'DD':
      case 'DU':
      case 'UA':
      case 'UD':
      case 'UU':
        status.conflicted.push(path)
        break
      default:
        // Loud on purpose — see the module doc. A code this builder
        // doesn't know how to classify should fail the test that used
        // it, not silently produce an incoherent StatusResult.
        throw new Error(
          `makeFakeGit: unrecognized status code "${code}" for "${path}". ` +
            `Add a case to deriveStatus() in src/test/builders/makeFakeGit.ts ` +
            `(cross-check simple-git's StatusSummary parser) instead of guessing.`
        )
    }

    if (code === '!!') {
      continue
    }
    const fileResult: FileStatusResult = { path, index, working_dir }
    if (file.from) {
      fileResult.from = file.from
    }
    status.files.push(fileResult)
  }

  return status
}

export type FakeGitOptions = {
  /**
   * Raw output for `git diff --cached --name-only -z`. Defaults to the
   * paths `deriveStatus` classifies as staged (staged/created/renamed-to).
   */
  stagedBeforeReset?: string[]
}

export type FakeGit = {
  raw: jest.Mock<Promise<string>, [string[]]>
  add: jest.Mock<Promise<string>, [string | string[]]>
  status: jest.Mock<Promise<StatusResult>>
  revparse: jest.Mock<Promise<string>, unknown[]>
  /** Advances the value `revparse(['HEAD'])` resolves to, simulating a commit landing. */
  advanceHead: () => void
}

/**
 * Builds a fake `git` plus an ordered `ops` log of every `raw`/`add` call,
 * matching the op-log pattern `splitApply.test.ts` already used for
 * asserting index choreography (reset-before-restage ordering, etc.).
 */
export function makeFakeGit(worktree: FakeWorktreeFile[], options: FakeGitOptions = {}) {
  const ops: string[] = []
  let head = 0
  const status = deriveStatus(worktree)
  const stagedBeforeReset =
    options.stagedBeforeReset ??
    [...status.staged, ...status.created, ...status.renamed.map((entry) => entry.to)]

  const git: FakeGit = {
    raw: jest.fn(async (args: string[]) => {
      if (args[0] === 'diff' && args.includes('--cached')) {
        ops.push('list-staged')
        return stagedBeforeReset.join('\0') + (stagedBeforeReset.length ? '\0' : '')
      }
      ops.push(args.join(' '))
      return ''
    }),
    add: jest.fn(async (files: string | string[]) => {
      ops.push(`stage ${(Array.isArray(files) ? files : [files]).join(',')}`)
      return ''
    }),
    status: jest.fn(async () => status),
    revparse: jest.fn(async () => `head-${head}`),
    advanceHead: () => {
      head += 1
    },
  }

  return { git, ops }
}

/**
 * Convenience for the common case: a flat list of paths that are all
 * cleanly staged modifications, no worktree drift. Equivalent to calling
 * `makeFakeGit` with `{ index: 'M', working_dir: ' ' }` for each path.
 */
makeFakeGit.staged = (paths: string[], options: FakeGitOptions = {}) =>
  makeFakeGit(
    paths.map((path) => ({ path, index: 'M', working_dir: ' ' })),
    options
  )
