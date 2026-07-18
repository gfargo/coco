/**
 * Defensive guards for values that flow into gh/glab argv. With execFile (no
 * shell) there is no command injection, but a value beginning with '-' can be
 * misparsed by gh/glab as a flag, and both CLIs comma-split assignee/label
 * lists. Action builders pass values as `--flag=value` (so flag injection is
 * already neutralized), and these guards reject the few shapes that could
 * still alter operation semantics.
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

export function rejectUnsafeLabel(value: string): string | undefined {
  if (value.startsWith('-')) return `Label '${value}' cannot start with '-'.`
  if (value.includes(',')) return `Label '${value}' cannot contain a comma (gh/glab treat commas as label separators).`
  return undefined
}
