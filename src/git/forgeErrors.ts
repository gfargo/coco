import type { GhActionError, GhStatus } from './githubCli'

/**
 * Compact a multi-line CLI/API error/stderr into a head line plus a bounded
 * set of detail lines, mirroring `operationActions.compactOutputLines`. Keeps
 * a raw stderr dump from flooding a notification. Shared by gh, glab, and
 * Bitbucket error handling so the three forges can't drift.
 */
export function compactCliError(message: string, opts: { fallback: string }): GhActionError {
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    // execFile prefixes its message with the entire echoed command line
    // ("Command failed: gh pr create --title=... --body=<pages of text>").
    // That line names no failure reason — and with a generated PR/MR body in
    // the argv it dwarfs the status line — so drop it and lead with the
    // CLI's actual stderr complaint.
    .filter((line) => !line.startsWith('Command failed:'))

  return {
    message: lines[0] || opts.fallback,
    details: lines.slice(1, 8),
  }
}

/**
 * Turn a thrown forge error into a user-facing message. Mutating forge
 * actions (PR / issue / MR create/merge/comment/...) don't pre-check auth, so
 * a session that de-authed mid-flight would otherwise dump raw stderr. We
 * probe the forge's status on the error path: if it's no longer `ok`, return
 * the curated recovery hint; otherwise compact the underlying error. The
 * probe is one extra call and only happens when an action has already
 * failed. Shared scaffold behind `resolveGhActionError`,
 * `resolveGlabActionError`, and `resolveBitbucketActionError`.
 */
export async function resolveForgeActionError(
  error: unknown,
  opts: {
    probe: () => Promise<GhStatus>
    describe: (status: GhStatus) => string
    fallback: string
  }
): Promise<GhActionError> {
  // Promisified execFile attaches the process stderr to the error — that's
  // where the CLI explains itself (e.g. "a pull request for branch X already
  // exists", auth guidance, …). Prefer it over `message`, which leads with
  // the echoed command line. Bitbucket errors have no `stderr` and fall
  // straight through to `.message`.
  const stderr = (error as { stderr?: unknown })?.stderr
  const raw =
    (typeof stderr === 'string' && stderr.trim() ? stderr : undefined) ||
    (error as Error)?.message ||
    opts.fallback

  try {
    const status = await opts.probe()
    if (status.kind !== 'ok') {
      return { message: opts.describe(status) }
    }
  } catch {
    // If even the status probe throws, fall back to compacting the raw error.
  }

  return compactCliError(raw, { fallback: opts.fallback })
}
