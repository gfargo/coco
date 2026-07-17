import { appendToGitConfig } from '../../lib/config/services/git'
import { appendToProjectJsonConfig, pickTrustedProjectServiceFields } from '../../lib/config/services/project'
import { persistUsagePreference } from '../../lib/config/services/xdg'
import chalk from 'chalk'
import { checkAndHandlePackageInstallation } from '../../lib/ui/checkAndHandlePackageInstall'
import { FAIL, PASS, WARN } from '../../lib/ui/glyphs'
import { LOGO } from '../../lib/ui/helpers'
import { confirmPrompt } from '../../lib/ui/inquirerPrompts'
import { logResult } from '../../lib/ui/logResult'
import { installNpmPackage } from '../../lib/utils/installPackage'

import { ConfigWithServiceObject } from '../../lib/config/types'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { LLMModel, LLMProvider, OllamaLLMService, OpenAILLMService } from '../../lib/langchain/types'
import { getDefaultServiceConfigFromAlias } from '../../lib/langchain/utils'
import { OllamaNotReadyError } from '../../lib/langchain/utils/ollamaStatus'
import { CommandHandler } from '../../lib/types'
import { Logger } from '../../lib/utils/logger'
import { getPathToUsersGitConfig } from '../../lib/utils/getPathToUsersGitConfig'
import { getProjectConfigFilePath } from '../../lib/utils/getProjectConfigFilePath'
import { runDiagnostics } from '../doctor/checks'
import { applyRepoCwd } from '../utils/applyRepoFlag'
import { InitArgv, InitOptions } from './config'
import { questions, OPENAI_COMPATIBLE_SENTINEL } from './questions'
import { OpenAiCompatiblePreset } from './openAiCompatiblePresets'

