export interface Config {
  /**
   * The LLM model to use for generating results.
   * 
   * @default 'openai/gpt-4'
   * 
   * @example 'openai/gpt-4'
   * @example 'openai/gpt-3.5-turbo'
   * @example 'huggingface/bigscience/bloom'
   **/

  model: string
  
  /**
   * The OpenAI API key.
   */
  openAIApiKey?: string

  /**
   * The HuggingFace Hub API key.
   */
  huggingFaceHubApiKey?: string

  /**
   * The maximum number of tokens per request.
   *
   * @default 1024
   */
  tokenLimit?: number

  /**
   * The prompt text used for generating results.
   */
  prompt?: string

  /**
   * The temperature value controls the randomness of the generated output.
   * Higher values (e.g., 0.8) make the output more random, while lower values (e.g., 0.2) make it more deterministic.
   *
   * @default 0.4
   */
  temperature?: number

  /**
   * The output destination for the generated result.
   * - 'stdout': Prints the result to the standard output.  This is the default behavior.
   * - 'interactive': Provides an interactive prompt for editing the result & committing the changes.
   *
   * @default 'stdout'
   */
  mode?: 'stdout' | 'interactive'

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
}
