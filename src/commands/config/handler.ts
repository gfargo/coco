import { ajv } from '../../lib/ajv'
import { DEFAULT_CONFIG } from '../../lib/config/constants'
import {
    coerceConfigValue,
    flattenToDottedPaths,
    getDottedPath,
    setDottedPath,
    toOnDiskConfigKey,
    unsetDottedPath,
} from '../../lib/config/utils/dottedPath'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { resolveConfigKeySource } from '../../lib/config/utils/resolveConfigKeySource'
import {
    checkProjectScopeKeyTrust,
    readScopedConfigFile,
    resolveScopedConfigPath,
    writeScopedConfigFile,
} from '../../lib/config/utils/scopedConfigFile'
import { schema } from '../../lib/schema'
import { CommandHandler } from '../../lib/types'
import { emitJson } from '../../lib/ui/emitJson'
import { commandExit } from '../../lib/utils/commandExit'
import { applyRepoCwd } from '../utils/applyRepoFlag'
import { ConfigArgv } from './config'

const validate = ajv.compile(schema)

/** Never print a real API key back to a terminal or --json output. */
function maskSecrets(key: string, value: unknown): unknown {
  const lastSegment = key.split('.').pop()?.toLowerCase()
  if (lastSegment === 'apikey' && typeof value === 'string' && value.length > 0) {
    return '•••••••••••••••'
  }
  return value
}

/**
 * Best-effort schema sanity check for a scoped write (#1605). Validates the
 * scope's OWN content layered on top of `DEFAULT_CONFIG` — not the full
 * multi-source effective config — so a partial project/global file that's
 * only ever meant to override a couple of keys doesn't fail validation for
 * omitting fields another layer supplies. Warns rather than blocking the
 * write, matching this codebase's existing config-validation philosophy
 * (`services/project.ts`): a recoverable config problem shouldn't crash the
 * command that's trying to fix it.
 */
function warnIfInvalid(scopeConfig: Record<string, unknown>, logger: Parameters<CommandHandler<ConfigArgv>>[1]): void {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { $schema, ...rest } = scopeConfig
  const trial = {
    ...DEFAULT_CONFIG,
    ...rest,
    service: { ...DEFAULT_CONFIG.service, ...(rest.service as Record<string, unknown> | undefined) },
  }
  if (!validate(trial)) {
    logger.log(
      `Warning: this value may not match coco's config schema: ${ajv.errorsText(validate.errors)}`,
      { color: 'yellow' }
    )
  }
}

export const handler: CommandHandler<ConfigArgv> = async (argv, logger) => {
  applyRepoCwd(argv)

  const { action, key, value, scope } = argv

  if (action === 'get') {
    // loadConfig({}) rather than loadConfig(argv) — argv carries yargs'
    // own bookkeeping fields (_, $0, action, scope, ...) that aren't real
    // config keys and would otherwise leak into the effective-config view.
    const effective = loadConfig({})
    const resolved = getDottedPath(effective, key as string)
    const { source, path } = resolveConfigKeySource(key as string)
    const masked = maskSecrets(key as string, resolved)

    if (argv.json) {
      emitJson({ key, value: masked ?? null, source, path })
      return
    }

    if (resolved === undefined) {
      logger.log(`${key} is not set.`, { color: 'yellow' })
      return
    }

    logger.log(`${key} = ${JSON.stringify(masked)}`)
    logger.log(`  source: ${source}${path ? ` (${path})` : ''}`, { color: 'gray' })
    return
  }

  if (action === 'list') {
    if (scope) {
      const filePath = resolveScopedConfigPath(scope)
      const raw = readScopedConfigFile(filePath)
      const flat = flattenToDottedPaths(raw)
      const masked = Object.fromEntries(
        Object.entries(flat).map(([k, v]) => [k, maskSecrets(k, v)])
      )
      if (argv.json) {
        emitJson({ scope, path: filePath, values: masked })
        return
      }
      logger.log(`${scope} scope (${filePath}):`)
      for (const [k, v] of Object.entries(masked)) {
        logger.log(`  ${k} = ${JSON.stringify(v)}`)
      }
      return
    }

    const effective = loadConfig({})
    const flat = flattenToDottedPaths(effective)
    const entries = Object.entries(flat).map(([k, v]) => {
      const { source, path } = resolveConfigKeySource(k)
      return { key: k, value: maskSecrets(k, v), source, path }
    })

    if (argv.json) {
      emitJson(entries)
      return
    }

    for (const entry of entries) {
      logger.log(`${entry.key} = ${JSON.stringify(entry.value)}  ${entry.source}${entry.path ? ` (${entry.path})` : ''}`)
    }
    return
  }

  if (action === 'set') {
    if (scope === 'project') {
      const trustError = checkProjectScopeKeyTrust(key as string)
      if (trustError) {
        logger.error(trustError, { color: 'red' })
        commandExit(1)
      }
    }

    const filePath = resolveScopedConfigPath(scope as 'global' | 'project')
    const raw = readScopedConfigFile(filePath)
    const coerced = coerceConfigValue(value as string)
    setDottedPath(raw, toOnDiskConfigKey(key as string), coerced)
    warnIfInvalid(raw, logger)
    writeScopedConfigFile(filePath, raw)

    logger.log(`Set ${key} in ${scope} scope (${filePath}).`, { color: 'green' })
    return
  }

  if (action === 'unset') {
    const filePath = resolveScopedConfigPath(scope as 'global' | 'project')
    const raw = readScopedConfigFile(filePath)
    unsetDottedPath(raw, toOnDiskConfigKey(key as string))
    writeScopedConfigFile(filePath, raw)

    logger.log(`Unset ${key} in ${scope} scope (${filePath}).`, { color: 'green' })
    return
  }
}