export const handler: CommandHandler<InitArgv> = async (argv, logger) => {
  // Honor the global --repo flag so `coco init --repo <X> --scope project`
  // writes the project config to X, not the launcher's cwd. The
  // chdir has to happen before getProjectConfigFilePath resolves
  // its target path (it reads process.cwd).
  applyRepoCwd(argv)

  const options = loadConfig<InitOptions, InitArgv>(argv)

  logger.log(LOGO)

  let scope = options?.scope
  let shouldSetupCommitlint = false

  if (options.dryRun) {
    logger.log(`\ninit dry run successful for ${scope || 'project'} scope`, { color: 'green' })
    return
  }
  
  if (!scope) {
    scope = await questions.whatScope()
  }

  // Ask about commitlint setup after scope selection
  shouldSetupCommitlint = await questions.setupCommitlint()

  // Pick provider + model in a loop so an unusable Ollama (not installed /
  // not running / no models pulled) re-offers the provider picker instead of
  // hard-exiting and discarding the answers above.
  let llmProvider: LLMProvider
  let llmModel: LLMModel
  // Set when the user picks "OpenAI-compatible endpoint" (#1610) — the
  // underlying provider is still 'openai', but the model is free text and
  // the service gets a custom baseURL + a preset-specific API key hint.
  let compatiblePreset: OpenAiCompatiblePreset | undefined
  for (;;) {
    const picked = await questions.selectLLMProvider()
    try {
      if (picked === OPENAI_COMPATIBLE_SENTINEL) {
        compatiblePreset = await questions.selectOpenAiCompatiblePreset()
        llmProvider = 'openai'
        llmModel = await questions.inputOpenAiCompatibleModel()
      } else {
        compatiblePreset = undefined
        llmProvider = picked
        llmModel = await questions.selectLLMModel(llmProvider)
      }
      break
    } catch (err) {
      if (err instanceof OllamaNotReadyError) {
        logger.log(chalk.dim("\nLet's choose a provider again."))
        continue
      }
      throw err
    }
  }

  const service = getDefaultServiceConfigFromAlias(llmProvider, llmModel)

  // compatiblePreset is only ever set alongside llmProvider === 'openai'
  // (see the selection loop above), so `service` is always an
  // OpenAILLMService here.
  if (compatiblePreset?.baseURL) {
    (service as OpenAILLMService).baseURL = compatiblePreset.baseURL
  }

  const config: ConfigWithServiceObject = {
    defaultBranch: 'main',
    mode: 'interactive',
    service: service,
  }

  // Project-scoped config gets committed to the repo, and the hardened
  // project-config loader (see project.ts) never honors credentials or
  // endpoints from a repo-local file — anyone who can get a victim to clone
  // the repo would otherwise control where their API key and diffs get
  // sent. So for project scope we skip collecting a real API key / custom
  // Ollama endpoint entirely; they'd be written to disk but silently
  // ignored on load, which is a worse (confusing auth failure) experience
  // than just not asking.
  const isProjectScope = scope === 'project'

  if (isProjectScope && compatiblePreset?.baseURL) {
    // Same trust boundary as above, but for the compat baseURL itself: a
    // repo-committed config can't carry a custom endpoint (baseURL isn't in
    // TRUSTED_PROJECT_SERVICE_KEYS either), so this preset would silently
    // fall back to the real OpenAI API on load — steer the user to a scope
    // that actually persists it.
    logger.log(
      chalk.dim(
        `Note: project scope can't persist a custom endpoint (${compatiblePreset.baseURL}) — ` +
        `it will be dropped on load. Use \`coco init --scope global\`, or set COCO_SERVICE_BASE_URL via env var.`
      )
    )
  }
  const inputPromptByProvider: Partial<Record<LLMProvider, { label: string; envVar: string }>> = {
    openai: { label: 'OpenAI', envVar: 'OPENAI_API_KEY' },
    anthropic: { label: 'Anthropic', envVar: 'ANTHROPIC_API_KEY' },
    gemini: { label: 'Google Gemini', envVar: 'GEMINI_API_KEY' },
    mistral: { label: 'Mistral', envVar: 'MISTRAL_API_KEY' },
    azure: { label: 'Azure OpenAI', envVar: 'AZURE_OPENAI_API_KEY' },
  }

  let apiKey = '' as string
  const inputPrompt = compatiblePreset
    ? { label: compatiblePreset.label, envVar: compatiblePreset.apiKeyEnvVar }
    : inputPromptByProvider[llmProvider]
  if (inputPrompt) {
    if (isProjectScope) {
      const envVarName: string = inputPrompt.envVar
      logger.log(
        chalk.dim(
          `Skipping API key prompt for project scope — repo-committed config can't hold credentials safely. ` +
          `Set ${envVarName} via env var, or use \`coco init --scope global\` instead.`
        )
      )
    } else {
      // Local/self-hosted compat endpoints (LM Studio, vLLM, custom)
      // typically don't enforce a real key — let it through blank instead
      // of forcing a placeholder value.
      apiKey = compatiblePreset && !compatiblePreset.requiresApiKey
        ? await questions.inputOptionalApiKey(inputPrompt.label, inputPrompt.envVar)
        : await questions.inputApiKey(inputPrompt.label, inputPrompt.envVar)

      if (config.service.authentication.type === 'APIKey') {
        config.service.authentication.credentials.apiKey = '•••••••••••••••'
      }
    }
  }

  if (llmProvider === 'bedrock') {
    // Bedrock authenticates through the AWS credential chain — there is no
    // coco-managed API key to prompt for. Point the user at the env vars
    // the AWS SDK resolves automatically.
    logger.log(
      'AWS Bedrock uses the standard AWS credential chain (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION). Set those in your environment.'
    )
  }

  const advOptions = await questions.configureAdvancedOptions()

    /**
     * Prompt for advanced options
     *
     * e.g.
     * - interactive v.s stdout mode
     * - default branch
     * - temperature
     * - token limit
     * - verbose logging
     * - ignored files
     * - ignored extensions
     * - commit message prompt
     */
  if (advOptions) {
    config.mode = await questions.selectMode()

      config.defaultBranch = await questions.selectDefaultGitBranch()

      config.service = {
        ...config.service,
        temperature: await questions.inputModelTemperature(),
        tokenLimit: await questions.inputTokenLimit(),
      }

      if (llmProvider === 'ollama') {
        if (isProjectScope) {
          logger.log(
            chalk.dim(
              `Skipping custom Ollama endpoint prompt for project scope — repo-committed config can't ` +
              `steer where requests go safely. Using the default (${(config.service as OllamaLLMService).endpoint}). ` +
              `Set COCO_SERVICE_ENDPOINT via env var, or use \`coco init --scope global\` instead.`
            )
          )
        } else {
          ;(config.service as OllamaLLMService).endpoint = await questions.inputOllamaEndpoint()
        }
      }

      config.service.requestOptions = {
        timeout: await questions.inputRequestTimeout(),
        maxRetries: await questions.inputRequestMaxRetries(),
      }

      const promptForServiceFields = await confirmPrompt({
        message: 'would you like to configure additional service fields (advanced)?',
        default: false,
      })

      if (promptForServiceFields) {
        const fieldsJson = await questions.inputServiceFields()
        try {
          config.service.fields = JSON.parse(fieldsJson)
        } catch (e) {
          logger.error('Invalid JSON for service fields. Skipping.', { color: 'red' })
          
          logger.verbose(`Error parsing service fields: ${(e as Error).message}`, {
            color: 'red',
          })
        }
      }

      const promptForIgnores = await confirmPrompt({
        message: 'would you like to configure ignored files and extensions?',
        default: false,
      })

      if (promptForIgnores) {
        config.ignoredFiles = await questions.whatFilesToIgnore()
        config.ignoredExtensions = await questions.whatExtensionsToIgnore()
      }

      const promptForCommitPrompt = await confirmPrompt({
        message: 'would you like to configure the commit message prompt?',
        default: false,
      })

      if (promptForCommitPrompt) {
        config.prompt = await questions.modifyCommitPrompt()
      }
    }

  // Opt-out for the local usage ledger (#0.69). Stored per-machine in the
  // global XDG config (not the scoped config written below), since a recording
  // preference belongs to the user, not a shared repo.
  const enableUsageStats = await questions.enableUsageStats()

  logResult('Config', JSON.stringify(config, null, 2))
  let approvalMessage = 'does this look good?'

  if (config.service.authentication.type === 'APIKey') {
    if (!apiKey && compatiblePreset && !compatiblePreset.requiresApiKey) {
      // Compat endpoint with no key entered (LM Studio / vLLM / custom,
      // typically no auth) — 'APIKey' with an empty string would make
      // every command think a key is missing and fail with a "set your
      // API key" prompt. Drop to 'None' so unauthenticated local
      // endpoints work out of the box.
      config.service.authentication = { type: 'None', credentials: undefined }
    } else {
      // add to config after logging, so that the API key is not logged
      config.service.authentication.credentials.apiKey = apiKey
      approvalMessage = apiKey ? 'looking good? (API key hidden for security)' : approvalMessage
    }
  }

  const isApproved = await confirmPrompt({
    message: approvalMessage,
  })

  if (isApproved) {
    // Resolve the config file path only after approval — so a user who
    // answers "no" is never asked which file format to write.
    let configFilePath = ''
    switch (scope) {
      case 'project': {
        const fileTypeSelection = await questions.selectProjectConfigFileType()
        configFilePath = await getProjectConfigFilePath(fileTypeSelection)
        break
      }
      case 'global':
      default:
        configFilePath = getPathToUsersGitConfig()
        break
    }

    if (configFilePath.endsWith('.gitconfig')) {
      await appendToGitConfig(configFilePath, config)
    } else if (
      // Both JSON project-config formats route to the same writer. The
      // recommended `.coco.json` was previously missing here, so selecting it
      // silently wrote nothing while still reporting "init successful". Check
      // the more-specific legacy name first (`.coco.json` is a suffix of
      // neither, so order is not strictly required, but keep it explicit).
      configFilePath.endsWith('.coco.config.json') ||
      configFilePath.endsWith('.coco.json')
    ) {
      // Project-scope files are untrusted on load (see project.ts) — only
      // TRUSTED_PROJECT_SERVICE_KEYS survive a reload. Persist that same
      // filtered shape here so we don't write fields (authentication,
      // baseURL, endpoint, fields) that the loader will immediately reject
      // with an "untrusted-service-fields" warning on every later command.
      const configToWrite: ConfigWithServiceObject = isProjectScope
        ? { ...config, service: pickTrustedProjectServiceFields(config.service) as ConfigWithServiceObject['service'] }
        : config
      appendToProjectJsonConfig(configFilePath, configToWrite)
    } else {
      // Fail loud rather than silently no-op: any config-file type without a
      // writer branch is a bug, and a silent skip here looks like success.
      throw new Error(
        `init: no config writer for "${configFilePath}" — this is a bug`,
      )
    }

    // Persist the usage-stats choice to the global (per-machine) config.
    persistUsagePreference(enableUsageStats)
    logger.log(
      enableUsageStats
        ? `${chalk.dim('Local AI usage stats: on')} ${chalk.dim('(opt out later with telemetry.usage=false or COCO_USAGE_LOG=0)')}`
        : chalk.dim('Local AI usage stats: off'),
    )

    // After config is written, check for package installation
    await checkAndHandlePackageInstallation({ global: scope === 'global', logger })

    // Install commitlint packages if user requested
    if (shouldSetupCommitlint) {
      await installCommitlintPackages(scope, logger)
    }

    logger.log(`\ninit successful! 🦾🤖🎉`, { color: 'green' })

    // Post-write verification — run the same check `coco doctor` runs
    // so the user finds out about typos / structural issues now,
    // before their first `coco commit`. Re-load from disk so we
    // verify the persisted config (not the in-memory shape we just
    // built), which catches transcription bugs in the appenders.
    try {
      const persistedConfig = loadConfig({})
      const diagnostics = runDiagnostics(persistedConfig)
      const errors = diagnostics.filter((d) => d.severity === 'error')
      const warnings = diagnostics.filter((d) => d.severity === 'warn')

      if (errors.length === 0 && warnings.length === 0) {
        logger.log(`${PASS()} Verified: no issues found in your new config.`, { color: 'green' })
      } else {
        if (errors.length > 0) {
          logger.error(`${FAIL()} ${errors.length} error(s) found in the persisted config:`, { color: 'red' })
          for (const diagnostic of errors) {
            logger.log(`  ${chalk.red(diagnostic.message)}`)
          }
        }
        if (warnings.length > 0) {
          logger.log(`${WARN()} ${warnings.length} warning(s) found in the persisted config:`, { color: 'yellow' })
          for (const diagnostic of warnings) {
            logger.log(`  ${chalk.yellow(diagnostic.message)}`)
          }
        }
        logger.log(`${chalk.dim('Run')} ${chalk.cyan('coco doctor')} ${chalk.dim('for the full diagnostic report.')}`)
      }
    } catch (verifyError) {
      // Verification is a polish step, not a blocker. If it crashes
      // (e.g. config file written to a path the loader can't reach
      // from the current cwd), fall through to a hint instead of
      // failing the whole init flow — the config is on disk and
      // the user can run `coco doctor` themselves.
      logger.log(
        `${chalk.dim('Skipped post-init verification:')} ${(verifyError as Error).message}`,
        { color: 'gray' }
      )
      logger.log(`${chalk.dim('Run')} ${chalk.cyan('coco doctor')} ${chalk.dim('to verify your config manually.')}`)
    }
  } else {
    logger.log('\ninit cancelled.', { color: 'yellow' })
  }
}

