import { getSummaryText } from './getSummaryText';
import { getStatus } from './getStatus';
import { FileStatusResult } from 'simple-git';
import { FileChange, FileChangeStatus } from '../types';

jest.mock('./getStatus', () => ({
  getStatus: jest.fn(),
}));

describe('getSummaryText', () => {
  const file: FileStatusResult = { path: 'file.txt', index: 'A', working_dir: 'M' };
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return correct summary text', () => {
    const change = { status: 'added' as FileChangeStatus, oldFilePath: 'oldFile.txt', filepath: 'file.txt', summary: 'mockedSummary' };

    expect(getSummaryText(file, change)).toBe('added: oldFile.txt -> file.txt');
  });

  it('should use getStatus function when status is not provided', () => {
    (getStatus as jest.Mock).mockReturnValue('modified');
    const change = { oldFilePath: 'oldFile.txt', filePath: 'file.txt' } as Partial<FileChange>;

    expect(getSummaryText(file, change)).toBe('modified: oldFile.txt -> file.txt');
    expect(getStatus).toHaveBeenCalledWith(file);
  });

  it('should return summary text without oldFilePath when it is not provided', () => {
    const change = { status: 'added' as FileChangeStatus, filepath: 'file.txt', summary: 'mockedSummary' };

    expect(getSummaryText(file, change)).toBe('added: file.txt');
  });
});
