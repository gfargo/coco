import {
    MapReduceDocumentsChain,
    RefineDocumentsChain,
    StuffDocumentsChain,
} from '@langchain/classic/chains'
import { Document, DocumentInput } from '@langchain/classic/document'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { Logger } from '../../../utils/logger'
import { TokenCounter } from '../../../utils/tokenizer'
import { LlmCallMetadata, logLlmCall } from '../../utils/observability'
import { isRetryableError } from '../../errorHandler'

export type SummarizeContext = {
  textSplitter: RecursiveCharacterTextSplitter
  chain: StuffDocumentsChain | MapReduceDocumentsChain | RefineDocumentsChain
  options?: {
    returnIntermediateSteps?: boolean
  }
  logger?: Logger
  tokenizer?: TokenCounter
  metadata?: Partial<LlmCallMetadata>
}

/**
 * Adaptive backoff (#845, PR 3). Wraps the chain invocation so a
 * transient 429 (rate limit) or 5xx no longer kills the whole
 * pipeline — instead we wait briefly and retry up to N times
 * before surfacing the failure.
 *
 * Cap is intentionally short. Diff condensing fans out to many
 * concurrent calls; if rate limits hit hard, queueing requests
 * indefinitely just makes the user wait longer for a result the
 * pipeline ultimately handles via fewer concurrent passes anyway.
 * 3 retries with 1s/2s/4s waits trade ~7s of worst-case extra
 * latency for resilience to brief rate-limit blips.
 */
const BACKOFF_RETRIES = 3
const BACKOFF_BASE_MS = 1000
const BACKOFF_CAP_MS = 5000

// Retryability uses the shared transient-error predicate (errorHandler), so the
// summarize backoff and the rest of the codebase agree on what's retryable.

async function invokeWithBackoff(
  chain: SummarizeContext['chain'],
  input: { input_documents: Document[]; returnIntermediateSteps: boolean },
  logger: Logger | undefined
): Promise<{ text: string; error?: string }> {
  let lastError: unknown
  for (let attempt = 0; attempt <= BACKOFF_RETRIES; attempt++) {
    try {
      return await chain.invoke(input) as { text: string; error?: string }
    } catch (error) {
      lastError = error
      if (!isRetryableError(error) || attempt === BACKOFF_RETRIES) {
        throw error
      }
      const wait = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, attempt))
      logger?.verbose(
        `[summarize] retryable error (attempt ${attempt + 1}/${BACKOFF_RETRIES}); backing off ${wait}ms`,
        { color: 'yellow' }
      )
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
  // Unreachable — the loop either returns or rethrows above.
  throw lastError
}

export async function summarize(
  documents: DocumentInput[],
  { chain, textSplitter, options, logger, tokenizer, metadata }: SummarizeContext
): Promise<string> {
  const { returnIntermediateSteps = false } = options || {}

  const docs = await textSplitter.splitDocuments(documents.map((doc) => new Document(doc)))
  const promptTokens = tokenizer
    ? docs.reduce((sum, doc) => sum + tokenizer(doc.pageContent), 0)
    : undefined

  const startedAt = Date.now()
  const res = await invokeWithBackoff(chain, {
    input_documents: docs,
    returnIntermediateSteps,
  }, logger)
  const elapsedMs = Date.now() - startedAt

  logLlmCall(logger, {
    task: 'summarize',
    promptTokens,
    elapsedMs,
    inputDocuments: documents.length,
    inputChunks: docs.length,
    ...metadata,
  })

  if (res.error) throw new Error(res.error)

  return res.text && res.text.trim()
}
