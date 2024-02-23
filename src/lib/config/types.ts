import { BaseCommandOptions } from '../../commands/types'
import { LLMService, OllamaLLMService, OpenAILLMService } from '../langchain/types'

interface BaseConfig {
  /**
   * The output destination for the generated result.
   * - 'stdout': Prints the result to the standard output.  This is the default behavior.
   * - 'interactive': Provides an interactive prompt for editing the result & committing the changes.
   *
   * @default 'stdout'
   */
  mode: 'stdout' | 'interactive'

  /**
   * Enable verbose logging.
   *
   * @default false
   */
  verbose?: boolean

  /**
   * Open the commit message in an editor for editing before proceeding.
   *
   * @default false
   */
  openInEditor?: boolean

  /**
   * The prompt text used for generating results.
   */
  prompt?: string

  /**
   * The prompt text used specifically for generating summaries of large files.
   */
  summarizePrompt?: string

  /**
   * An array of file paths or patterns to be ignored during processing.
   *
   * Note: This is a list of patterns interpreted by the `minimatch` library.
   * @see https://github.com/isaacs/minimatch
   *
   * @example ['package-lock.json', 'node_modules']
   * @default ['package-lock.json', contents of .gitignore, contents of .ignore]
   */
  ignoredFiles?: string[]

  /**
   * An array of file extensions to be ignored during processing.
   *
   * @default ['.map', '.lock']
   */
  ignoredExtensions?: string[]

  /**
   * Default git branch for the repository.
   *
   * @default 'main'
   */
  defaultBranch: string
}

export interface OpenAIAliasConfig extends BaseConfig {
  service: 'openai'
  model?: OpenAILLMService['model']
  openAIApiKey: string
}

export interface OllamaAliasConfig extends BaseConfig {
  service: 'ollama'
  model?: OllamaLLMService['model']
  endpoint: string
}

export type ConfigWithServiceAlias = (OpenAIAliasConfig | OllamaAliasConfig) &
  Partial<BaseCommandOptions>

export type ConfigWithServiceObject = BaseConfig &
Partial<BaseCommandOptions> & {
  service: LLMService
}

export type Config = ConfigWithServiceAlias | ConfigWithServiceObject
