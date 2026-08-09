import { BUILD_VERSION } from '../buildInfo'
import { loadConfig } from '../config/utils/loadConfig'
import { emitJson } from './emitJson'

export type VersionInfo = {
  version: string
  node: string
  platform: NodeJS.Platform
  arch: string
  provider: string | undefined
}

/**
 * Resolves the active provider best-effort — `loadConfig` can require reading
 * project/git config, so a broken or absent repo must never make `--version
 * --json` throw. Falls back to `undefined` rather than a hard failure.
 */
function resolveProvider(): string | undefined {
  try {
    return loadConfig({}).service?.provider
  } catch {
    return undefined
  }
}

export function buildVersionInfo(): VersionInfo {
  return {
    version: BUILD_VERSION,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    provider: resolveProvider(),
  }
}

export function emitVersionJson(): void {
  emitJson(buildVersionInfo())
}
