import { defaultGlabRunner, resolveGlabActionError, runGlabAction, type GlabRunner } from './glabCli'
import { rejectFlagLike, rejectUnsafeLabel, rejectUnsafeUsername } from './forgeArgGuards'
import type { PullRequestActionResult, PullRequestMergeStrategy } from './pullRequestActions'
import { parsePullRequestDiffLines, type PullRequestDiffResult } from './pullRequestDiffData'
import { normalizePipelineConclusion } from './gitlabDetailData'
import type { PullRequestChecksResult, PullRequestStatusCheck } from './pullRequestDetailData'

function enc(path: string): string {
  return encodeURIComponent(path)
}

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

export function buildCreateMergeRequestArgs(input: CreateMergeRequestInput): string[] {
  // `--yes` skips glab's interactive confirmation; supplying title + description
  // keeps it non-interactive (no editor). `--draft` marks it a draft MR.
  const args = [
    'mr',
    'create',
    `--source-branch=${input.head}`,
    `--target-branch=${input.base}`,
    `--title=${input.title}`,
    `--description=${input.body}`,
    // Push the (committed) source branch as part of creation so the MR can be
    // opened even when the branch isn't on the remote yet — mirrors how the
    // GitHub flow expects a pushed branch.
    '--push',
    '--yes',
  ]

  if (input.draft) {
    args.push('--draft')
  }

  return args
}

export function createMergeRequest(
  input: CreateMergeRequestInput,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  const bad = rejectFlagLike(input.head, 'Branch name') || rejectFlagLike(input.base, 'Branch name')
  if (bad) return Promise.resolve({ ok: false, message: bad })
  return runGlabAction(runner, buildCreateMergeRequestArgs(input), (output) => {
    const url = parseCreatedMergeRequestUrl(output)
    return {
      ok: true,
      message: url ? `Created merge request: ${url}` : 'Created merge request',
      url,
    }
  }, hostname)
}

export function openMergeRequest(
  url: string,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, ['mr', 'view', '--web'], () => ({
    ok: true,
    message: `Opened merge request: ${url}`,
    url,
  }), hostname)
}

/**
 * Mutating MR actions, the glab counterparts to `pullRequestActions.ts`. glab
 * infers the project from the repo remote and the MR from the IID (or the
 * current branch for the no-IID variants). The verb/flag choices below follow
 * the glab CLI; they are contract-locked by the arg-builder tests and should be
 * smoke-tested against a live GitLab instance before relying on them.
 *
 * Strategy maps to glab's merge flags: plain merge (no flag), `--squash`,
 * `--rebase`. `--yes` skips glab's interactive confirm.
 */
export type MergeRequestMergeStrategy = 'merge' | 'squash' | 'rebase'

function mergeStrategyFlags(strategy: MergeRequestMergeStrategy): string[] {
  if (strategy === 'squash') return ['--squash']
  if (strategy === 'rebase') return ['--rebase']
  return []
}

export function mergeMergeRequestByNumber(
  mergeRequestNumber: number,
  strategy: MergeRequestMergeStrategy,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  return runGlabAction(
    runner,
    ['mr', 'merge', String(mergeRequestNumber), ...mergeStrategyFlags(strategy), '--yes'],
    (output) => ({
      ok: true,
      message: output.trim() || `Merged merge request !${mergeRequestNumber} with ${strategy}`,
    }),
    hostname
  )
}

export function approveMergeRequestByNumber(
  mergeRequestNumber: number,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  return runGlabAction(
    runner,
    ['mr', 'approve', String(mergeRequestNumber)],
    (output) => ({
      ok: true,
      message: output.trim() || `Approved merge request !${mergeRequestNumber}`,
    }),
    hostname
  )
}

export function closeMergeRequestByNumber(
  mergeRequestNumber: number,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  return runGlabAction(
    runner,
    ['mr', 'close', String(mergeRequestNumber)],
    (output) => ({
      ok: true,
      message: output.trim() || `Closed merge request !${mergeRequestNumber}`,
    }),
    hostname
  )
}

export function commentMergeRequestByNumber(
  mergeRequestNumber: number,
  body: string,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Comment body required' })
  }
  return runGlabAction(
    runner,
    ['mr', 'note', 'create', String(mergeRequestNumber), `--message=${body}`],
    (output) => ({
      ok: true,
      message: output.trim() || `Commented on merge request !${mergeRequestNumber}`,
    }),
    hostname
  )
}

