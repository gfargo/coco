import { confirm, editor, input, password, select } from '@inquirer/prompts'
import { ANTHROPIC_MODELS, OPEN_AI_MODELS } from '../../lib/langchain/constants'
import { LLMModel, LLMProvider } from '../../lib/langchain/types'
import { execPromise } from '../../lib/utils/execPromise'
import { ProjectConfigFileName } from '../../lib/utils/getProjectConfigFilePath'
import { COMMIT_PROMPT } from '../commit/prompt'
import { InstallationScope } from './options'

export const questions = {
  /**
   * @description configure coco globally for the current user or project?
   */
  whatScope: async (): Promise<InstallationScope> =>
    await select({
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
    await select({
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

    if (provider === 'ollama') {
      // Check if ollama is installed
      const { stdout } = await execPromise(
        `ollama list |  awk '{print $1}' | awk '{if(NR>1)print}'`
      )

      const availableOllamaModels = stdout.split('\n').filter(Boolean)

      if (availableOllamaModels.length === 0) {
        console.log('No Ollama models found. Please install one via Ollama CLI.')
        process.exit(1)
      }

      availableModels = [
        ...availableOllamaModels.map((model) => ({
          name: model,
          value: model as LLMModel,
        })),
      ]
    }

    return await select({
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
    await select({
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
      const useExisting = await confirm({
        message: `Use existing ${envVarName} env var?`,
        default: true,
      });
  
      if (useExisting) {
        return envVarValue;
      }
    }
  
    return await password({
      message: `Enter your ${keyName} API key:`,
      validate(input) {
        return input.length > 0 ? true : 'API key cannot be empty';
      },
    });
  },

  inputTokenLimit: async (): Promise<number> => {
    const tokenLimit = await input({
      message: 'maximum number of tokens for generating commit messages:',
      default: '300',
    })

    return parseInt(tokenLimit)
  },

  inputModelTemperature: async (): Promise<number> => {
    const temperature = await input({
      message: 'model temperature for generating commit messages:',
      default: '0.36',
    })
    return parseFloat(temperature)
  },

  selectDefaultGitBranch: async (): Promise<string> =>
    (await input({
      message: 'default branch for the repository:',
      default: 'main',
    })) || 'main',

  configureAdvancedOptions: async (): Promise<boolean> =>
    await confirm({
      message: 'would you like to configure advanced options?',
      default: false,
    }),

  enableVerboseMode: async (): Promise<boolean> =>
    await confirm({
      message: 'enable verbose logging:',
      default: false,
    }),

  whatFilesToIgnore: async (): Promise<string[]> =>
    (
      await input({
        message: 'paths of files to be excluded when generating commit messages (comma-separated):',
        default: 'package-lock.json',
      })
    )
      ?.split(',')
      ?.map((file: string) => file.trim()) || [],

  whatExtensionsToIgnore: async (): Promise<string[]> =>
    (
      await input({
        message:
          'file extensions to be excluded when generating commit messages (comma-separated):',
        default: '.map, .lock',
      })
    )
      ?.split(',')
      ?.map((ext: string) => ext.trim()) || [],

  modifyCommitPrompt: async (): Promise<string> =>
    await editor({
      message: 'modify default commit message prompt:',
      default: COMMIT_PROMPT.template as string,
    }),

  selectProjectConfigFileType: async (): Promise<ProjectConfigFileName> =>
    await select({
      message: 'where would you like to store the project config?',
      choices: [
        {
          name: '.coco.config.json',
          value: '.coco.config.json',
        },
        {
          name: '.env',
          value: '.env',
        },
      ],
    }),
}
