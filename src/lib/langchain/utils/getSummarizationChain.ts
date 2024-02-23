import { SummarizationChainParams, loadSummarizationChain } from 'langchain/chains';
import { getLlm } from './getLlm';

/**
 * Get Summarization Chain
 * @param model
 * @param options
 * @returns
 */

export function getSummarizationChain(
  model: ReturnType<typeof getLlm>,
  options: SummarizationChainParams = { type: 'map_reduce' }
) {
  return loadSummarizationChain(model, options);
}
