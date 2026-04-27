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

export async function summarize(
  documents: DocumentInput[],
  { chain, textSplitter, options, logger, tokenizer, metadata }: SummarizeContext
): Promise<string> {
  const { returnIntermediateSteps = false } = options || {}

  const docs = await textSplitter.splitDocuments(documents.map((doc) => new Document(doc)))
  const promptTokens = tokenizer
    ? docs.reduce((sum, doc) => sum + tokenizer(doc.pageContent), 0)
    : undefined

  logLlmCall(logger, {
    task: 'summarize',
    promptTokens,
    inputDocuments: documents.length,
    inputChunks: docs.length,
    ...metadata,
  })

  const res = await chain.invoke({
    input_documents: docs,
    returnIntermediateSteps,
  })

  if (res.error) throw new Error(res.error)

  return res.text && res.text.trim()
}
