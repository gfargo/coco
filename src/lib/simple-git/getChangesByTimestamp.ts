import { SimpleGit } from 'simple-git'
import { Logger } from '../utils/logger'
import { formatCommitLog } from './formatCommitLog'

type Props = {
  since: string
  git: SimpleGit
  logger?: Logger
}

export const getChangesByTimestamp = async ({ since, git }: Props) => {
  const commitLog = await git.log({ '--since': since });
  return formatCommitLog(commitLog)
}
