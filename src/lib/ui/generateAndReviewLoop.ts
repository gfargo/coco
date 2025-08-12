import { Logger } from '../utils/logger'
import { editPrompt } from './editPrompt'
import { editResult } from './editResult'
import { ReviewDecision, getUserReviewDecision } from './getUserReviewDecision'
import { logResult } from './logResult'

export type GenerateReviewLoopOptions = {
  interactive: boolean
  logger: Logger
  prompt?: string
  openInEditor?: boolean
  review?: {
    selectLabel?: string
    descriptions?: Partial<Record<ReviewDecision, string>>
    labels?: Partial<Record<ReviewDecision, string>>
    enableRetry?: boolean
    enableFullRetry?: boolean
    enableModifyPrompt?: boolean
    enableEdit?: boolean
    customEditFunction?: (message: string, options: GenerateReviewLoopOptions) => Promise<string>
  }
}

export type GenerateReviewLoopInput<T, R = string> = {
  label: string
  factory: () => Promise<T>
  parser: (changes: T, result: R, options: GenerateReviewLoopOptions) => Promise<string>
  noResult: (options: GenerateReviewLoopOptions) => Promise<void>
  agent: (context: string, options: GenerateReviewLoopOptions) => Promise<R>
  reviewParser?: (result: R, options: GenerateReviewLoopOptions) => string
  options: GenerateReviewLoopOptions
}

export async function generateAndReviewLoop<T, R>({
  label,
  factory,
  parser,
  noResult,
  agent,
  reviewParser,
  options,
}: GenerateReviewLoopInput<T, R>) : Promise<R> {
  const { logger } = options

  let continueLoop = true
  let modifyPrompt = false
  let context = ''
  let result = '' as R

  const changes = await factory()
  // if we don't have any changes, bail.
  if (!changes || !Object.keys(changes).length) {
    await noResult(options)
  }

  while (continueLoop) {
    if (!context.length) {
      context = await parser(changes, result, options)
    }

    // if we still don't have a context, bail.
    if (!context.length) {
      await noResult(options)
    }

    if (modifyPrompt) {
      options.prompt = await editPrompt(options)
    }

    logger.startTimer().startSpinner(`Generating ${label}\n`, {
      color: 'blue',
    })

    try {
      result = await agent(context, options)

      if (!result) {
        logger.stopSpinner('💀 Agent failed to return content.', {
          mode: 'fail',
          color: 'red',
        })
        process.exit(0)
      }
    } catch (error) {
      // Handle special regeneration request from validation
      if ((error as Error).message === 'REGENERATE_COMMIT_MESSAGE') {
        logger.stopSpinner('Regenerating commit message...', {
          mode: 'stop',
          color: 'blue',
        })
        result = '' as R
        continue
      }
      // Re-throw other errors
      throw error
    }

    logger
      .stopSpinner(`Generated ${label}`, {
        color: 'green',
        mode: 'succeed',
      })
      .stopTimer()

    if (options?.interactive) {
      logResult(label, reviewParser ? reviewParser(result, options) : result as string)

      const reviewAnswer = await getUserReviewDecision({
        label,
        ...(options?.review || {}),
      })

      if (reviewAnswer === 'cancel') {
        process.exit(0)
      }

      if (reviewAnswer === 'edit') {
        options.openInEditor = true
      }

      if (reviewAnswer === 'retryFull') {
        context = ''
        result = '' as R
        options.prompt = ''
        continue
      }

      if (reviewAnswer === 'retryMessageOnly') {
        modifyPrompt = false
        result = '' as R
        continue
      }

      if (reviewAnswer === 'modifyPrompt') {
        modifyPrompt = true
        result = '' as string as R
        continue
      }
      
      // Only edit the result in interactive mode if approved
      // Use custom edit function if provided, otherwise use default editResult
      const editFunction = options.review?.customEditFunction || editResult
      result = await editFunction(result as string, options) as R
    } else {
      // In non-interactive mode, we return the result as is to be output to stdout by the caller.
      const displayResult = reviewParser ? reviewParser(result, options) : result as string
    
      // In non-interactive mode, ensure we return the properly formatted result
      result = displayResult as unknown as R
    }

    // if we're here, we're done.
    continueLoop = false
  }

  return result
}
