import * as fs from 'fs'
import { Config } from '../../lib/config/types'
import { resolveDynamicModel } from '../../lib/langchain/utils/dynamicModels'
import { DEFAULT_OLLAMA_ENDPOINT, getOllamaStatus } from '../../lib/langchain/utils/ollamaStatus'
import { DEPRECATED_MODELS, detectProviderMismatch } from '../../lib/langchain/modelValidity'
import { LLMProvider } from '../../lib/langchain/types'

export type DiagnosticSeverity = 'error' | 'warn' | 'info'

export interface Diagnostic {
  severity: DiagnosticSeverity
  message: string
  fix?: string
  autoFix?: (config: Record<string, unknown>) => void
}

export function runDiagnostics(config: Config): Diagnostic[] {
  const diagnostics: Diagnostic[] = []

  checkServiceBlock(config, diagnostics)
  checkAuthentication(config, diagnostics)
  checkModelCurrency(config, diagnostics)
  checkModeConfig(config, diagnostics)
  checkDynamicRouting(config, diagnostics)
  checkTokenLimits(config, diagnostics)
  checkIgnoredFiles(config, diagnostics)
  checkProjectConfigFile(diagnostics)

  return diagnostics
}

function checkServiceBlock(config: Config, diagnostics: Diagnostic[]) {
  if (!config.service) {
    diagnostics.push({
      severity: 'error',
      message: 'No service configuration found. Coco needs an AI provider to generate results.',
      fix: 'Run `coco init` to set up a provider, or add a "service" block to .coco.config.json.',
    })
    return
  }

  if (!config.service.provider) {
    diagnostics.push({
      severity: 'error',
      message: 'No provider set in service config.',
      fix: 'Set service.provider to "openai", "anthropic", "azure", "gemini", "mistral", "bedrock", or "ollama".',
    })
  }

  if (!config.service.model) {
    diagnostics.push({
      severity: 'error',
      message: 'No model set in service config.',
      fix: 'Set service.model to a valid model name (e.g. "gpt-4o") or "dynamic" for task-based routing.',
    })
  }
}

function checkAuthentication(config: Config, diagnostics: Diagnostic[]) {
  if (!config.service) return

  const { provider, authentication } = config.service

  // Bedrock authenticates via the AWS credential chain, not a coco-managed
  // API key — so an authentication.type of 'None' is valid and expected.
  if (provider === 'bedrock') {
    if (authentication && authentication.type !== 'None') {
      diagnostics.push({
        severity: 'warn',
        message:
          'AWS Bedrock uses the AWS credential chain, not a coco-managed API key. Set authentication.type to "None".',
        fix: 'Change service.authentication to { "type": "None" }, and provide AWS credentials via AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION (or a shared profile).',
        autoFix: (raw) => {
          const svc = raw.service as Record<string, unknown>
          if (svc) {
            svc.authentication = { type: 'None' }
          }
        },
      })
    }
    return
  }

  if (provider === 'ollama') {
    if (authentication && authentication.type !== 'None') {
      diagnostics.push({
        severity: 'warn',
        message: 'Ollama does not require authentication. Set authentication.type to "None".',
        fix: 'Change service.authentication to { "type": "None" }.',
        autoFix: (raw) => {
          const svc = raw.service as Record<string, unknown>
          if (svc) {
            svc.authentication = { type: 'None' }
          }
        },
      })
    }

    const ollamaService = config.service as { endpoint?: string }
    if (!ollamaService.endpoint) {
      diagnostics.push({
        severity: 'warn',
        message: 'No Ollama endpoint configured. Defaulting to http://localhost:11434.',
        fix: 'Add service.endpoint: "http://localhost:11434" to your config.',
        autoFix: (raw) => {
          const svc = raw.service as Record<string, unknown>
          if (svc) {
            svc.endpoint = 'http://localhost:11434'
          }
        },
      })
    }
    return
  }

  if (!authentication || authentication.type === 'None') {
    diagnostics.push({
      severity: 'error',
      message: `Provider "${provider}" requires authentication but none is configured.`,
      fix: `Set service.authentication to { "type": "APIKey", "credentials": { "apiKey": "..." } } or use the OPENAI_API_KEY / ANTHROPIC_API_KEY / AZURE_OPENAI_API_KEY / GEMINI_API_KEY / MISTRAL_API_KEY environment variable.`,
    })
    return
  }

  if (authentication.type === 'APIKey') {
    const key = authentication.credentials?.apiKey
    if (!key || key === '•••••••••••••••' || key.trim() === '') {
      diagnostics.push({
        severity: 'warn',
        message: 'API key appears to be a placeholder or empty. Coco may fall back to environment variables.',
        fix: `Set the API key in your config or via environment variable (OPENAI_API_KEY, ANTHROPIC_API_KEY, AZURE_OPENAI_API_KEY, GEMINI_API_KEY, or MISTRAL_API_KEY).`,
      })
    }
  }
}

