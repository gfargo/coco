import { commitlintImpliesConventional } from '../../lib/utils/hasCommitlintConfig'

/**
 * Whether `coco commit` should generate conventional-format messages.
 *
 * Precedence: the `--conventional` flag, then an explicit
 * `conventionalCommits` setting (`false` opts out), then the project's
 * commitlint config. A repo whose commitlint config requires `type(scope):`
 * would otherwise have its commit-msg hook reject a plain message (#2130).
 *
 * `detectCommitlint` is false on untrusted-repository paths, where repository
 * config must not influence behavior implicitly.
 */
export async function resolveUseConventional({
  argvConventional,
  configConventional,
  detectCommitlint = true,
}: {
  argvConventional?: boolean
  configConventional?: boolean
  detectCommitlint?: boolean
}): Promise<boolean> {
  if (argvConventional) return true
  if (configConventional !== undefined) return configConventional
  return detectCommitlint ? commitlintImpliesConventional() : false
}
