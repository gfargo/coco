import * as fs from 'fs'
import * as ini from 'ini'
import * as os from 'os'
import * as path from 'path'

import { LLMService } from '../../langchain/types'
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
    const gitConfigServiceObject = gitConfigParsed.coco?.service

    let service: LLMService | undefined = config.service

    if (gitConfigServiceObject) {
      const gitServiceConfig = JSON.parse(gitConfigServiceObject)
      service = gitServiceConfig || config?.service
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
      if (typeof value === 'object') {
        // Serialize object to JSON string
        contentLines.push(`\t${key} = ${JSON.stringify(value)}`)
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
