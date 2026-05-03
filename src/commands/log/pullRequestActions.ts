import { GhRunner, defaultGhRunner } from './pullRequestData'

export type PullRequestActionResult = {
  ok: boolean
  message: string
  url?: string
}

export type CreatePullRequestInput = {
  base: string
  head: string
  title: string
  body: string
  draft?: boolean
}

function parseCreatedPullRequestUrl(output: string): string | undefined {
  return output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('https://'))
}

async function runGhAction(
  runner: GhRunner,
  args: string[],
  successMessage: (output: string) => PullRequestActionResult
): Promise<PullRequestActionResult> {
  try {
    return successMessage(await runner(args))
  } catch (error) {
    return {
      ok: false,
      message: (error as Error).message,
    }
  }
}

export function buildCreatePullRequestArgs(input: CreatePullRequestInput): string[] {
  const args = [
    'pr',
    'create',
    '--base',
    input.base,
    '--head',
    input.head,
    '--title',
    input.title,
    '--body',
    input.body,
  ]

  if (input.draft) {
    args.push('--draft')
  }

  return args
}

export function createPullRequest(
  input: CreatePullRequestInput,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  return runGhAction(runner, buildCreatePullRequestArgs(input), (output) => {
    const url = parseCreatedPullRequestUrl(output)

    return {
      ok: true,
      message: url ? `Created pull request: ${url}` : 'Created pull request',
      url,
    }
  })
}

export function openPullRequest(url: string, runner: GhRunner = defaultGhRunner): Promise<PullRequestActionResult> {
  return runGhAction(runner, ['pr', 'view', '--web'], () => ({
    ok: true,
    message: `Opened pull request: ${url}`,
    url,
  }))
}

/**
 * #783 — full PR action panel. The actions below all wrap a single
 * `gh pr <verb>` invocation. Strategy / body / option text travels in
 * via the action input; the runner-error / status surfacing is handled
 * by the shared `runGhAction` wrapper so callers always get a uniform
 * `PullRequestActionResult`.
 */

export type PullRequestMergeStrategy = 'merge' | 'squash' | 'rebase'

export function isPullRequestMergeStrategy(value: string): value is PullRequestMergeStrategy {
  return value === 'merge' || value === 'squash' || value === 'rebase'
}

export function buildMergePullRequestArgs(strategy: PullRequestMergeStrategy): string[] {
  // `--auto` and `--admin` are intentionally omitted — they're rarely
  // what a user wants from a TUI and require explicit gh auth scopes.
  // `--delete-branch` is opt-in via a future flag; default leaves the
  // branch in place so the user can verify before cleanup.
  return ['pr', 'merge', `--${strategy}`]
}

export function mergePullRequest(
  strategy: PullRequestMergeStrategy,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  return runGhAction(runner, buildMergePullRequestArgs(strategy), (output) => ({
    ok: true,
    message: output.trim() || `Merged pull request with ${strategy}`,
  }))
}

export function closePullRequest(
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  return runGhAction(runner, ['pr', 'close'], (output) => ({
    ok: true,
    message: output.trim() || 'Closed pull request',
  }))
}

/**
 * `gh pr review --approve` requires the user's gh auth to have scope
 * to write reviews — same scope that the in-browser approve button
 * uses. The runner surfaces auth failures via the standard error path.
 */
export function approvePullRequest(
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  return runGhAction(runner, ['pr', 'review', '--approve'], (output) => ({
    ok: true,
    message: output.trim() || 'Approved pull request',
  }))
}

/**
 * Request changes — `gh pr review` requires a body with this verb so
 * the empty-body case is rejected upstream by the input prompt.
 */
export function requestChangesPullRequest(
  body: string,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Review body required for change-request' })
  }
  return runGhAction(runner, ['pr', 'review', '--request-changes', '--body', body], (output) => ({
    ok: true,
    message: output.trim() || 'Requested changes',
  }))
}

export function commentPullRequest(
  body: string,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Comment body required' })
  }
  return runGhAction(runner, ['pr', 'comment', '--body', body], (output) => ({
    ok: true,
    message: output.trim() || 'Comment added',
  }))
}
