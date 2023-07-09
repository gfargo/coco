import { SimpleGit, CommitResult } from 'simple-git';
import { createCommit } from './createCommit'; // Assuming the path to the function

jest.mock('simple-git'); // use correct module path, might be 'simple-git'

describe('createCommit', () => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const git: jest.Mocked<SimpleGit> = {
    commit: jest.fn().mockResolvedValue({
      author: null,
      branch: 'main',
      commit: '123abc',
    } as CommitResult),
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call git commit with the provided message', async () => {
    const commitMessage = 'test commit message';
    await createCommit(commitMessage, git);

    expect(git.commit).toBeCalledWith(commitMessage);
  });

  it('should return CommitResult', async () => {
    const commitMessage = 'another test commit message';
    const result: CommitResult = await createCommit(commitMessage, git);

    expect(result).toEqual({
      author: null,
      branch: 'main',
      commit: '123abc',
    });
  });
});
