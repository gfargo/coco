import { SimpleGit } from 'simple-git'
import { Logger } from '../../lib/utils/logger'

type NoResultInput = {
  git: SimpleGit
  logger: Logger
}

export async function noResult({ logger }: NoResultInput): Promise<void> {
  logger.log('No repo changes detected. 👀', { color: 'blue' })
}
