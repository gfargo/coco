/**
 * Flags for every `git diff` whose output is parsed or re-applied by coco
 * (hunk staging, the worktree diff, compare). User config otherwise leaks
 * into that output: `diff.external` replaces the patch with a tool's
 * format, `color.ui=always` embeds escape codes, `diff.noprefix` drops the
 * `a/` `b/` prefixes `git apply -p1` expects, and textconv rewrites the
 * content hunks are built from. Add new machine-parsed diff call sites
 * here rather than spelling the flags out again (#2200).
 */
export const MACHINE_DIFF_ARGS = [
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--src-prefix=a/',
  '--dst-prefix=b/',
] as const
