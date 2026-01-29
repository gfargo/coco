import { Argv } from 'yargs'
import { loadConfig } from '../config/utils/loadConfig'
import { Logger } from './logger'
import { CommandHandler } from '../types'
import { BaseArgvOptions } from '../../commands/types'
import { LangChainNetworkError, LangChainAuthenticationError } from '../langchain/errors'

/**
 * Formats a network error with helpful troubleshooting information
 */
function formatNetworkError(error: LangChainNetworkError, logger: Logger): void {
  const endpoint = error.endpoint || 'unknown endpoint'
  const provider = error.provider || 'LLM service'

  logger.log('\nFailed to execute command', { color: 'yellow' })
  logger.log(`\nError: Unable to connect to ${provider}`, { color: 'red' })

  if (error.endpoint) {
    logger.log(`       Endpoint: ${endpoint}`, { color: 'red' })
  }

  logger.log('\nTroubleshooting:', { color: 'cyan' })

  // Provider-specific troubleshooting
  if (provider === 'ollama' || endpoint.includes('11434')) {
    logger.log('  • Is Ollama running? Try: ollama serve', { color: 'white' })
    logger.log('  • Check if the endpoint is correct in your config', { color: 'white' })
    logger.log(`  • Verify Ollama is accessible: curl ${endpoint}/api/version`, { color: 'white' })
  } else if (provider === 'openai' || endpoint.includes('openai')) {
    logger.log('  • Check your internet connection', { color: 'white' })
    logger.log('  • Verify the API endpoint is accessible', { color: 'white' })
    logger.log('  • If using a custom baseURL, verify it is correct', { color: 'white' })
  } else if (provider === 'anthropic') {
    logger.log('  • Check your internet connection', { color: 'white' })
    logger.log('  • Verify the Anthropic API is accessible', { color: 'white' })
  } else {
    logger.log('  • Check your internet connection', { color: 'white' })
    logger.log('  • Verify the service endpoint is correct', { color: 'white' })
    logger.log('  • Ensure the LLM service is running and accessible', { color: 'white' })
  }

  logger.verbose(`\nOriginal error: ${error.message}`, { color: 'gray' })
}

/**
 * Formats an authentication error with helpful information
 */
function formatAuthenticationError(error: LangChainAuthenticationError, logger: Logger): void {
  logger.log('\nFailed to execute command', { color: 'yellow' })
  logger.log('\nError: Authentication failed', { color: 'red' })

  logger.log('\nTroubleshooting:', { color: 'cyan' })
  logger.log('  • Verify your API key is correct', { color: 'white' })
  logger.log('  • Check that your API key has not expired', { color: 'white' })
  logger.log('  • Ensure the API key is set in your environment or config', { color: 'white' })

  logger.verbose(`\nOriginal error: ${error.message}`, { color: 'gray' })
}

/**
 * Formats a generic error
 */
function formatGenericError(error: Error, logger: Logger): void {
  logger.log('\nFailed to execute command', { color: 'yellow' })
  logger.verbose(`\nError: "${error.message}"`, { color: 'red' })
}

function commandExecutor<T extends Argv<BaseArgvOptions>['argv']>(handler: CommandHandler<T>) {
  return async (argv: T) => {
    const options = loadConfig(argv)
    const logger = new Logger(options)

    try {
      await handler(argv, logger)
    } catch (error) {
      // Handle specific error types with helpful messages
      if (error instanceof LangChainNetworkError) {
        formatNetworkError(error, logger)
      } else if (error instanceof LangChainAuthenticationError) {
        formatAuthenticationError(error, logger)
      } else {
        formatGenericError(error as Error, logger)
      }

      logger.log('\nThanks for using coco, make it a great day! 👋🤖', { color: 'blue' })
      process.exit(0)
    }
  }
}

export default commandExecutor
