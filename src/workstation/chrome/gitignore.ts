/**
 * Derive a short menu of sensible `.gitignore` patterns from the path of
 * the cursored worktree file (the "add to .gitignore" quick-pick, `i` on
 * the status view).
 *
 * The goal is to turn the common asks — "ignore exactly this", "ignore
 * everything with this extension", "ignore this whole folder" — into
 * one-keystroke choices, while always offering a `Custom pattern…` escape
 * hatch that opens a free-text prompt for anything the menu doesn't cover
 * (negations, globs, anchored paths, etc.).
 *
 * Pure / synchronous so it's trivially unit-testable and reusable from the
 * reducer, the input handler, and the overlay renderer without pulling in
 * `fs`.
 */

export type GitignoreOption = {
  /**
   * The pattern written to `.gitignore` when this option is chosen. For
   * the `custom` option it's the value the free-text prompt is pre-filled
   * with (so the user starts from the exact path and edits from there).
   */
  pattern: string
  /** Human-readable label shown in the picker. */
  label: string
  /**
   * When true, choosing this option opens a free-text input prompt seeded
   * with `pattern` instead of writing it directly — for arbitrary valid
   * gitignore syntax the derived options don't cover.
   */
  custom: boolean
}

/**
 * Build the option list for a repo-relative path. Git reports untracked
 * directories with a trailing slash (`.www/`), which is how we tell a
 * directory from a file. Duplicate patterns are collapsed (e.g. a
 * top-level dir whose anchored and bare forms would otherwise repeat).
 */
export function deriveGitignoreOptions(rawPath: string): GitignoreOption[] {
  const input = rawPath.trim()
  const options: GitignoreOption[] = []
  const seen = new Set<string>()
  const add = (pattern: string, label: string): void => {
    if (!pattern || seen.has(pattern)) return
    seen.add(pattern)
    options.push({ pattern, label, custom: false })
  }

  if (input) {
    const isDir = input.endsWith('/')
    const clean = input.replace(/\/+$/, '')
    const segments = clean.split('/').filter(Boolean)
    const base = segments[segments.length - 1] || clean
    const parent = segments.slice(0, -1).join('/')

    if (isDir) {
      // Anchored to the repo root vs. matching any folder of that name.
      add(`/${clean}/`, `This folder only (/${clean}/)`)
      add(`${base}/`, `Any “${base}/” folder`)
    } else {
      add(input, `This file only (${input})`)
      const dot = base.lastIndexOf('.')
      if (dot > 0 && dot < base.length - 1) {
        const ext = base.slice(dot)
        add(`*${ext}`, `All ${ext} files (*${ext})`)
      }
      if (parent) {
        add(`${parent}/`, `Its folder (${parent}/)`)
      }
      add(base, `Any file named “${base}”`)
    }
  }

  options.push({
    pattern: input,
    label: 'Custom pattern…',
    custom: true,
  })
  return options
}
