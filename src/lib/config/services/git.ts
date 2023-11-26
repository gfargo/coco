import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as ini from 'ini'
import { Config } from '../types'
import { updateFileSection } from '../../utils/updateFileSection'

/**
 * Load git profile config (from ~/.gitconfig)
 *
 * @param {Config} config
 * @returns {Config} Updated config
 **/
export function loadGitConfig(config: Config): Config {
  const gitConfigPath = path.join(os.homedir(), '.gitconfig')
  if (fs.existsSync(gitConfigPath)) {
    const gitConfigRaw = fs.readFileSync(gitConfigPath, 'utf-8')
    const gitConfigParsed = ini.parse(gitConfigRaw)

    config = {
      ...config,
      service: gitConfigParsed.coco?.model || config.service,
      openAIApiKey: gitConfigParsed.coco?.openAIApiKey || config.openAIApiKey,
      huggingFaceHubApiKey:
        gitConfigParsed.coco?.huggingFaceHubApiKey || config.huggingFaceHubApiKey,
      tokenLimit: parseInt(gitConfigParsed.coco?.tokenLimit) || config.tokenLimit,
      prompt: gitConfigParsed.coco?.prompt || config.prompt,
      mode: gitConfigParsed.coco?.mode || config.mode,
      temperature: gitConfigParsed.coco?.temperature || config.temperature,
      summarizePrompt: gitConfigParsed.coco?.summarizePrompt || config.summarizePrompt,
      ignoredFiles: gitConfigParsed.coco?.ignoredFiles || config.ignoredFiles,
      ignoredExtensions: gitConfigParsed.coco?.ignoredExtensions || config.ignoredExtensions,
      defaultBranch: gitConfigParsed.coco?.defaultBranch || config.defaultBranch,
    }
  }
  return config
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

  const startComment = '# -- Start coco config --'
  const endComment = '# -- End coco config --'
  const header = '[coco]'

  // Function to generate new content for the coco section
  const getNewContent = async () => {
    const contentLines = [header]
    for (const key in config) {
      // check if string has new lines, if so, wrap in quotes
      if (typeof config[key as keyof Config] === 'string') {
        const value = config[key as keyof Config] as string
        if (value.includes('\n')) {
          contentLines.push(`\t${key} = ${JSON.stringify(value)}`)
          continue
        }
      }
      contentLines.push(`\t${key} = ${config[key as keyof Config]}`)
    }
    return contentLines.join('\n')
  }

  // Use the updateFileSection utility
  await updateFileSection(filePath, startComment, endComment, getNewContent)
}
