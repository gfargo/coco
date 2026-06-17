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
    // Parse defensively. A malformed config file (a stray comma, an
    // unquoted key) must NOT crash the whole tool — that's the same
    // philosophy the validation path below spells out: a recoverable
    // config problem should warn, not blow up at load time (which, since
    // config loads early, took down every command with a raw stack trace).
    // On a parse error we warn loudly with the file + the reason, then
    // fall back to the other config sources so coco still runs.
    let parsed: (Partial<Config> & { $schema?: string }) | undefined
    try {
      parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8')) as Partial<Config> & {
        $schema?: string
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.warn(
        `[coco] Warning: could not parse ${resolvedPath} as JSON — ignoring it.\n` +
        `  Parse error: ${reason}\n` +
        `  Fix the file's syntax (or run \`coco init\` to regenerate it). ` +
        `Other config sources (defaults, XDG, git, env) still apply.`
      )
    }

    if (parsed) {
    // Removing $schema from the project config to avoid validation errors.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { $schema, ...projectConfig } = parsed

    const merged = { ...config, ...projectConfig } as Config

    // Validate the merged result, but DON'T throw on failure.
    // Reasons:
    //
    //   1. Throwing turns "you have a stale field somewhere in your
    //      config" into "the whole tool fails to boot" — every coco
    //      command that loads config crashes. That's a brutal
    //      regression cost for what's almost always a recoverable
    //      situation.
    //
    //   2. The validation runs on the MERGED config, so the actual
    //      offending file might be the XDG / git / env layer, not
    //      the local project file we're nominally loading. Pinning
    //      the error to "project config" was actively misleading.
    //
    //   3. We have sane defaults. A drifted service shape can fall
    //      back to the default service and the rest of the tool
    //      keeps working — the user still gets their commits, their
    //      changelogs, their PR flows, etc.
    //
    // Instead: warn loudly to stderr (with the file path AND the
    // specific schema errors) so the user knows exactly what to fix,
    // and apply the merge so the user's intent still flows through.
    // If a downstream component genuinely can't operate without a
    // valid service shape, it can guard against that locally with a
    // clear error rather than blowing up at config-load time.
    const isProjectConfigValid = validate(merged)
    if (!isProjectConfigValid) {
      const errors = ajv.errorsText(validate.errors)
      console.warn(
        `[coco] Warning: config validation issues detected (continuing with merged config).\n` +
        `  Local file:   ${resolvedPath}\n` +
        `  Schema issues: ${errors}\n` +
        `  Fix the offending fields to silence this warning. The validation runs ` +
        `against the merged result of every config source (defaults, XDG, git, project, env) ` +
        `— the issue may be in any of those, not necessarily this file.`
      )
    }
    config = merged
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
