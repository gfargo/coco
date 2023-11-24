import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as ini from 'ini'
import { Config } from '../types'
import inquirer from 'inquirer'

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
      model: gitConfigParsed.coco?.model || config.model,
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
  const header = '[coco]'
  const endComment = '# -- End coco config --'
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)
  const newLines = []
  let foundCocoSection = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.trim() === startComment) {
      foundCocoSection = true

      // Prompt for confirmation to overwrite
      const { confirm } = await inquirer.prompt({
        type: 'confirm',
        name: 'confirm',
        message: 'hmm, looks like a config already exists. would you like to overwrite it?',
      })

      if (!confirm) {
        // keep all lines until the end comment
        while (i < lines.length && lines[i].trim() !== endComment) {
          newLines.push(lines[i])
          i++
        }
        newLines.push(endComment)
        continue
      }

      newLines.push(startComment)
      newLines.push(header)
      for (const key in config) {
        // check if string has new lines, if so, wrap in quotes
        if (typeof config[key as keyof Config] === 'string') {
          const value = config[key as keyof Config] as string
          if (value.includes('\n')) {
            newLines.push(`\t${key} = ${JSON.stringify(value)}`)
            continue
          }
        }
        newLines.push(`\t${key} = ${config[key as keyof Config]}`)
      }

      while (i < lines.length && lines[i].trim() !== endComment) {
        i++
      }

      newLines.push(endComment)
      continue
    }

    if (!foundCocoSection || line.trim() !== endComment) {
      newLines.push(line)
    }
  }

  // If coco section comments weren't found, append them to the end
  if (!foundCocoSection) {
    newLines.push('\n' + startComment)
    newLines.push(header)
    for (const key in config) {
      // check if string has new lines, if so, wrap in quotes
      if (typeof config[key as keyof Config] === 'string') {
        const value = config[key as keyof Config] as string
        if (value.includes('\n')) {
          newLines.push(`\t${key} = ${JSON.stringify(value)}`)
          continue
        }
      }
      newLines.push(`\t${key} = ${config[key as keyof Config]}`)
    }
    newLines.push(endComment)
  }

  fs.writeFileSync(filePath, newLines.join('\n'))
}