function checkModelCurrency(config: Config, diagnostics: Diagnostic[]) {
  if (!config.service?.model || config.service.model === 'dynamic') return

  const model = String(config.service.model)
  const provider = config.service.provider as LLMProvider

  // Per-provider validity: flag a model that belongs to a different provider's
  // namespace (e.g. a `claude-…` model configured under provider `openai`).
  const mismatchOwner = detectProviderMismatch(model, provider)
  if (mismatchOwner) {
    diagnostics.push({
      severity: 'error',
      message: `Model "${model}" is a ${mismatchOwner} model, but service.provider is "${provider}".`,
      fix: `Set service.model to a ${provider} model, or change service.provider to "${mismatchOwner}".`,
    })
  }

  const upgrade = DEPRECATED_MODELS[model]

  if (upgrade) {
    diagnostics.push({
      severity: 'warn',
      message: `Model "${model}" has a newer replacement available: "${upgrade}".`,
      fix: `Update service.model to "${upgrade}" for better performance and pricing.`,
      autoFix: (raw) => {
        const svc = raw.service as Record<string, unknown>
        if (svc) {
          svc.model = upgrade
        }
      },
    })
  }
}

function checkModeConfig(config: Config, diagnostics: Diagnostic[]) {
  if (!config.mode || config.mode === 'stdout') {
    diagnostics.push({
      severity: 'info',
      message: 'Output mode is "stdout". Interactive features like commit split require -i or mode: "interactive".',
      fix: 'Set "mode": "interactive" in your config, or pass -i when using interactive commands.',
    })
  }
}

function checkDynamicRouting(config: Config, diagnostics: Diagnostic[]) {
  if (!config.service) return

  if (config.service.model === 'dynamic') {
    if (!config.service.dynamicModelPreference) {
      diagnostics.push({
        severity: 'info',
        message: 'Dynamic model routing is enabled but no preference is set. Defaulting to "balanced".',
        fix: 'Optionally set service.dynamicModelPreference to "cost", "balanced", or "quality".',
      })
    }

    if (config.service.dynamicModels) {
      const validTasks = ['summarize', 'commit', 'changelog', 'review', 'recap', 'repair', 'largeDiff']
      for (const task of Object.keys(config.service.dynamicModels)) {
        if (!validTasks.includes(task)) {
          diagnostics.push({
            severity: 'warn',
            message: `Unknown dynamic model task "${task}". Valid tasks: ${validTasks.join(', ')}.`,
            fix: `Remove or rename the "${task}" key in service.dynamicModels.`,
          })
        }
      }
    }

    diagnostics.push({
      severity: 'info',
      message: 'Dynamic model routing is active. Coco will select models per task based on your preference.',
    })
  } else {
    diagnostics.push({
      severity: 'info',
      message: `Using fixed model "${config.service.model}" for all tasks. Set service.model to "dynamic" to enable per-task model selection.`,
    })
  }
}

function checkTokenLimits(config: Config, diagnostics: Diagnostic[]) {
  if (!config.service) return

  const tokenLimit = config.service.tokenLimit || 2048

  if (tokenLimit < 512) {
    diagnostics.push({
      severity: 'warn',
      message: `Token limit (${tokenLimit}) is very low. This may cause truncated or poor-quality results.`,
      fix: 'Increase service.tokenLimit to at least 1024, ideally 2048 or higher.',
      autoFix: (raw) => {
        const svc = raw.service as Record<string, unknown>
        if (svc) {
          svc.tokenLimit = 2048
        }
      },
    })
  }

  if (config.service.maxConcurrent && config.service.provider === 'ollama' && config.service.maxConcurrent > 1) {
    diagnostics.push({
      severity: 'warn',
      message: `maxConcurrent is ${config.service.maxConcurrent} but Ollama typically handles one request at a time.`,
      fix: 'Set service.maxConcurrent to 1 for Ollama.',
      autoFix: (raw) => {
        const svc = raw.service as Record<string, unknown>
        if (svc) {
          svc.maxConcurrent = 1
        }
      },
    })
  }
}

