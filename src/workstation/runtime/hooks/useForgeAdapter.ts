/**
 * Forge adapter memo (extracted from app.ts, #1418 decomposition).
 *
 * Derives the forge-specific values from `context.provider` and memoizes
 * the `ForgeActions` instance so every loader / action below routes to the
 * right CLI without per-call-site branching.
 *
 * The cluster — four derived consts and one `useMemo` — is issued at the
 * original slot (after `useContextHydration` and before
 * `usePullRequestDiffHydration`). Hook order is preserved.
 *
 * `React` is injected per the runtime's convention.
 */

import type * as ReactTypes from 'react'
import type { LogInkContext } from '../types'
import type { GitProviderType } from '../../../git/providerData'
import { getForgeActions, type ForgeActions } from '../../../git/forgeActions'

export type UseForgeAdapterDeps = {
  context: LogInkContext
}

export type UseForgeAdapterResult = {
  forge: ForgeActions
  forgeProvider: GitProviderType | undefined
}

export function useForgeAdapter(
  React: typeof ReactTypes,
  deps: UseForgeAdapterDeps,
): UseForgeAdapterResult {
  const { context } = deps

  const forgeProvider = context.provider?.repository.provider
  const forgePath =
    context.provider?.repository.owner && context.provider?.repository.name
      ? `${context.provider.repository.owner}/${context.provider.repository.name}`
      : undefined
  const forgeGitlabHost = context.provider?.repository.host
  const forgeCurrentBranch = context.provider?.currentBranch

  const forge = React.useMemo(
    () => getForgeActions(forgeProvider, {
      gitlabPath: forgePath,
      gitlabHost: forgeGitlabHost,
      bitbucketPath: forgePath,
      giteaPath: forgePath,
      giteaHost: forgeGitlabHost,
      currentBranch: forgeCurrentBranch,
    }),
    [forgeProvider, forgePath, forgeGitlabHost, forgeCurrentBranch]
  )

  return { forge, forgeProvider }
}
