import { input, password, select, confirm, editor } from '@inquirer/prompts'
import { InstallationScope } from './options'
import { COMMIT_PROMPT } from '../commit/prompt'
import { ProjectConfigFileName } from '../../lib/utils/getProjectConfigFilePath'

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

  inputOpenAIApiKey: async (): Promise<string> =>
    await password({
      message: `enter your OpenAI API key:`,
      validate(input) {
        return input.length > 0 ? true : 'API key cannot be empty'
      },
    }),

  inputTokenLimit: async (): Promise<number> => {
    const tokenLimit = await input({
      message: 'maximum number of tokens for generating commit messages:',
      default: '60',
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
