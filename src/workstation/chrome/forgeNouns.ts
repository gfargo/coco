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
}

export function forgeNouns(provider: GitProviderType | undefined): ForgeNouns {
  if (provider === 'gitlab') {
    return {
      abbrev: 'MR',
      singular: 'Merge request',
      plural: 'Merge requests',
      singularLower: 'merge request',
      pluralLower: 'merge requests',
    }
  }
  return {
    abbrev: 'PR',
    singular: 'Pull request',
    plural: 'Pull requests',
    singularLower: 'pull request',
    pluralLower: 'pull requests',
  }
}
