/**
 * Adapter: scenario → eval inputs (#934).
 *
 * Walks a scenario's commit history and produces one `CommitFixture`
 * per commit with the per-file diffs the parser would normally see
 * during a commit-message run. Each scenario's commits become a
 * deterministic input set for the structural-extract eval harness.
 *
 * Why scenarios for the golden set: they're already deterministic
 * (same scenario → byte-identical content each run), they cover a
 * range of realistic shapes (worktree dirty, mid-merge, multi-commit
 * feature branches), and they're maintained by the test layer
 * regardless of the eval — so the golden set stays in sync with the
 * test suite naturally.
 */

import type { SimpleGit } from 'simple-git'
import type { FileDiff } from '../../../types'
import { findScenario, createTempGitRepo, type TempGitRepo } from '@gfargo/git-scenarios'

export type CommitFixture = {
  /** Short sha — for display in the eval report. */
  shortSha: string
  /** Commit subject line. */
  subject: string
  /** Per-file diffs as `summarizeLargeFiles` would receive them. */
  diffs: FileDiff[]
}

export type ScenarioFixtureSet = {
  scenario: string
  /** Branch the scenario ends on, when known. Informational. */
  branch?: string
  commits: CommitFixture[]
}

const TOKEN_FACTOR = 4

function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_FACTOR)
}

/**
 * Pull the per-file diff for one commit. Uses `git show --numstat`
 * to enumerate changed files, then `git show <sha> -- <file>` for
 * each to get the per-file patch in isolation — matching the shape
 * `summarizeLargeFiles` consumes.
 */
async function diffsForCommit(git: SimpleGit, sha: string): Promise<FileDiff[]> {
  const numstat = await git.raw(['show', '--format=', '--numstat', '--find-renames', sha])
  const files: string[] = []
  for (const line of numstat.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split('\t')
    if (parts.length < 3) continue
    // Rename rows look like "added\tdeleted\told -> new" or
    // "added\tdeleted\told\tnew" depending on git version. Take the
    // last path segment in either form — that's the post-rename name
    // the parser would receive.
    let path = parts[parts.length - 1]
    if (path.includes(' -> ')) {
      path = path.split(' -> ')[1]
    }
    if (path) files.push(path)
  }

  const diffs: FileDiff[] = []
  for (const path of files) {
    let patch = ''
    try {
      patch = await git.raw([
        'show',
        '--format=',
        '--find-renames',
        '--color=never',
        '--unified=3',
        sha,
        '--',
        path,
      ])
    } catch {
      patch = ''
    }
    diffs.push({
      file: path,
      diff: patch,
      summary: '',
      tokenCount: estimateTokens(patch),
    })
  }
  return diffs
}

/**
 * Spin up a scenario in a fresh temp repo and extract a fixture per
 * commit. Returns the repo handle so the caller can call `cleanup()`
 * after consuming the fixtures.
 */
export async function buildScenarioFixtures(scenarioName: string): Promise<{
  repo: TempGitRepo
  fixtures: ScenarioFixtureSet
}> {
  const scenario = findScenario(scenarioName)
  if (!scenario) {
    throw new Error(`Unknown scenario: ${scenarioName}`)
  }

  const repo = await createTempGitRepo()
  await scenario.setup(repo)

  const log = await repo.git.log()
  const commits: CommitFixture[] = []
  for (const entry of log.all) {
    const diffs = await diffsForCommit(repo.git, entry.hash)
    commits.push({
      shortSha: entry.hash.slice(0, 8),
      subject: entry.message,
      diffs,
    })
  }

  let branch: string | undefined
  try {
    branch = (await repo.git.branchLocal()).current || undefined
  } catch {
    branch = undefined
  }

  return {
    repo,
    fixtures: {
      scenario: scenario.name,
      branch,
      commits,
    },
  }
}
