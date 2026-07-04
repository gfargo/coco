import { LangChainValidationError, LangChainConfigurationError } from './errors'
import { LLMProvider, LLMModel, LLMService } from './types'
import { LLM_PROVIDER_IDS } from './providers/registry'
import { detectProviderMismatch, getDeprecatedReplacement } from './modelValidity'

/**
 * Validates that a required parameter is not null or undefined
 */
export function validateRequired<T>(
  value: T,
  paramName: string,
  functionName?: string
): asserts value is NonNullable<T> {
  if (value === null || value === undefined) {
    throw new LangChainValidationError(
      `${functionName ? `${functionName}: ` : ''}Required parameter '${paramName}' is missing`,
      { paramName, functionName, value }
    )
  }
}

/**
 * Validates that a string parameter is not empty
 */
export function validateNonEmptyString(
  value: string | null | undefined,
  paramName: string,
  functionName?: string
): asserts value is string {
  validateRequired(value, paramName, functionName)
  
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LangChainValidationError(
      `${functionName ? `${functionName}: ` : ''}Parameter '${paramName}' must be a non-empty string`,
      { paramName, functionName, value, type: typeof value }
    )
  }
}

/**
 * Validates that an array parameter is not empty
 */
export function validateNonEmptyArray<T>(
  value: T[] | null | undefined,
  paramName: string,
  functionName?: string
): asserts value is T[] {
  validateRequired(value, paramName, functionName)
  
  if (!Array.isArray(value) || value.length === 0) {
    throw new LangChainValidationError(
      `${functionName ? `${functionName}: ` : ''}Parameter '${paramName}' must be a non-empty array`,
      { paramName, functionName, value, isArray: Array.isArray(value), length: Array.isArray(value) ? value.length : undefined }
    )
  }
}

/**
 * Validates that a provider is supported
 */
export function validateProvider(
  provider: unknown,
  functionName?: string
): asserts provider is LLMProvider {
  const validProviders: LLMProvider[] = LLM_PROVIDER_IDS

  if (!validProviders.includes(provider as LLMProvider)) {
    throw new LangChainConfigurationError(
      `${functionName ? `${functionName}: ` : ''}Invalid provider '${provider}'. Supported providers: ${validProviders.join(', ')}`,
      { provider, validProviders, functionName }
    )
  }
}

/**
 * Validates that a model is valid for the given provider
 */
export function validateModel(
  model: unknown,
  provider: LLMProvider,
  functionName?: string
): asserts model is LLMModel {
  validateRequired(model, 'model', functionName)
  
  if (typeof model !== 'string' || model.trim() === '') {
    throw new LangChainValidationError(
      `${functionName ? `${functionName}: ` : ''}Model must be a non-empty string`,
      { model, provider, functionName }
    )
  }

  // Per-provider validity: fail fast on a *definite* cross-provider mismatch
  // (the model is exactly a known model of a different provider, e.g.
  // `claude-…` under provider `openai`). This would otherwise surface as a
  // cryptic API error mid-run. Exact-membership only — unrecognized/new models
  // and open-namespace providers (ollama) pass untouched.
  const mismatchOwner = detectProviderMismatch(model, provider)
  if (mismatchOwner) {
    throw new LangChainValidationError(
      `${functionName ? `${functionName}: ` : ''}Model '${model}' is a ${mismatchOwner} model, not a ${provider} model. ` +
        `Set service.model to a ${provider} model, or change service.provider to '${mismatchOwner}'.`,
      { model, provider, owner: mismatchOwner, functionName }
    )
  }

  // Retired/superseded ids (see `DEPRECATED_MODELS`) 404 against the provider's
  // API — catch them here, before the network call, instead of letting the
  // request fail mid-generation with a cryptic provider error.
  const replacement = getDeprecatedReplacement(model)
  if (replacement) {
    throw new LangChainValidationError(
      `${functionName ? `${functionName}: ` : ''}Model '${model}' has been retired and is no longer available. ` +
        `Update service.model to '${replacement}', or run 'coco doctor' to apply the fix automatically.`,
      { model, provider, replacement, functionName }
    )
  }
}

/**
 * Validates that a service configuration is complete and valid
 */
export function validateServiceConfig(
  service: unknown,
  functionName?: string
): asserts service is LLMService {
  validateRequired(service, 'service', functionName)
  
  if (typeof service !== 'object') {
    throw new LangChainConfigurationError(
      `${functionName ? `${functionName}: ` : ''}Service configuration must be an object`,
      { service, functionName }
    )
  }
  
  const serviceObj = service as Record<string, unknown>
  
  validateProvider(serviceObj.provider, functionName)
  validateModel(serviceObj.model, serviceObj.provider as LLMProvider, functionName)
  
  // Validate authentication
  if (!serviceObj.authentication || typeof serviceObj.authentication !== 'object') {
    throw new LangChainConfigurationError(
      `${functionName ? `${functionName}: ` : ''}Service configuration must include authentication`,
      { service, functionName }
    )
  }
}

/**
 * Validates function parameters with detailed error context
 */
export function validateParameters(
  parameters: Record<string, unknown>,
  functionName: string
): void {
  const missingParams: string[] = []
  const invalidParams: Array<{ name: string, value: unknown, expected: string }> = []
  
  for (const [paramName, value] of Object.entries(parameters)) {
    if (value === null || value === undefined) {
      missingParams.push(paramName)
    }
  }
  
  if (missingParams.length > 0 || invalidParams.length > 0) {
    let message = `${functionName}: Parameter validation failed.`
    
    if (missingParams.length > 0) {
      message += ` Missing parameters: ${missingParams.join(', ')}.`
    }
    
    if (invalidParams.length > 0) {
      const invalidDetails = invalidParams.map(p => `${p.name} (expected ${p.expected}, got ${typeof p.value})`).join(', ')
      message += ` Invalid parameters: ${invalidDetails}.`
    }
    
    throw new LangChainValidationError(message, {
      functionName,
      missingParams,
      invalidParams,
      providedParams: Object.keys(parameters)
    })
  }
}