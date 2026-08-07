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
import { en } from '../../lib/i18n/en'
import { t } from '../../lib/i18n/t'

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
      abbrev: t(en, 'forge.gitlab.abbrev'),
      singular: t(en, 'forge.gitlab.singular'),
      plural: t(en, 'forge.gitlab.plural'),
      singularLower: t(en, 'forge.gitlab.singularLower'),
      pluralLower: t(en, 'forge.gitlab.pluralLower'),
      cli: 'glab',
      name: t(en, 'forge.gitlab.name'),
    }
  }
  if (provider === 'bitbucket') {
    return {
      abbrev: t(en, 'forge.bitbucket.abbrev'),
      singular: t(en, 'forge.bitbucket.singular'),
      plural: t(en, 'forge.bitbucket.plural'),
      singularLower: t(en, 'forge.bitbucket.singularLower'),
      pluralLower: t(en, 'forge.bitbucket.pluralLower'),
      cli: 'bb',
      name: t(en, 'forge.bitbucket.name'),
    }
  }
  if (provider === 'bitbucket-server') {
    return {
      abbrev: t(en, 'forge.bitbucketServer.abbrev'),
      singular: t(en, 'forge.bitbucketServer.singular'),
      plural: t(en, 'forge.bitbucketServer.plural'),
      singularLower: t(en, 'forge.bitbucketServer.singularLower'),
      pluralLower: t(en, 'forge.bitbucketServer.pluralLower'),
      // No CLI dependency — Bitbucket Server auth is env vars, not a binary.
      cli: 'bitbucket-server',
      name: t(en, 'forge.bitbucketServer.name'),
      authHint: t(en, 'forge.bitbucketServer.authHint'),
    }
  }
  if (provider === 'gitea') {
    return {
      abbrev: t(en, 'forge.gitea.abbrev'),
      singular: t(en, 'forge.gitea.singular'),
      plural: t(en, 'forge.gitea.plural'),
      singularLower: t(en, 'forge.gitea.singularLower'),
      pluralLower: t(en, 'forge.gitea.pluralLower'),
      // No CLI dependency — Gitea/Forgejo auth is a GITEA_TOKEN env var, not a binary.
      cli: 'gitea',
      name: t(en, 'forge.gitea.name'),
      authHint: t(en, 'forge.gitea.authHint'),
    }
  }
  return {
    abbrev: t(en, 'forge.github.abbrev'),
    singular: t(en, 'forge.github.singular'),
    plural: t(en, 'forge.github.plural'),
    singularLower: t(en, 'forge.github.singularLower'),
    pluralLower: t(en, 'forge.github.pluralLower'),
    cli: 'gh',
    name: t(en, 'forge.github.name'),
  }
}
