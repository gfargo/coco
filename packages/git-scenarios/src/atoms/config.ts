import type { Step } from './types'

/**
 * Set a local git config value (`git config <key> <value>`). Scoped
 * to the repository — does not touch the user's global config.
 *
 *   setConfig('commit.template', '.gitmessage')   // pin a template
 *   setConfig('user.signingkey', 'ABC123')        // simulate gpg setup
 *   setConfig('merge.conflictstyle', 'diff3')     // tweak diff style
 *
 * Used by scenarios that exercise tools' reading of repo config —
 * commit-message templates, signing-key detection, merge-tool
 * configuration, hooks paths, etc.
 *
 * Pass `unset: true` to remove the key (`git config --unset <key>`)
 * instead of setting it. Useful for scenarios that test "what
 * happens when this config is missing."
 */
export function setConfig(
  key: string,
  value: string,
  options: { unset?: boolean } = {},
): Step {
  return async (repo) => {
    if (options.unset) {
      await repo.git.raw(['config', '--unset', key])
      return
    }
    await repo.git.raw(['config', key, value])
  }
}
