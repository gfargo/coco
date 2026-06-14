import chalk from 'chalk'

import { ANTHROPIC_MODELS, BEDROCK_MODELS, GEMINI_MODELS, MISTRAL_MODELS, OPEN_AI_MODELS } from '../../lib/langchain/constants'
import { LLMModel, LLMProvider } from '../../lib/langchain/types'
import {
  getOllamaStatus,
  OllamaNotReadyError,
  pullOllamaModel,
  RECOMMENDED_STARTER_MODEL,
} from '../../lib/langchain/utils/ollamaStatus'
import {
    confirmPrompt,
    editorPrompt,
    inputPrompt,
    passwordPrompt,
    selectPrompt,
} from '../../lib/ui/inquirerPrompts'
import { ProjectConfigFileName } from '../../lib/utils/getProjectConfigFilePath'
import { COMMIT_PROMPT } from '../commit/prompt'
import { InstallationScope } from './config'

/**
 * Resolve the list of locally-available Ollama models for the init picker,
 * guiding the user through the common first-run states instead of crashing:
 *
 *   - not installed       → install link, then re-run or pick another provider
 *   - installed, not up   → `ollama serve` hint, then re-run or pick another
 *   - up, no models       → recommend + optionally pull a starter model
 *
 * Throws {@link OllamaNotReadyError} when Ollama can't be used and the user
 * didn't fix it inline — the handler catches this to re-offer the provider
 * picker, preserving the rest of the init session.
 */
async function ensureOllamaModels(): Promise<string[]> {
  let status = await getOllamaStatus()

  if (!status.reachable) {
    if (!status.installed) {
      console.log(
        `\n${chalk.yellow('Ollama isn’t installed')} — coco’s local-AI path needs it.\n` +
          `  Install: ${chalk.cyan('https://ollama.com/download')} ${chalk.dim('(macOS/Linux:')} ${chalk.cyan('brew install ollama')}${chalk.dim(')')}\n` +
          `  Then run ${chalk.cyan('ollama serve')} and re-run ${chalk.cyan('coco init')}, or pick another provider below.`,
      )
    } else {
      console.log(
        `\n${chalk.yellow('Ollama is installed but not running.')}\n` +
          `  Start it with ${chalk.cyan('ollama serve')} (or open the Ollama app), then re-run — or pick another provider below.`,
      )
    }
    throw new OllamaNotReadyError()
  }

  if (status.models.length === 0) {
    console.log(
      `\n${chalk.yellow('No Ollama models are pulled yet.')} ` +
        `coco recommends ${chalk.cyan(RECOMMENDED_STARTER_MODEL)} to start ${chalk.dim('(~4.7 GB).')}`,
    )
    const shouldPull = await confirmPrompt({
      message: `pull ${RECOMMENDED_STARTER_MODEL} now?`,
      default: true,
    })
    if (!shouldPull) {
      console.log(
        `  ${chalk.dim('No problem — pull one yourself with')} ${chalk.cyan(`ollama pull ${RECOMMENDED_STARTER_MODEL}`)}${chalk.dim(', or pick another provider below.')}`,
      )
      throw new OllamaNotReadyError()
    }
    try {
      await pullOllamaModel(RECOMMENDED_STARTER_MODEL)
    } catch {
      console.log(
        `  ${chalk.red('Pull failed.')} Run ${chalk.cyan(`ollama pull ${RECOMMENDED_STARTER_MODEL}`)} manually, or pick another provider below.`,
      )
      throw new OllamaNotReadyError()
    }
    status = await getOllamaStatus()
    if (status.models.length === 0) {
      throw new OllamaNotReadyError()
    }
  }

  return status.models
}

