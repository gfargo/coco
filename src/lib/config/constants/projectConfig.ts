/**
 * Leaf module — no imports. Contains shared constants used by both
 * `services/project.ts` and `utils/scopedConfigFile.ts`. Extracted to break
 * the circular dependency introduced in #1816 (ad37fae6).
 *
 * Do NOT add imports to this file; it must remain a dependency-free leaf so
 * that neither consumer ends up depending on the other.
 */

/**
 * The filenames coco looks for when resolving a project-scoped config,
 * in priority order. Exported so callers that need the raw list (the
 * workstation's editor-open flow, `coco init`) don't have to hardcode
 * their own copy (#1731).
 */
export const PROJECT_CONFIG_CANDIDATES = ['.coco.json', '.coco.config.json'] as const

/**
 * A repo-committed `.coco.json` / `.coco.config.json` is untrusted content —
 * anyone who can get a victim to `git clone` a repo controls this file. Only
 * "tuning" knobs are honored from it; anything that decides WHERE a request
 * goes or WHAT credentials it carries must come from a trusted layer (the
 * built-in default, XDG config, `~/.gitconfig`, or env vars), never from the
 * repo itself. Otherwise a hostile repo can point `service.baseURL` /
 * `endpoint` / `authentication` / `fields` at an attacker's server and the
 * victim's real API key (and staged diffs) get sent there on `coco commit`.
 *
 * `provider` is intentionally allowlisted: switching provider alone, with
 * baseURL/endpoint/authentication/fields still pinned to trusted values, can
 * at worst misroute to a different provider's OFFICIAL endpoint using a key
 * the user already had configured for it — a nuisance, not an exfiltration
 * vector.
 */
export const TRUSTED_PROJECT_SERVICE_KEYS = [
  'model',
  'tokenLimit',
  'temperature',
  'maxConcurrent',
  'minTokensForSummary',
  'maxFileTokens',
  'maxParsingAttempts',
  'dynamicModels',
  'dynamicModelPreference',
  'streaming',
  'fastPath',
  'requestOptions',
  'provider',
] as const
