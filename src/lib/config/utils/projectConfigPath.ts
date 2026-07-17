import * as fs from 'fs'
import * as path from 'path'

/**
 * `.coco.json` is preferred; `.coco.config.json` is a legacy fallback. This
 * is the single source of truth for the candidate list — every reader or
 * writer that needs to find or default a project config file walks this
 * (via `findExistingProjectConfig` / `resolveProjectConfigPath`) instead of
 * keeping its own copy.
 *
 * Kept in its own module (rather than alongside `resolveScopedConfigPath`)
 * so `services/project.ts` can consume it without creating an import cycle
 * with `scopedConfigFile.ts` (which itself imports from `services/project.ts`).
 */
export const PROJECT_CONFIG_CANDIDATES = ['.coco.json', '.coco.config.json'] as const

/**
 * The first existing project config under `repoRoot`, or `undefined` if
 * neither candidate exists. For read-only callers (config loaders) that
 * need to distinguish "no project config yet" from "use the default path".
 */
export function findExistingProjectConfig(repoRoot: string): string | undefined {
  for (const candidate of PROJECT_CONFIG_CANDIDATES) {
    const candidatePath = path.join(repoRoot, candidate)
    if (fs.existsSync(candidatePath)) {
      return candidatePath
    }
  }
  return undefined
}

/**
 * The project config path to read from or write to under `repoRoot`: the
 * first existing candidate, or `.coco.json` (the first candidate) as the
 * default to create when neither exists yet.
 */
export function resolveProjectConfigPath(repoRoot: string): string {
  return findExistingProjectConfig(repoRoot) ?? path.join(repoRoot, PROJECT_CONFIG_CANDIDATES[0])
}
