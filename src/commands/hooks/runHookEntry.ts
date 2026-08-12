import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Arguments } from 'yargs'
import { generateCommitDraft } from '../commit/generateCommitDraft'
import { CommitOptions } from '../commit/config'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { HooksArgv } from './config'

/** Mirrors the shell hook's own "already has real content" check (`manageHooks.ts`'s `HOOK_SCRIPT`, via `grep -vqE '^[[:space:]]*(#|$)'`). */
function hasRealContent(content: string): boolean {
  return content.split('\n').some((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && !trimmed.startsWith('#')
  })
}

/**
 * `coco hooks run <messageFile>` — the thin entry point the `pre-commit`
 * framework's `prepare-commit-msg` hook stage invokes directly with the
 * commit-message file path (#2460), as an alternative to the native git
 * hook installed by `coco hooks install`.
 *
 * Fails open on every error, exactly like `HOOK_SCRIPT` in `manageHooks.ts`:
 * this must never throw and must never block a commit, so the entire body
 * runs inside a single `try`/`catch` that swallows everything.
 */
export async function runHookEntry(argv: HooksArgv): Promise<void> {
  try {
    if (!argv.messageFile) {
      return
    }

    if (process.env.COCO_SKIP) {
      return
    }

    const existing = existsSync(argv.messageFile) ? readFileSync(argv.messageFile, 'utf8') : ''
    if (hasRealContent(existing)) {
      // A message is already present (manual -m, a template, or an earlier
      // hook in the chain) — don't clobber it.
      return
    }

    const git = applyRepoFlag(argv)
    const result = await generateCommitDraft({ git, argv: argv as unknown as Arguments<CommitOptions> })

    if (result.ok && result.draft) {
      writeFileSync(argv.messageFile, `${result.draft}\n`)
    }
  } catch {
    // Fail open — never block a commit on a coco error.
  }
}
