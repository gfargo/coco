/**
 * Forge-aware noun vocabulary for the workstation TUI.
 *
 * GitHub (and GitHub Enterprise) and unsupported remotes speak in
 * "Pull request(s)" / "PR"; GitLab speaks in "Merge request(s)" / "MR".
 * Surfaces derive the active forge from
 * `context.provider?.repository.provider` and pull the right nouns from
 * here so the user-visible copy matches the platform they're on.
 */
import type { GitProviderType } from '../../git/providerData'

export type ForgeNouns = {
  abbrev: string
  singular: string
  plural: string
  singularLower: string
  pluralLower: string
  /** The forge's CLI binary ("gh" / "glab") for install/auth hints. */
  cli: string
  /** Human display name of the forge ("GitHub" / "GitLab"). */
  name: string
  /**
   * Override for forges with no CLI binary to install (Gitea/Forgejo
   * authenticate via a `GITEA_TOKEN` env var) — see
   * `formatLogInkForgeUnauthenticated`'s `authHint`.
   */
  authHint?: string
}

export function forgeNouns(provider: GitProviderType | undefined): ForgeNouns {
  if (provider === 'gitlab') {
    return {
      abbrev: 'MR',
      singular: 'Merge request',
      plural: 'Merge requests',
      singularLower: 'merge request',
      pluralLower: 'merge requests',
      cli: 'glab',
      name: 'GitLab',
    }
  }
  if (provider === 'bitbucket') {
    return {
      abbrev: 'PR',
      singular: 'Pull request',
      plural: 'Pull requests',
      singularLower: 'pull request',
      pluralLower: 'pull requests',
      cli: 'bb',
      name: 'Bitbucket',
    }
  }
  if (provider === 'gitea') {
    return {
      abbrev: 'PR',
      singular: 'Pull request',
      plural: 'Pull requests',
      singularLower: 'pull request',
      pluralLower: 'pull requests',
      // No CLI dependency — Gitea/Forgejo auth is a GITEA_TOKEN env var, not a binary.
      cli: 'gitea',
      name: 'Gitea',
      authHint: 'Set the GITEA_TOKEN environment variable to enable triage.',
    }
  }
  return {
    abbrev: 'PR',
    singular: 'Pull request',
    plural: 'Pull requests',
    singularLower: 'pull request',
    pluralLower: 'pull requests',
    cli: 'gh',
    name: 'GitHub',
  }
}