export const questions = {
  /**
   * @description configure coco globally for the current user or project?
   */
  whatScope: async (): Promise<InstallationScope> =>
    await selectPrompt<InstallationScope>({
      message: 'configure coco globally for the current user or for the current directory?',
      choices: [
        {
          name: 'global',
          value: 'global',
          description: 'add coco config to your global git config',
        },
        {
          name: 'project',
          value: 'project',
          description: 'add coco config to existing git project',
        },
      ],
    }),
  selectLLMProvider: async (): Promise<LLMProvider> =>
    await selectPrompt<LLMProvider>({
      message: 'select language model provider:',
      choices: [
        {
          name: 'Ollama',
          value: 'ollama',
          description: 'Ollama Instance',
        },
        {
          name: 'OpenAI',
          value: 'openai',
          description: 'OpenAI API',
        },
        {
          name: "Anthropic",
          value: "anthropic",
          description: "Anthropic API"
        },
        {
          name: 'Google Gemini',
          value: 'gemini',
          description: 'Google Gemini API',
        },
        {
          name: 'Mistral',
          value: 'mistral',
          description: 'Mistral API',
        },
        {
          name: 'Azure OpenAI',
          value: 'azure',
          description: 'Azure OpenAI Service',
        },
        {
          name: 'AWS Bedrock',
          value: 'bedrock',
          description: 'AWS Bedrock (uses the AWS credential chain)',
        }
      ],
      default: 'ollama',
    }),

  selectLLMModel: async (provider: LLMProvider): Promise<LLMModel> => {
    let availableModels = [] as { name: string; value: LLMModel }[]

    if (provider === 'openai') {
      availableModels = [
        ...OPEN_AI_MODELS.map((model) => ({
          name: model as string,
          value: model,
        })),
      ]
    }

    if (provider === 'anthropic') {
      availableModels = [
        ...ANTHROPIC_MODELS.map((model) => ({
          name: model as string,
          value: model,
        })),
      ]
    }

    if (provider === 'gemini') {
      availableModels = [
        ...GEMINI_MODELS.map((model) => ({
          name: model as string,
          value: model,
        })),
      ]
    }

    if (provider === 'mistral') {
      availableModels = [
        ...MISTRAL_MODELS.map((model) => ({
          name: model as string,
          value: model,
        })),
      ]
    }

    if (provider === 'azure') {
      availableModels = [
        ...OPEN_AI_MODELS.map((model) => ({
          name: model as string,
          value: model,
        })),
      ]
    }

    if (provider === 'bedrock') {
      availableModels = [
        ...BEDROCK_MODELS.map((model) => ({
          name: model as string,
          value: model,
        })),
      ]
    }

    if (provider === 'ollama') {
      const availableOllamaModels = await ensureOllamaModels()

      availableModels = [
        ...availableOllamaModels.map((model) => ({
          name: model,
          value: model as LLMModel,
        })),
      ]
    }

    return await selectPrompt<LLMModel>({
      message: 'select language model:',
      choices: availableModels,
    })
  },
  /**
   * @description select mode:
   * interactive prompt for creating, reviewing, and committing
   * print results to stdout
   * @returns 'interactive' | 'stdout'
   */
  selectMode: async (): Promise<'interactive' | 'stdout'> =>
    await selectPrompt<'interactive' | 'stdout'>({
      message: 'select mode:',
      choices: [
        {
          name: 'interactive',
          value: 'interactive',
          description: 'interactive prompt for creating, reviewing, and committing',
        },
        {
          name: 'stdout',
          value: 'stdout',
          description: 'print results to stdout',
        },
      ],
    }),

  inputApiKey: async (
    keyName: string,
    envVarName: string
  ): Promise<string> => {
    const envVarValue = process.env[envVarName];
  
    if (envVarValue) {
      const useExisting = await confirmPrompt({
        message: `Use existing ${envVarName} env var?`,
        default: true,
      });
  
      if (useExisting) {
        return envVarValue;
      }
    }
  
    return await passwordPrompt({
      message: `Enter your ${keyName} API key:`,
      validate(input) {
        return input.length > 0 ? true : 'API key cannot be empty';
      },
    });
  },

  inputTokenLimit: async (): Promise<number> => {
    const tokenLimit = await inputPrompt({
      message: 'maximum number of tokens for generating commit messages:',
      default: '300',
    })

    return parseInt(tokenLimit)
  },

  inputModelTemperature: async (): Promise<number> => {
    const temperature = await inputPrompt({
      message: 'model temperature for generating commit messages:',
      default: '0.36',
    })
    return parseFloat(temperature)
  },

  inputOllamaEndpoint: async (): Promise<string> => {
    return await inputPrompt({
      message: 'Ollama endpoint (e.g., http://localhost:11434):',
      default: 'http://localhost:11434',
    })
  },

  inputRequestTimeout: async (): Promise<number> => {
    const timeout = await inputPrompt({
      message: 'Request timeout in milliseconds:',
      default: '30000',
    })
    return parseInt(timeout)
  },

  inputRequestMaxRetries: async (): Promise<number> => {
    const maxRetries = await inputPrompt({
      message: 'Maximum number of request retries:',
      default: '3',
    })
    return parseInt(maxRetries)
  },

  inputServiceFields: async (): Promise<string> => {
    return await editorPrompt({
      message: 'Enter additional service fields as a JSON string (optional):',
      default: '{}',
    })
  },

  selectDefaultGitBranch: async (): Promise<string> =>
    (await inputPrompt({
      message: 'default branch for the repository:',
      default: 'main',
    })) || 'main',

  configureAdvancedOptions: async (): Promise<boolean> =>
    await confirmPrompt({
      message: 'would you like to configure advanced options?',
      default: false,
    }),

  enableVerboseMode: async (): Promise<boolean> =>
    await confirmPrompt({
      message: 'enable verbose logging:',
      default: false,
    }),

  whatFilesToIgnore: async (): Promise<string[]> =>
    (
      await inputPrompt({
        message: 'paths of files to be excluded when generating commit messages (comma-separated):',
        default: 'package-lock.json,yarn.lock,pnpm-lock.yaml,bun.lockb',
      })
    )
      ?.split(',')
      ?.map((file: string) => file.trim()) || [],

  whatExtensionsToIgnore: async (): Promise<string[]> =>
    (
      await inputPrompt({
        message:
          'file extensions to be excluded when generating commit messages (comma-separated):',
        default: '.map, .lock',
      })
    )
      ?.split(',')
      ?.map((ext: string) => ext.trim()) || [],

  modifyCommitPrompt: async (): Promise<string> =>
    await editorPrompt({
      message: 'modify default commit message prompt:',
      default: COMMIT_PROMPT.template as string,
    }),

  selectProjectConfigFileType: async (): Promise<ProjectConfigFileName> =>
    await selectPrompt<ProjectConfigFileName>({
      message: 'where would you like to store the project config?',
      choices: [
        {
          name: '.coco.json (recommended)',
          value: '.coco.json',
        },
        {
          name: '.coco.config.json (legacy)',
          value: '.coco.config.json',
        },
        {
          name: '.env',
          value: '.env',
        },
      ],
    }),

  setupCommitlint: async (): Promise<boolean> =>
    await confirmPrompt({
      message: 'set up commitlint for conventional commits support?',
      default: true,
    }),

  enableUsageStats: async (): Promise<boolean> =>
    await confirmPrompt({
      message:
        'keep a local record of AI usage stats (tokens + latency) for `coco doctor --cost`? stays on this machine; opt out anytime',
      default: true,
    }),
}
