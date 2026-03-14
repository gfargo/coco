import {
    MapReduceDocumentsChain,
    RefineDocumentsChain,
    StuffDocumentsChain,
} from '@langchain/classic/chains'
import { Document, DocumentInput } from '@langchain/classic/document'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

export type SummarizeContext = {
  textSplitter: RecursiveCharacterTextSplitter
  chain: StuffDocumentsChain | MapReduceDocumentsChain | RefineDocumentsChain
  options?: {
    returnIntermediateSteps?: boolean
  }
}

export async function summarize(
  documents: DocumentInput[],
  { chain, textSplitter, options }: SummarizeContext
): Promise<string> {
  const { returnIntermediateSteps = false } = options || {}

  const docs = await textSplitter.splitDocuments(documents.map((doc) => new Document(doc)))

  const res = await chain.invoke({
    input_documents: docs,
    returnIntermediateSteps,
  })

  if (res.error) throw new Error(res.error)

  return res.text && res.text.trim()
}
