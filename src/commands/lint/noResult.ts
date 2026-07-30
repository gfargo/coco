import { Logger } from '../../lib/utils/logger'

type NoResultInput = {
  logger: Logger
  range: string
}

export async function noResult({ logger, range }: NoResultInput): Promise<void> {
  logger.log(`No commits found in range '${range}'. 👀`, { color: 'blue' })
}
