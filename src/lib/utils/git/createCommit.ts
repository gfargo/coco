import * as nodegit from 'nodegit';

export async function createCommit(
  commitMsg: string,
  repo: nodegit.Repository
): Promise<nodegit.Oid | null> {
  const author = await nodegit.Signature.default(repo);

  const index = await repo.refreshIndex();
  await index.addAll();
  await index.write();

  const oid = await index.writeTree();

  const head = await nodegit.Reference.nameToId(repo, "HEAD");
  const parent = await repo.getCommit(head);

  return await repo.createCommit("HEAD", author, author, commitMsg, oid, [parent]);
}
