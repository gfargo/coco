import { SimpleGit } from 'simple-git'
import { Logger } from '../utils/logger'
import { formatCommitLog } from './formatCommitLog'

type Props = {
  git: SimpleGit
  logger?: Logger
}

export const getChangesSinceLastTag = async ({ git }: Props) => {
  const tags = await git.tags()
  if (tags.all.length > 0) {
    const lastTag = tags.latest
    const commitLog = await git.log({ from: lastTag })
    return formatCommitLog(commitLog)
  } else {
    return ['No tags found in the repository.']
  }
}
