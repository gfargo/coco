import { BranchActionResult } from './branchActions'
import { defaultOpenUrlRunner, OpenUrlRunner } from './historyActions'
import { ProviderRepository, ProviderUrlTarget, buildProviderUrl } from './providerData'

export function openProviderUrl(
  repository: ProviderRepository | undefined,
  target: ProviderUrlTarget,
  openUrl: OpenUrlRunner = defaultOpenUrlRunner
): Promise<BranchActionResult> {
  const url = repository ? buildProviderUrl(repository, target) : undefined

  if (!url) {
    return Promise.resolve({
      ok: false,
      message: 'No supported remote provider URL is available.',
    })
  }

  return openUrl(url)
    .then(() => ({
      ok: true,
      message: `Opened provider URL: ${url}`,
      details: [url],
    }))
    .catch((error) => ({
      ok: false,
      message: (error as Error).message,
    }))
}

