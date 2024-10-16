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
    descriptions?: Partial<Record<ReviewDecision, string>>
    enableRetry?: boolean
    enableFullRetry?: boolean
    enableModifyPrompt?: boolean
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

    result = await agent(context, options)

    if (!result) {
      logger.stopSpinner('💀 Agent failed to return content.', {
        mode: 'fail',
        color: 'red',
      })
      process.exit(0)
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
        result = ''
        continue
      }
    }

    // if we're here, we're done.
    result = await editResult(result, options)
    continueLoop = false
  }

  return result
}
