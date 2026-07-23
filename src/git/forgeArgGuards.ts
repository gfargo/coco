/**
 * Defensive guards for values that flow into gh/glab argv. With execFile (no
 * shell) there is no command injection, but a value beginning with '-' can be
 * misparsed by gh/glab as a flag, and glab comma-splits assignee/label lists.
 * Action builders pass values as `--flag=value` (so flag injection is already
 * neutralized), and these guards reject the few shapes that could still alter
 * operation semantics.
 */
export function rejectFlagLike(value: string, label: string): string | undefined {
  if (value.startsWith('-')) return `${label} cannot start with '-'.`
  return undefined
}

export function rejectUnsafeUsername(value: string): string | undefined {
  if (value.startsWith('-')) return `Username '${value}' cannot start with '-'.`
  if (/[,\s]/.test(value)) return `Username '${value}' cannot contain commas or whitespace.`
  return undefined
}

/**
 * gh and glab both comma-split `--add-label` / `--label` values, so a
 * label whose name contains a comma would be silently split into
 * multiple labels — attaching the wrong ones or erroring. Reject up
 * front with a clear message (#1710).
 */
export function rejectUnsafeLabel(value: string): string | undefined {
  if (value.startsWith('-')) return `Label '${value}' cannot start with '-'.`
  if (value.includes(',')) return `Label '${value}' contains a comma, which gh/glab would split into multiple labels.`
  return undefined
}
