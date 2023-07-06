import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as ini from 'ini'
import { Config } from '../types'

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
      openAIApiKey: gitConfigParsed.coco?.openAIApiKey || config.openAIApiKey,
      tokenLimit: parseInt(gitConfigParsed.coco?.tokenLimit) || config.tokenLimit,
      prompt: gitConfigParsed.coco?.prompt || config.prompt,
      mode: gitConfigParsed.coco?.mode || config.mode,
      temperature: gitConfigParsed.coco?.temperature || config.temperature,
      summarizePrompt:
        gitConfigParsed.coco?.summarizePrompt || config.summarizePrompt,
      ignoredFiles: gitConfigParsed.coco?.ignoredFiles || config.ignoredFiles,
      ignoredExtensions: gitConfigParsed.coco?.ignoredExtensions || config.ignoredExtensions,
    }
  }
  return config
}
