import { defaultGlabRunner, resolveGlabActionError, type GlabRunner } from './glabCli'
import type { PullRequestActionResult } from './pullRequestActions'

/**
 * GitLab merge-request create/open, the glab counterparts to the gh
 * `createPullRequest` / `openPullRequest` used by `coco pr create`. They return
 * the same `PullRequestActionResult` so the command handler treats both forges
 * uniformly. (The broader MR/issue mutating-action set lands with the
 * workstation TUI integration in a follow-up.)
 */

export type CreateMergeRequestInput = {
  base: string
  head: string
  title: string
  body: string
  draft?: boolean
}

function parseCreatedMergeRequestUrl(output: string): string | undefined {
  return output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('https://'))
}

async function runGlabAction(
  runner: GlabRunner,
  args: string[],
  onSuccess: (output: string) => PullRequestActionResult
): Promise<PullRequestActionResult> {
  try {
    return onSuccess(await runner(args))
  } catch (error) {
    const { message, details } = await resolveGlabActionError(error, runner)
    return { ok: false, message, ...(details && details.length ? { details } : {}) }
  }
}

export function buildCreateMergeRequestArgs(input: CreateMergeRequestInput): string[] {
  // `--yes` skips glab's interactive confirmation; supplying title + description
  // keeps it non-interactive (no editor). `--draft` marks it a draft MR.
  const args = [
    'mr',
    'create',
    '--source-branch',
    input.head,
    '--target-branch',
    input.base,
    '--title',
    input.title,
    '--description',
    input.body,
    '--yes',
  ]

  if (input.draft) {
    args.push('--draft')
  }

  return args
}

export function createMergeRequest(
  input: CreateMergeRequestInput,
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, buildCreateMergeRequestArgs(input), (output) => {
    const url = parseCreatedMergeRequestUrl(output)
    return {
      ok: true,
      message: url ? `Created merge request: ${url}` : 'Created merge request',
      url,
    }
  })
}

export function openMergeRequest(
  url: string,
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, ['mr', 'view', '--web'], () => ({
    ok: true,
    message: `Opened merge request: ${url}`,
    url,
  }))
}
