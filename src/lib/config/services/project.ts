import * as fs from 'fs'
import { Config } from '../types'
import { SCHEMA_PUBLIC_URL, schema } from '../../schema'
import { ajv } from '../../ajv'

const validate = ajv.compile(schema)

/**
 * Load project config
 *
 * Looks for `.coco.json` first (preferred), then falls back to `.coco.config.json`
 * for backward compatibility.
 *
 * @param {Config} config
 * @param {object} opts
 * @returns {Config} Updated config
 **/
export function loadProjectJsonConfig<ConfigType = Config>(
  config: Partial<Config>,
  opts: { returnSource: true }
): { config: ConfigType; path?: string }
export function loadProjectJsonConfig<ConfigType = Config>(
  config: Partial<Config>,
  opts?: { returnSource?: false }
): ConfigType
export function loadProjectJsonConfig<ConfigType = Config>(
  config: Partial<Config>,
  opts?: { returnSource?: boolean }
): ConfigType | { config: ConfigType; path?: string } {
  // Prefer .coco.json, fall back to .coco.config.json
  const candidates = ['.coco.json', '.coco.config.json']
  let resolvedPath: string | undefined

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      resolvedPath = candidate
      break
    }
  }

  if (resolvedPath) {
    // Removing $schema from the project config to avoid validation errors.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { $schema, ...projectConfig } = JSON.parse(
      fs.readFileSync(resolvedPath, 'utf-8')
    ) as Partial<Config> & { $schema: string }

    config = { ...config, ...projectConfig } as Config

    const isProjectConfigValid = validate(config)
    if (!isProjectConfigValid) {
      throw new Error('Invalid project config', { cause: ajv.errorsText(validate.errors) })
    }
  }

  if (opts?.returnSource) {
    return { config: config as ConfigType, path: resolvedPath }
  }
  return config as ConfigType
}

export const appendToProjectJsonConfig = (filePath: string, config: Partial<Config>) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '{}')
  }

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        $schema: SCHEMA_PUBLIC_URL,
        ...config,
      },
      null,
      2
    )
  )
}
