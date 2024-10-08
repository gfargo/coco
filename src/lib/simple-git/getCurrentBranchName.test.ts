import { simpleGit, SimpleGit } from 'simple-git';
import { getCurrentBranchName } from './getCurrentBranchName';

jest.mock('simple-git', () => ({
  simpleGit: jest.fn().mockImplementation(() => ({
    branch: jest.fn().mockResolvedValue({ current: 'main' }),
    revparse: jest.fn().mockResolvedValue('main'),
  })),
}));

describe('getCurrentBranchName', () => {
  let git: SimpleGit;

  beforeEach(() => {
    git = simpleGit();
  });

  it('should return the current branch name', async () => {
    const branchName = await getCurrentBranchName({ git });
    expect(branchName).toBe('main');
  });

  it('should handle errors gracefully', async () => {
    git.revparse = jest.fn().mockRejectedValue(new Error('Git error'));
    await expect(getCurrentBranchName({ git })).rejects.toThrow('Git error');
  });
});