/**
 * GitLab has no native "request changes" review verb (it uses approvals plus
 * discussion). The closest faithful behavior is a note carrying the reviewer's
 * body, prefixed so intent is clear. Documented as a limitation.
 */
export function requestChangesMergeRequestByNumber(
  mergeRequestNumber: number,
  body: string,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Review body required for change-request' })
  }
  return runGlabAction(
    runner,
    ['mr', 'note', 'create', String(mergeRequestNumber), `--message=Requested changes: ${body}`],
    (output) => ({
      ok: true,
      message: output.trim() || `Requested changes on merge request !${mergeRequestNumber}`,
    }),
    hostname
  )
}

export function addMergeRequestLabel(
  mergeRequestNumber: number,
  label: string,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  if (!label.trim()) {
    return Promise.resolve({ ok: false, message: 'Label name required' })
  }
  const bad = rejectUnsafeLabel(label)
  if (bad) return Promise.resolve({ ok: false, message: bad })
  return runGlabAction(
    runner,
    ['mr', 'update', String(mergeRequestNumber), `--label=${label}`],
    () => ({
      ok: true,
      message: `Added label '${label}' to merge request !${mergeRequestNumber}`,
    }),
    hostname
  )
}

export function addMergeRequestAssignee(
  mergeRequestNumber: number,
  assignee: string,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  if (!assignee.trim()) {
    return Promise.resolve({ ok: false, message: 'Assignee username required' })
  }
  const bad = rejectUnsafeUsername(assignee)
  if (bad) return Promise.resolve({ ok: false, message: bad })
  return runGlabAction(
    runner,
    // `+` prefix ADDS to existing assignees; a bare username would replace them.
    ['mr', 'update', String(mergeRequestNumber), `--assignee=+${assignee}`],
    () => ({
      ok: true,
      message: `Assigned ${assignee} to merge request !${mergeRequestNumber}`,
    }),
    hostname
  )
}

// Current-branch variants (no IID — glab infers the MR from the checked-out
// source branch), mirroring the gh current-branch PR actions.

export function mergeMergeRequest(
  strategy: MergeRequestMergeStrategy,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, ['mr', 'merge', ...mergeStrategyFlags(strategy), '--yes'], (output) => ({
    ok: true,
    message: output.trim() || `Merged merge request with ${strategy}`,
  }), hostname)
}

export function closeMergeRequest(
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, ['mr', 'close'], (output) => ({
    ok: true,
    message: output.trim() || 'Closed merge request',
  }), hostname)
}

export function approveMergeRequest(
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, ['mr', 'approve'], (output) => ({
    ok: true,
    message: output.trim() || 'Approved merge request',
  }), hostname)
}

export function commentMergeRequest(
  body: string,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Comment body required' })
  }
  return runGlabAction(runner, ['mr', 'note', 'create', `--message=${body}`], (output) => ({
    ok: true,
    message: output.trim() || 'Comment added',
  }), hostname)
}

export function requestChangesMergeRequest(
  body: string,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Review body required for change-request' })
  }
  return runGlabAction(runner, ['mr', 'note', 'create', `--message=Requested changes: ${body}`], (output) => ({
    ok: true,
    message: output.trim() || 'Requested changes',
  }), hostname)
}

/**
 * `glab mr checkout <n>` — the GitLab counterpart of
 * `checkoutPullRequestByNumber` (#1363). Fetches the MR's source
 * branch and switches the worktree onto it.
 */
export function checkoutMergeRequestByNumber(
  mergeRequestNumber: number,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, ['mr', 'checkout', String(mergeRequestNumber)], (output) => ({
    ok: true,
    message: output.trim() || `Checked out merge request !${mergeRequestNumber}`,
  }), hostname)
}

/**
 * CI-checks surface (OSS-1615). Unlike `gitlabDetailData.ts`'s
 * `parsePipelineAsChecks` — which collapses the whole head pipeline into
 * one synthetic `'pipeline'` row for the general MR detail view — this
 * resolves the actual per-job breakdown so re-run has something to act
 * on and the checks surface can show real job names.
 */
