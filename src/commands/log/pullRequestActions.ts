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
