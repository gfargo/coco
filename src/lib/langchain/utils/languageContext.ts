export type LanguageContextOptions = {
  /** How the task is described in the sentence, e.g. 'commit message', 'changelog'. */
  taskDescription: string
  /**
   * Append a caveat keeping Conventional Commits type/scope tokens
   * (feat, fix, chore, ...) in English — only meaningful for tasks that
   * actually emit those tokens.
   */
  preserveConventionalTokens?: boolean
}

/**
 * Builds the `language_context` prompt variable from the `language` config
 * key (#1614). Empty string when unset, mirroring how `branch_name_context`
 * degrades — the template always declares the placeholder, so callers never
 * need to special-case the unset case.
 */
export function getLanguageContext(
  language: string | undefined,
  { taskDescription, preserveConventionalTokens }: LanguageContextOptions
): string {
  if (!language) {
    return ''
  }

  const base = `Write the ${taskDescription} in ${language}.`
  return preserveConventionalTokens
    ? `${base} Keep the Conventional Commits type/scope tokens (e.g. feat, fix, chore) in English.`
    : base
}
