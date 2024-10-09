import { getRepo } from './getRepo';

jest.mock('simple-git', () => ({
  simpleGit: jest.fn().mockImplementation(() => ({
    checkIsRepo: jest.fn().mockResolvedValue(true),
  })),
}));

describe('getRepo', () => {
  it('should return a SimpleGit instance if the directory is a git repository', async () => {
    const git = getRepo();
    expect(git).toBeInstanceOf(Object);
    expect(await git.checkIsRepo()).toBe(true);
  });

  it('should throw an error if the directory is not a git repository', async () => {
    const git = getRepo();
    git.checkIsRepo = jest.fn().mockResolvedValue(false);
    await expect(git.checkIsRepo()).resolves.toBe(false);
  });
});
