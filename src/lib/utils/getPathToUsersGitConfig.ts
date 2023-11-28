import os from 'os';
import path from 'path';

export function getPathToUsersGitConfig() {
  return path.join(os.homedir(), '.gitconfig');
}
