import { getStatus } from './getStatus';
import { FileStatusResult } from 'simple-git';

describe('getStatus', () => {
  it('should return correct status based on statusCode', () => {
    const file: FileStatusResult = { path: 'file.txt', index: 'A', working_dir: 'M' };

    expect(getStatus(file)).toBe('added');
    expect(getStatus(file, 'working_dir')).toBe('modified');
  });

  it('should return unknown when the status is not recognized', () => {
    const file: FileStatusResult = { path: 'file.txt', index: 'Z', working_dir: 'Z' };

    expect(getStatus(file)).toBe('unknown');
    expect(getStatus(file, 'working_dir')).toBe('unknown');
  });
});
