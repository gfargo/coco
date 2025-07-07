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

/**
 * Load git profile config (from ~/.gitconfig)
 *
 * @param {Config} config
 * @returns {Config} Updated config
 **/
export function loadGitConfig<ConfigType = Config>(config: Partial<Config>) {
  const gitConfigPath = path.join(os.homedir(), '.gitconfig')
  if (fs.existsSync(gitConfigPath)) {
    const gitConfigRaw = fs.readFileSync(gitConfigPath, 'utf-8')
    const gitConfigParsed = ini.parse(gitConfigRaw)

    let service: LLMService | undefined = config.service
    if (gitConfigParsed.coco) {
      service = {
        provider: gitConfigParsed.coco?.serviceProvider,
        model: gitConfigParsed.coco?.serviceModel,
        authentication: {
          type: 'APIKey',
          credentials: {
            apiKey: gitConfigParsed.coco?.serviceApiKey,
          },
        },
        requestOptions: {
          timeout: Number(gitConfigParsed.coco?.serviceRequestOptionsTimeout),
          maxRetries: Number(gitConfigParsed.coco?.serviceRequestOptionsMaxRetries),
        },
        endpoint: gitConfigParsed.coco?.serviceEndpoint,
        fields: gitConfigParsed.coco?.serviceFields
          ? JSON.parse(gitConfigParsed.coco?.serviceFields)
          : undefined,
      } as LLMService
    }

    config = {
      ...config,
      service: service,
      prompt: gitConfigParsed.coco?.prompt || config.prompt,
      mode: gitConfigParsed.coco?.mode || config.mode,
      summarizePrompt: gitConfigParsed.coco?.summarizePrompt || config.summarizePrompt,
      ignoredFiles: gitConfigParsed.coco?.ignoredFiles || config.ignoredFiles,
      ignoredExtensions: gitConfigParsed.coco?.ignoredExtensions || config.ignoredExtensions,
      defaultBranch: gitConfigParsed.coco?.defaultBranch || config.defaultBranch,
      verbose: gitConfigParsed.coco?.verbose || config.verbose,
      conventionalCommits: gitConfigParsed.coco?.conventionalCommits || config.conventionalCommits,
      openInEditor: gitConfigParsed.coco?.openInEditor || config.openInEditor,
      includeBranchName: gitConfigParsed.coco?.includeBranchName || config.includeBranchName,
    }
  }
  return removeUndefined(config) as ConfigType
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
        if (service.requestOptions?.timeout) {
          contentLines.push(`	serviceRequestOptionsTimeout = ${service.requestOptions.timeout}`)
        }
        if (service.requestOptions?.maxRetries) {
          contentLines.push(`	serviceRequestOptionsMaxRetries = ${service.requestOptions.maxRetries}`)
        }
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