/**
 * Install commitlint packages based on scope (global or project)
 */
async function installCommitlintPackages(scope: 'global' | 'project', logger: Logger): Promise<void> {
  const packages = ['@commitlint/config-conventional', '@commitlint/cli']
  
  try {
    if (scope === 'global') {
      logger.startSpinner('Installing commitlint packages globally...', { color: 'blue' })
      
      for (const pkg of packages) {
        await installNpmPackage({ name: pkg, flags: ['-g'] })
      }
      
      logger.stopSpinner('Installed commitlint packages globally')
    } else {
      logger.startSpinner('Installing commitlint packages in project...', { color: 'blue' })
      
      for (const pkg of packages) {
        await installNpmPackage({ name: pkg, flags: ['--save-dev'] })
      }
      
      logger.stopSpinner('Installed commitlint packages in project')
    }
  } catch (error) {
    logger.stopSpinner('Failed to install commitlint packages')
    logger.error(`Error installing commitlint packages: ${(error as Error).message}`, { color: 'red' })
    logger.log('You can install them manually later:', { color: 'yellow' })
    
    if (scope === 'global') {
      logger.log('npm install -g @commitlint/config-conventional @commitlint/cli', { color: 'gray' })
    } else {
      logger.log('npm install --save-dev @commitlint/config-conventional @commitlint/cli', { color: 'gray' })
    }
  }
}