function checkIgnoredFiles(config: Config, diagnostics: Diagnostic[]) {
  if (!config.ignoredFiles || config.ignoredFiles.length === 0) {
    diagnostics.push({
      severity: 'info',
      message: 'No custom ignored files configured. Coco uses defaults (package-lock.json, .gitignore contents, etc.).',
    })
  }
}

function checkProjectConfigFile(diagnostics: Diagnostic[]) {
  const hasNewName = fs.existsSync('.coco.json')
  const hasLegacyName = fs.existsSync('.coco.config.json')

  if (!hasNewName && !hasLegacyName) {
    diagnostics.push({
      severity: 'info',
      message: 'No project config file found in the current directory. Using git config, env vars, or defaults.',
      fix: 'Run `coco init --scope project` to create a project config.',
    })
    return
  }

  if (hasLegacyName && !hasNewName) {
    diagnostics.push({
      severity: 'info',
      message: 'Using legacy config filename .coco.config.json. Consider renaming to .coco.json.',
      fix: 'Rename .coco.config.json to .coco.json. Both filenames are supported, but .coco.json is preferred.',
    })
  }

  const configPath = hasNewName ? '.coco.json' : '.coco.config.json'

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

    if (!raw.$schema) {
      diagnostics.push({
        severity: 'info',
        message: `Project config (${configPath}) is missing the $schema field. Adding it enables editor autocompletion.`,
        fix: `Add "$schema": "https://coco.griffen.codes/schema.json" to ${configPath}.`,
        autoFix: (rawConfig) => {
          rawConfig.$schema = 'https://coco.griffen.codes/schema.json'
        },
      })
    }
  } catch {
    diagnostics.push({
      severity: 'error',
      message: `${configPath} contains invalid JSON.`,
      fix: `Fix the JSON syntax in ${configPath} or regenerate it with \`coco init --scope project\`.`,
    })
  }
}

/** Does the Ollama daemon report `model` as pulled? Tolerant of the implicit
 * `:latest` tag Ollama applies when a model is referenced without one. */
function isModelPulled(model: string, pulled: string[]): boolean {
  if (pulled.includes(model)) return true
  if (!model.includes(':')) return pulled.includes(`${model}:latest`)
  if (model.endsWith(':latest')) return pulled.includes(model.slice(0, -':latest'.length))
  return false
}

/**
 * Live Ollama checks that need a network round-trip — kept out of the
 * synchronous {@link runDiagnostics} (which `coco init` runs inline) so only
 * `coco doctor` pays the cost. No-op for non-Ollama providers.
 *
 * Surfaces the two first-run cliffs the config checks can't see:
 *   - the daemon isn't reachable at the configured endpoint, and
 *   - the model coco will actually call isn't pulled (for `dynamic`, the
 *     resolved commit-tier model is checked).
 */
export async function checkOllamaLiveness(config: Config): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  if (config.service?.provider !== 'ollama') return diagnostics

  const endpoint =
    ('endpoint' in config.service && config.service.endpoint) || DEFAULT_OLLAMA_ENDPOINT
  const status = await getOllamaStatus(endpoint)

  if (!status.reachable) {
    diagnostics.push({
      severity: 'error',
      message: `Ollama daemon is not reachable at ${endpoint}.`,
      fix: status.installed
        ? 'Start it with `ollama serve` (or open the Ollama app).'
        : 'Install Ollama (https://ollama.com/download), then run `ollama serve`.',
    })
    return diagnostics
  }

  const configuredModel = config.service.model
  const modelToCheck =
    configuredModel === 'dynamic' ? resolveDynamicModel(config, 'commit') : configuredModel

  if (modelToCheck && !isModelPulled(modelToCheck, status.models)) {
    const dynamicNote = configuredModel === 'dynamic' ? ' (dynamic → commit)' : ''
    const have = status.models.length
      ? ` Pulled: ${status.models.slice(0, 4).join(', ')}${status.models.length > 4 ? '…' : ''}.`
      : ''
    diagnostics.push({
      severity: 'warn',
      message: `Ollama model '${modelToCheck}'${dynamicNote} isn't pulled.${have}`,
      fix: `Pull it with \`ollama pull ${modelToCheck}\`.`,
    })
  }

  return diagnostics
}
