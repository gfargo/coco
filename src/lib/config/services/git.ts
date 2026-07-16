import * as fs from 'fs'
import * as ini from 'ini'
import * as os from 'os'
import * as path from 'path'

import { LLMService, OllamaLLMService } from '../../langchain/types'
import { CONFIG_ALREADY_EXISTS } from '../../ui/helpers'
import { removeUndefined } from '../../utils/removeUndefined'
import { updateFileSection } from '../../utils/updateFileSection'
import { COCO_CONFIG_END_COMMENT, COCO_CONFIG_START_COMMENT } from '../constants'
import { Config } from '../types'
import { splitList } from '../utils/splitList'

/**
 * Load git profile config (from ~/.gitconfig)
 *
 * @param {Config} config
 * @param {object} opts
 * @returns {Config} Updated config
 **/
export function loadGitConfig<ConfigType = Config>(
  config: Partial<Config>,
  opts: { returnSource: true }
): { config: ConfigType; path?: string }
export function loadGitConfig<ConfigType = Config>(
  config: Partial<Config>,
  opts?: { returnSource?: false }
): ConfigType
export function loadGitConfig<ConfigType = Config>(
  config: Partial<Config>,
  opts?: { returnSource?: boolean }
): ConfigType | { config: ConfigType; path?: string } {
  const gitConfigPath = path.join(os.homedir(), '.gitconfig')
  let foundPath: string | undefined

  if (fs.existsSync(gitConfigPath)) {
    const gitConfigRaw = fs.readFileSync(gitConfigPath, 'utf-8')
    const gitConfigParsed = ini.parse(gitConfigRaw)

    let service: LLMService | undefined = config.service
    if (gitConfigParsed.coco) {
      foundPath = gitConfigPath

      // Build OVERRIDES from gitconfig — only include keys the user
      // actually set. Then merge on top of the existing service
      // (default or earlier layer) so unset fields keep their
      // defaults instead of getting wiped.
      //
      // The previous behavior had three latent bugs:
      //   1. Replaced the whole service object — wiped default
      //      tokenLimit / temperature / maxConcurrent / etc.
      //   2. Constructed `requestOptions` unconditionally with
      //      `Number(undefined) === NaN` for unset sub-fields →
      //      JSON-serializes to `null` → schema rejects.
      //   3. Attached `endpoint` and `baseURL` unconditionally → the
      //      per-provider schema variants (`additionalProperties:
      //      false` on each anyOf branch) reject the irrelevant one.
      const coco = gitConfigParsed.coco
      const numberOrUndefined = (raw: unknown): number | undefined => {
        if (raw === undefined || raw === null || raw === '') return undefined
        const n = Number(raw)
        return Number.isFinite(n) ? n : undefined
      }
      const requestOptionsOverrides: { timeout?: number; maxRetries?: number } = {}
      const timeout = numberOrUndefined(coco.serviceRequestOptionsTimeout)
      const maxRetries = numberOrUndefined(coco.serviceRequestOptionsMaxRetries)
      if (timeout !== undefined) requestOptionsOverrides.timeout = timeout
      if (maxRetries !== undefined) requestOptionsOverrides.maxRetries = maxRetries

      const overrides: Record<string, unknown> = {}
      if (coco.serviceProvider) overrides.provider = coco.serviceProvider
      if (coco.serviceModel) overrides.model = coco.serviceModel
      const tokenLimit = numberOrUndefined(coco.serviceTokenLimit)
      if (tokenLimit !== undefined) overrides.tokenLimit = tokenLimit
      const temperature = numberOrUndefined(coco.serviceTemperature)
      if (temperature !== undefined) overrides.temperature = temperature
      const maxConcurrent = numberOrUndefined(coco.serviceMaxConcurrent)
      if (maxConcurrent !== undefined) overrides.maxConcurrent = maxConcurrent
      const minTokensForSummary = numberOrUndefined(coco.serviceMinTokensForSummary)
      if (minTokensForSummary !== undefined) overrides.minTokensForSummary = minTokensForSummary
      const maxFileTokens = numberOrUndefined(coco.serviceMaxFileTokens)
      if (maxFileTokens !== undefined) overrides.maxFileTokens = maxFileTokens
      const maxParsingAttempts = numberOrUndefined(coco.serviceMaxParsingAttempts)
      if (maxParsingAttempts !== undefined) overrides.maxParsingAttempts = maxParsingAttempts

      // Provider-specific keys only attach when relevant to the
      // chosen (or pre-existing) provider — keeps the merged service
      // shape consistent with whichever schema variant should match.
      const effectiveProvider = (coco.serviceProvider || service?.provider) as
        | 'openai' | 'ollama' | 'anthropic' | undefined
      if (effectiveProvider === 'openai' && coco.serviceBaseURL) {
        overrides.baseURL = coco.serviceBaseURL
      }
      if (effectiveProvider === 'ollama' && coco.serviceEndpoint) {
        overrides.endpoint = coco.serviceEndpoint
      }
      if (coco.serviceFields) {
        try {
          overrides.fields = JSON.parse(coco.serviceFields)
        } catch {
          // Malformed JSON in serviceFields — skip rather than throw.
          // The loader's job isn't to validate user input here, just
          // to surface what's parseable. The schema validator runs
          // later and will catch a missing required field if any.
        }
      }
      // requestOptions only gets attached when at least one sub-field
      // was actually set. Empty `{}` would still serialize cleanly
      // but stays out of the merged shape for readability.
      if (Object.keys(requestOptionsOverrides).length > 0) {
        overrides.requestOptions = requestOptionsOverrides
      }
      // Authentication: only when an apiKey was provided. Default
      // service ships with an empty-credential placeholder for users
      // who'll set the key via env var; gitconfig's apiKey should
      // override that path, not the structure itself.
      if (coco.serviceApiKey) {
        overrides.authentication = {
          type: 'APIKey',
          credentials: { apiKey: coco.serviceApiKey },
        }
      }

      service = { ...(service || {}), ...overrides } as LLMService
    }

    config = {
      ...config,
      service: service,
      prompt: gitConfigParsed.coco?.prompt || config.prompt,
      mode: gitConfigParsed.coco?.mode || config.mode,
      summarizePrompt: gitConfigParsed.coco?.summarizePrompt || config.summarizePrompt,
      ignoredFiles: splitList(gitConfigParsed.coco?.ignoredFiles) || config.ignoredFiles,
      ignoredExtensions:
        splitList(gitConfigParsed.coco?.ignoredExtensions) || config.ignoredExtensions,
      defaultBranch: gitConfigParsed.coco?.defaultBranch || config.defaultBranch,
      verbose: gitConfigParsed.coco?.verbose || config.verbose,
      conventionalCommits: gitConfigParsed.coco?.conventionalCommits || config.conventionalCommits,
      openInEditor: gitConfigParsed.coco?.openInEditor || config.openInEditor,
      includeBranchName: gitConfigParsed.coco?.includeBranchName || config.includeBranchName,
    }
  }

  const cleaned = removeUndefined(config) as ConfigType
  if (opts?.returnSource) {
    return { config: cleaned, path: foundPath }
  }
  return cleaned
}

