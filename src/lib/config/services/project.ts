import * as fs from 'fs'
import * as path from 'path'
import { Config } from '../types'
import { SCHEMA_PUBLIC_URL, schema } from '../../schema'
import { ajv } from '../../ajv'
import { resolveGitRepoRoot } from '../../utils/resolveGitRepoRoot'
import {
  PROJECT_CONFIG_CANDIDATES,
  TRUSTED_PROJECT_SERVICE_KEYS,
  UNTRUSTED_PROJECT_TOP_LEVEL_KEYS,
} from '../constants/projectConfig'

export { TRUSTED_PROJECT_SERVICE_KEYS } from '../constants/projectConfig'

const validate = ajv.compile(schema)

/**
 * Mirrors the read-side filter above, but for the write path: strips
 * `authentication`/`baseURL`/`endpoint`/`fields` (and anything else not on
 * the allowlist) from a service object before it's persisted to a
 * repo-local `.coco.json`. Without this, `coco init --scope project` writes
 * fields the loader above immediately rejects as untrusted on every
 * subsequent run — a spurious warning about a file coco itself generated.
 */
export function pickTrustedProjectServiceFields<T extends Record<string, unknown>>(
  service: T
): Partial<T> {
  const trusted: Partial<T> = {}
  for (const key of TRUSTED_PROJECT_SERVICE_KEYS) {
    if (key in service) {
      trusted[key as keyof T] = service[key as keyof T]
    }
  }
  return trusted
}

/**
 * Config is loaded many times per command run — `loadConfig` is called
 * independently from the command handler, the command executor, the
 * default router, doctor, etc. Each call re-runs `loadProjectJsonConfig`,
 * so a single malformed `.coco.json` used to print the same warning 3×
 * for one invocation. We can't cheaply memoize the whole load (argv
 * differs per call and `applyRepoFlag` changes cwd between calls, which
 * changes how the relative `.coco.json` path resolves), so instead we
 * guard the warnings: each distinct (kind + file) warning fires at most
 * once for the lifetime of the process.
 */
const warnedKeys = new Set<string>()

function warnOnce(
  kind: 'parse' | 'validation' | 'untrusted-service-fields' | 'untrusted-top-level-fields',
  resolvedPath: string,
  message: string
): void {
  const key = `${kind}:${resolvedPath}`
  if (warnedKeys.has(key)) return
  warnedKeys.add(key)
  console.warn(message)
}

/**
 * Clears the warn-once guard. Intended for tests that exercise the
 * warning paths in isolation — production code never needs to reset it.
 */
export function resetConfigLoadWarnings(): void {
  warnedKeys.clear()
}

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
  opts: { returnSource: true; cwd?: string }
): { config: ConfigType; path?: string }
export function loadProjectJsonConfig<ConfigType = Config>(
  config: Partial<Config>,
  opts?: { returnSource?: false; cwd?: string }
): ConfigType
export function loadProjectJsonConfig<ConfigType = Config>(
  config: Partial<Config>,
  opts?: { returnSource?: boolean; cwd?: string }
): ConfigType | { config: ConfigType; path?: string } {
  // `coco init` writes `.coco.json` at the repo root (via
  // getProjectConfigFilePath → findProjectRoot), but this loader used to
  // test bare relative filenames — resolved against `process.cwd()`, not
  // the repo root. Running any command from a subdirectory silently
  // dropped the entire project config with no warning (#1616). Resolve
  // the repo root once (falling back to the given/current cwd outside a
  // git repo) so a subdirectory invocation finds the same file `coco init`
  // wrote. `opts.cwd` lets callers that already know the target repo root
  // (e.g. the MCP server's deferred-binding mode, which never `chdir`s)
  // resolve against it instead of `process.cwd()`.
  const repoRoot = resolveGitRepoRoot(opts?.cwd)
  let resolvedPath: string | undefined

  for (const candidate of PROJECT_CONFIG_CANDIDATES) {
    const candidatePath = path.join(repoRoot, candidate)
    if (fs.existsSync(candidatePath)) {
      resolvedPath = candidatePath
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
      warnOnce(
        'parse',
        resolvedPath,
        `[coco] Warning: could not parse ${resolvedPath} as JSON — ignoring it.\n` +
        `  Parse error: ${reason}\n` +
        `  Fix the file's syntax (or run \`coco init\` to regenerate it). ` +
        `Other config sources (defaults, XDG, git, env) still apply.`
      )
    }

    if (parsed) {
    // Removing $schema from the project config to avoid validation errors.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { $schema, service: projectService, ...rest } = parsed

    // A handful of top-level keys are excluded from the repo-local file the
    // same way untrusted service.* fields are below — see
    // UNTRUSTED_PROJECT_TOP_LEVEL_KEYS for why (#1840).
    const projectConfig: Record<string, unknown> = { ...rest }
    const rejectedTopLevelKeys: string[] = []
    for (const key of UNTRUSTED_PROJECT_TOP_LEVEL_KEYS) {
      if (key in projectConfig) {
        delete projectConfig[key]
        rejectedTopLevelKeys.push(key)
      }
    }

    if (rejectedTopLevelKeys.length > 0) {
      warnOnce(
        'untrusted-top-level-fields',
        resolvedPath,
        `[coco] Warning: ${resolvedPath} tried to set field(s) that a repo-local config is not ` +
        `trusted to control: ${rejectedTopLevelKeys.join(', ')}.\n` +
        `  These decide what runs on your machine and/or what credentials it uses, so they are ` +
        `ignored when set from a project file (anyone who can get you to clone a repo could ` +
        `otherwise choose the command line of a tool that edits your files).\n` +
        `  Configure them via an env var, \`~/.gitconfig\`, or your global (XDG) config instead.`
      )
    }

    const merged = { ...config, ...projectConfig } as Config

    // `service` is deep-merged (not shallow-spread like the rest of
    // projectConfig above) and filtered through the trust boundary: only
    // TRUSTED_PROJECT_SERVICE_KEYS from the repo-local file are honored.
    // See the comment on TRUSTED_PROJECT_SERVICE_KEYS for why.
    if (projectService) {
      const safeServiceOverrides: Record<string, unknown> = {}
      const rejectedKeys: string[] = []

      for (const [key, value] of Object.entries(projectService)) {
        if ((TRUSTED_PROJECT_SERVICE_KEYS as readonly string[]).includes(key)) {
          safeServiceOverrides[key] = value
        } else {
          rejectedKeys.push(key)
        }
      }

      if (rejectedKeys.length > 0) {
        warnOnce(
          'untrusted-service-fields',
          resolvedPath,
          `[coco] Warning: ${resolvedPath} tried to set service field(s) that a repo-local ` +
          `config is not trusted to control: ${rejectedKeys.join(', ')}.\n` +
          `  These determine where your requests go and/or what credentials they carry, so ` +
          `they are ignored when set from a project file (anyone who can get you to clone a ` +
          `repo could otherwise redirect your diffs and API key to their own server).\n` +
          `  Configure them via an env var, \`~/.gitconfig\`, or your global (XDG) config instead.`
        )
      }

      merged.service = {
        ...config.service,
        ...safeServiceOverrides,
      } as Config['service']
    }

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
      warnOnce(
        'validation',
        resolvedPath,
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