async function resolveHeadPipelineId(
  projectPath: string,
  mergeRequestNumber: number,
  runner: GlabRunner
): Promise<number | undefined> {
  const out = (await runner(['api', `projects/${enc(projectPath)}/merge_requests/${mergeRequestNumber}`])).trim()
  if (!out) return undefined
  const mr = JSON.parse(out) as { head_pipeline?: { id?: number } }
  return mr.head_pipeline?.id
}

export async function getMergeRequestChecks(
  projectPath: string,
  mergeRequestNumber: number,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestChecksResult> {
  try {
    const pipelineId = await resolveHeadPipelineId(projectPath, mergeRequestNumber, runner)
    if (!pipelineId) return { ok: true, checks: [] }

    const out = (await runner(['api', `projects/${enc(projectPath)}/pipelines/${pipelineId}/jobs?per_page=100`])).trim()
    const jobs = out ? (JSON.parse(out) as Array<{ id?: number; name?: string; status?: string }>) : []
    if (!Array.isArray(jobs)) return { ok: true, checks: [] }

    const checks: PullRequestStatusCheck[] = jobs.map((job) => ({
      name: job.name || 'job',
      status: job.status,
      conclusion: job.status ? normalizePipelineConclusion(job.status) : undefined,
      runId: job.id != null ? String(job.id) : undefined,
    }))
    return { ok: true, checks }
  } catch (error) {
    const { message } = await resolveGlabActionError(error, runner, hostname)
    return { ok: false, message }
  }
}

/**
 * `POST /pipelines/:id/retry` — GitLab retries only the failed/canceled
 * jobs of the pipeline (not the whole thing), so this needs just the
 * head pipeline id, not the per-job breakdown `getMergeRequestChecks`
 * fetches. If nothing on the pipeline is retryable, GitLab's API
 * rejects the retry and the error surfaces through the normal
 * `runGlabAction` path.
 */
export async function rerunFailedMergeRequestChecks(
  projectPath: string,
  mergeRequestNumber: number,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  try {
    const pipelineId = await resolveHeadPipelineId(projectPath, mergeRequestNumber, runner)
    if (!pipelineId) {
      return { ok: false, message: `No pipeline found for merge request !${mergeRequestNumber}.` }
    }
    return await runGlabAction(
      runner,
      ['api', '--method', 'POST', `projects/${enc(projectPath)}/pipelines/${pipelineId}/retry`],
      () => ({
        ok: true,
        message: `Retried pipeline #${pipelineId} for merge request !${mergeRequestNumber}.`,
      }),
      hostname
    )
  } catch (error) {
    const { message } = await resolveGlabActionError(error, runner, hostname)
    return { ok: false, message }
  }
}

/**
 * `PUT /merge_requests/:iid/merge` with `merge_when_pipeline_succeeds`
 * — GitLab's auto-merge equivalent. There is no rebase-strategy
 * counterpart on this endpoint (GitLab models rebase as a separate
 * `mr rebase` action, not a merge-time strategy), so that strategy is
 * declined with an explanation rather than silently falling back to a
 * plain merge.
 */
export async function enableMergeRequestAutoMerge(
  projectPath: string,
  mergeRequestNumber: number,
  strategy: PullRequestMergeStrategy,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  if (strategy === 'rebase') {
    return {
      ok: false,
      message: 'GitLab auto-merge does not support the rebase strategy. Use merge or squash, or run `glab mr rebase` first.',
    }
  }

  const body: Record<string, unknown> = { merge_when_pipeline_succeeds: true }
  if (strategy === 'squash') body.squash = true

  return runGlabAction(
    runner,
    [
      'api',
      '--method', 'PUT',
      `projects/${enc(projectPath)}/merge_requests/${mergeRequestNumber}/merge`,
      // `-F` (not `-f`) so booleans serialize as real JSON `true`, not
      // the string `"true"` — `merge_when_pipeline_succeeds`/`squash`
      // are both booleans on this endpoint.
      ...Object.entries(body).flatMap(([field, fieldValue]) => ['-F', `${field}=${fieldValue}`]),
    ],
    () => ({
      ok: true,
      message: `Enabled auto-merge (${strategy}) for merge request !${mergeRequestNumber}`,
    }),
    hostname
  )
}

/**
 * `glab mr diff <n>` argv (#1363). `--color=never` keeps the patch free
 * of ANSI escapes regardless of glab's TTY detection — the workstation
 * applies its own +/- theming per line.
 */
export function buildMergeRequestDiffArgs(mergeRequestNumber: number): string[] {
  return ['mr', 'diff', String(mergeRequestNumber), '--color=never']
}

/**
 * `glab mr reopen <n>` — the GitLab counterpart of `reopenIssue` (#1933).
 * Recovers an MR closed via `closeMergeRequestByNumber`.
 */
export function reopenMergeRequestByNumber(
  mergeRequestNumber: number,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  return runGlabAction(
    runner,
    ['mr', 'reopen', String(mergeRequestNumber)],
    (output) => ({
      ok: true,
      message: output.trim() || `Reopened merge request !${mergeRequestNumber}`,
    }),
    hostname
  )
}

/**
 * Draft prefixes GitLab recognizes on an MR title — "Draft:" is current,
 * "WIP:" is the legacy convention it still honors, and both also match in
 * their bracket (`[Draft]`) and paren (`(Draft)`) forms, which GitLab's own
 * draft detection treats identically to the colon form.
 */
const DRAFT_TITLE_PREFIX = /^\s*(?:\[\s*(?:draft|wip)\s*\]|\(\s*(?:draft|wip)\s*\)|(?:draft|wip)\s*:)\s*/i

async function fetchMergeRequestTitle(
  projectPath: string,
  mergeRequestNumber: number,
  runner: GlabRunner
): Promise<string | undefined> {
  const out = (
    await runner(['api', `projects/${encodeURIComponent(projectPath)}/merge_requests/${mergeRequestNumber}`])
  ).trim()
  const mr = out ? (JSON.parse(out) as { title?: string }) : undefined
  return mr?.title
}

/**
 * Promote a draft MR to ready for review (#1933), the glab counterpart of
 * `gh pr ready`. glab has no dedicated "ready" verb — GitLab's draft state
 * is carried by a `Draft:` (or legacy `WIP:`) title prefix, so this fetches
 * the current title via `glab api` and PUTs it back with the prefix
 * stripped. A title with neither prefix is left untouched (already ready)
 * so a user-authored title that merely mentions "draft" mid-sentence is
 * never rewritten.
 */
export async function markMergeRequestReadyByNumber(
  projectPath: string,
  mergeRequestNumber: number,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  try {
    const title = await fetchMergeRequestTitle(projectPath, mergeRequestNumber, runner)
    if (title === undefined) {
      return { ok: false, message: `Could not fetch merge request !${mergeRequestNumber}.` }
    }
    if (!DRAFT_TITLE_PREFIX.test(title)) {
      return { ok: true, message: `Merge request !${mergeRequestNumber} is not a draft` }
    }
    const readyTitle = title.replace(DRAFT_TITLE_PREFIX, '')
    if (!readyTitle.trim()) {
      return {
        ok: false,
        message: `Cannot mark merge request !${mergeRequestNumber} ready: the title is only the draft prefix. Rename it first.`,
      }
    }
    return await runGlabAction(
      runner,
      [
        'api',
        `projects/${encodeURIComponent(projectPath)}/merge_requests/${mergeRequestNumber}`,
        '-X', 'PUT',
        '-f', `title=${readyTitle}`,
      ],
      () => ({ ok: true, message: `Marked merge request !${mergeRequestNumber} as ready for review` }),
      hostname
    )
  } catch (error) {
    const { message, details } = await resolveGlabActionError(error, runner, hostname)
    return { ok: false, message, ...(details && details.length ? { details } : {}) }
  }
}

/**
 * Unified-patch fetch for a merge request by number — the GitLab
 * counterpart of `getPullRequestDiff` (#1363). Returns the shared
 * `PullRequestDiffResult` so the workstation's PR-diff hydration
 * treats both forges uniformly.
 */
export async function getMergeRequestDiff(
  mergeRequestNumber: number,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestDiffResult> {
  try {
    const output = await runner(buildMergeRequestDiffArgs(mergeRequestNumber))
    return { ok: true, lines: parsePullRequestDiffLines(output) }
  } catch (error) {
    const { message } = await resolveGlabActionError(error, runner, hostname)
    return { ok: false, message }
  }
}
