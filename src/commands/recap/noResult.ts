import { SimpleGit } from 'simple-git'
import { Logger } from '../../lib/utils/logger'

type NoResultInput = {
  git: SimpleGit
  logger: Logger
  message?: string
}

export async function noResult({ logger, message }: NoResultInput): Promise<void> {
  logger.log(message ?? 'No repo changes detected. 👀', { color: 'blue' })
}
