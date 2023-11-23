import { SimpleGit } from 'simple-git'

export type GetCurrentBranchName = {
  git: SimpleGit
}

export async function getCurrentBranchName({ git }: GetCurrentBranchName): Promise<string> {
  return await git.revparse(['--abbrev-ref', 'HEAD'])
}
