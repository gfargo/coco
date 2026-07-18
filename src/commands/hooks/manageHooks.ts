import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import * as path from 'node:path'
import { SimpleGit } from 'simple-git'

export type HooksActionResult = {
  ok: boolean
  message: string
}

export type HooksStatusResult = {
  installed: boolean
  managedByCoco: boolean
  hooksDir: string
  hookPath: string
  message: string
}

/** Marks a hook file as coco-managed so install/uninstall/status can recognize it on re-read. */
export const HOOK_MARKER = '# coco:managed-hook prepare-commit-msg'

const HOOK_FILENAME = 'prepare-commit-msg'
const BACKUP_FILENAME = 'prepare-commit-msg.pre-coco'

/**
 * The installed hook script. Chains to a backed-up pre-existing hook first
 * (respecting its exit code, so a chained hook can still block the commit),
 * then fills the message file with a `coco commit --print-message` draft —
 * but only when the file has no real content yet, so a manual `-m`, a
 * template, or the chained hook's own output is never clobbered. Every
 * coco-specific step fails open: a missing `coco` binary or a generation
 * error leaves the message file untouched rather than blocking the commit.
 */
export const HOOK_SCRIPT = `#!/usr/bin/env sh
${HOOK_MARKER}
# Installed by \`coco hooks install\`. Do not edit by hand — re-run
# \`coco hooks install --force\` to regenerate, or \`coco hooks uninstall\` to remove.

COMMIT_MSG_FILE="$1"
COMMIT_SOURCE="$2"
HOOK_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
CHAINED_HOOK="$HOOK_DIR/${BACKUP_FILENAME}"

if [ -x "$CHAINED_HOOK" ]; then
  "$CHAINED_HOOK" "$@" || exit $?
fi

if [ -n "$COCO_SKIP" ]; then
  exit 0
fi

case "$COMMIT_SOURCE" in
  merge|squash|message|commit)
    exit 0
    ;;
esac

if [ -s "$COMMIT_MSG_FILE" ] && grep -vqE '^[[:space:]]*(#|$)' "$COMMIT_MSG_FILE"; then
  # A message is already present (manual -m, a template, or the chained hook
  # above supplied one) — don't clobber it.
  exit 0
fi

if ! command -v coco >/dev/null 2>&1; then
  exit 0
fi

GENERATED="$(coco commit --print-message --quiet 2>/dev/null)" || exit 0

if [ -n "$GENERATED" ]; then
  printf '%s\\n' "$GENERATED" > "$COMMIT_MSG_FILE"
fi

exit 0
`

/**
 * Resolves the hook directory the same way git itself would — honoring
 * `core.hooksPath` overrides and worktree-local git dirs — rather than
 * assuming `<repoRoot>/.git/hooks`.
 */
export async function resolveHooksDir(git: SimpleGit): Promise<string> {
  const output = await git.raw(['rev-parse', '--git-path', 'hooks'])
  return path.resolve(output.trim())
}

export async function installHooks({
  git,
  force = false,
}: {
  git: SimpleGit
  force?: boolean
}): Promise<HooksActionResult> {
  const hooksDir = await resolveHooksDir(git)
  mkdirSync(hooksDir, { recursive: true })

  const hookPath = path.join(hooksDir, HOOK_FILENAME)
  const backupPath = path.join(hooksDir, BACKUP_FILENAME)

  // `writeFileSync` follows symlinks, so a plain write here would clobber
  // whatever the symlink points at (e.g. a shared dispatcher script that
  // other hooks — pre-commit, pre-push, in this and other repos — also
  // symlink to). Refuse by default and only convert it once the caller
  // explicitly opts in with --force. Use lstatSync directly rather than
  // existsSync + lstatSync: existsSync follows symlinks and reports
  // false for a dangling one, which would let a broken symlink slip
  // through this check and still get written-through by writeFileSync.
  let hookStat
  try {
    hookStat = lstatSync(hookPath)
  } catch {
    hookStat = undefined
  }
  const isSymlink = hookStat?.isSymbolicLink() ?? false

  if (isSymlink && !force) {
    return {
      ok: false,
      message: `${hookPath} is a symlink, likely pointing at a shared hook script also used by other hooks. Writing through it would corrupt that shared target. Re-run with --force to replace the symlink with a coco-managed hook (its resolved content will be backed up to ${backupPath} first), or remove the symlink manually.`,
    }
  }

  const existing = existsSync(hookPath) ? readFileSync(hookPath, 'utf8') : undefined
  const alreadyManaged = !isSymlink && existing !== undefined && existing.includes(HOOK_MARKER)

  if (existing !== undefined && !alreadyManaged) {
    if (existsSync(backupPath) && !force) {
      return {
        ok: false,
        message: `An existing prepare-commit-msg hook is already backed up at ${backupPath}. Re-run with --force to overwrite it, or remove it manually first.`,
      }
    }
    writeFileSync(backupPath, existing, { mode: 0o755 })
  }

  if (isSymlink) {
    // Remove the symlink itself (not its target) so the write below creates
    // a fresh regular file instead of following the link.
    rmSync(hookPath)
  }

  writeFileSync(hookPath, HOOK_SCRIPT, { mode: 0o755 })

  return {
    ok: true,
    message:
      existing !== undefined && !alreadyManaged
        ? `Installed the prepare-commit-msg hook at ${hookPath} (existing hook backed up to ${backupPath}).`
        : `Installed the prepare-commit-msg hook at ${hookPath}.`,
  }
}

export async function uninstallHooks({ git }: { git: SimpleGit }): Promise<HooksActionResult> {
  const hooksDir = await resolveHooksDir(git)
  const hookPath = path.join(hooksDir, HOOK_FILENAME)
  const backupPath = path.join(hooksDir, BACKUP_FILENAME)

  if (!existsSync(hookPath)) {
    return { ok: true, message: 'No prepare-commit-msg hook is installed.' }
  }

  const content = readFileSync(hookPath, 'utf8')
  if (!content.includes(HOOK_MARKER)) {
    return {
      ok: false,
      message: `${hookPath} was not installed by coco — leaving it in place.`,
    }
  }

  rmSync(hookPath)

  if (existsSync(backupPath)) {
    renameSync(backupPath, hookPath)
    return {
      ok: true,
      message: `Removed coco's prepare-commit-msg hook and restored the previous hook at ${hookPath}.`,
    }
  }

  return { ok: true, message: "Removed coco's prepare-commit-msg hook." }
}

export async function getHooksStatus({ git }: { git: SimpleGit }): Promise<HooksStatusResult> {
  const hooksDir = await resolveHooksDir(git)
  const hookPath = path.join(hooksDir, HOOK_FILENAME)

  if (!existsSync(hookPath)) {
    return {
      installed: false,
      managedByCoco: false,
      hooksDir,
      hookPath,
      message: 'No prepare-commit-msg hook is installed.',
    }
  }

  const content = readFileSync(hookPath, 'utf8')
  const managedByCoco = content.includes(HOOK_MARKER)

  return {
    installed: true,
    managedByCoco,
    hooksDir,
    hookPath,
    message: managedByCoco
      ? `coco's prepare-commit-msg hook is installed at ${hookPath}.`
      : `A prepare-commit-msg hook exists at ${hookPath} but was not installed by coco.`,
  }
}
