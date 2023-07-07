import { CommitResult, SimpleGit } from 'simple-git';

export async function createCommit(
  commitMsg: string,
  git: SimpleGit
): Promise<CommitResult> {
  return await git.commit(commitMsg);
}
