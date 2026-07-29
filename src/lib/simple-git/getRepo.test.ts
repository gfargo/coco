import { getRepo } from './getRepo';
import { simpleGit } from 'simple-git';

jest.mock('simple-git', () => ({
  simpleGit: jest.fn().mockImplementation(() => ({
    checkIsRepo: jest.fn().mockResolvedValue(true),
  })),
}));

describe('getRepo', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it('writes init failures to stderr (not stdout) and includes baseDir', () => {
    (simpleGit as unknown as jest.Mock).mockImplementationOnce(() => {
      throw new Error('not a git repository');
    });
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(() => getRepo('/not/a/repo')).toThrow(
      expect.objectContaining({ code: 1 })
    );
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('/not/a/repo')
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('not a git repository')
    );
  });
});