/**
 * Appends the provided configuration to a git config file.
 *
 * @param filePath - The path to the .gitconfig
 * @param config - The configuration object to append.
 */
export const appendToGitConfig = async (filePath: string, config: Partial<Config>) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File ${filePath} does not exist.`)
  }

  const header = '[coco]'

  const getNewContent = async () => {
    const contentLines = [header]
    for (const key in config) {
      const value = config[key as keyof Config]
      if (key === 'service') {
        const service = value as LLMService
        contentLines.push(`	serviceProvider = ${service.provider}`)
        contentLines.push(`	serviceModel = ${service.model}`)
        if (service.authentication.type === 'APIKey') {
          contentLines.push(`	serviceApiKey = ${service.authentication.credentials.apiKey}`)
        }
        if (service.tokenLimit !== undefined) {
          contentLines.push(`	serviceTokenLimit = ${service.tokenLimit}`)
        }
        if (service.temperature !== undefined) {
          contentLines.push(`	serviceTemperature = ${service.temperature}`)
        }
        if (service.maxConcurrent !== undefined) {
          contentLines.push(`	serviceMaxConcurrent = ${service.maxConcurrent}`)
        }
        if (service.minTokensForSummary !== undefined) {
          contentLines.push(`	serviceMinTokensForSummary = ${service.minTokensForSummary}`)
        }
        if (service.maxFileTokens !== undefined) {
          contentLines.push(`	serviceMaxFileTokens = ${service.maxFileTokens}`)
        }
        if (service.maxParsingAttempts !== undefined) {
          contentLines.push(`	serviceMaxParsingAttempts = ${service.maxParsingAttempts}`)
        }
        if (service.requestOptions?.timeout) {
          contentLines.push(`	serviceRequestOptionsTimeout = ${service.requestOptions.timeout}`)
        }
        if (service.requestOptions?.maxRetries) {
          contentLines.push(`	serviceRequestOptionsMaxRetries = ${service.requestOptions.maxRetries}`)
        }
        // Handle baseURL for OpenAI
        if (service.provider === 'openai' && 'baseURL' in service && service.baseURL) {
          contentLines.push(`	serviceBaseURL = ${service.baseURL}`)
        }
        // Handle endpoint for Ollama
        if (service.provider === 'ollama') {
          const ollamaService = service as OllamaLLMService;
          if (ollamaService.endpoint) {
            contentLines.push(`	serviceEndpoint = ${ollamaService.endpoint}`);
          }
        }
        if (service.fields) {
          contentLines.push(`	serviceFields = ${JSON.stringify(service.fields)}`)
        }
      } else if (typeof value === 'string' && value.includes('\n')) {
        // Wrap strings with new lines in quotes
        contentLines.push(`\t${key} = ${JSON.stringify(value)}`)
      } else {
        contentLines.push(`\t${key} = ${value}`)
      }
    }
    return contentLines.join('\n')
  }

  await updateFileSection({
    filePath,
    startComment: COCO_CONFIG_START_COMMENT,
    endComment: COCO_CONFIG_END_COMMENT,
    getNewContent,
    confirmUpdate: true,
    confirmMessage: CONFIG_ALREADY_EXISTS,
  })
}
