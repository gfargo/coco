import { Logger } from '../utils/logger'
import { logResult } from './logResult'
import { editResult } from './editResult'
import { getUserReviewDecision } from './getUserReviewDecision'
import { editPrompt } from './editPrompt'

export type GenerateReviewLoopOptions = {
  interactive: boolean
  logger: Logger
  prompt?: string
  openInEditor?: boolean
}

export type GenerateReviewLoopInput<T> = {
  label: string
  factory: () => Promise<T[]>
  parser: (changes: T[], commit: string, options: GenerateReviewLoopOptions) => Promise<string>
  noResult: (options: GenerateReviewLoopOptions) => Promise<void>
  agent: (context: string, options: GenerateReviewLoopOptions) => Promise<string>
  options: GenerateReviewLoopOptions
}

export async function generateAndReviewLoop<T>({
  label,
  factory,
  parser,
  noResult,
  agent,
  options,
}: GenerateReviewLoopInput<T>): Promise<string> {
  const { logger } = options

  let continueLoop = true
  let modifyPrompt = false
  let context = ''
  let result = ''

  const changes = await factory()
  // if we don't have any changes, bail.
  if (!changes || !changes.length) {
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
      logResult(label, result)
      const reviewAnswer = await getUserReviewDecision()

      if (reviewAnswer === 'cancel') {
        process.exit(0)
      }

      if (reviewAnswer === 'edit') {
        options.openInEditor = true
      }

      if (reviewAnswer === 'retryFull') {
        context = ''
        result = ''
        options.prompt = ''
        continue
      }

      if (reviewAnswer === 'retryMessageOnly') {
        modifyPrompt = false
        result = ''
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
