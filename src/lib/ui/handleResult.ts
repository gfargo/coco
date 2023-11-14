import { type SimpleGit } from 'simple-git';
import { createCommit } from '../simple-git/createCommit';
import { logSuccess } from './logSuccess';

export const handleResult = async (
  result: string,
  { mode, git }: { mode: 'interactive' | 'stdout'; git: SimpleGit; }
) => {
  // Handle resulting commit message
  switch (mode) {
    case 'interactive':
      await createCommit(result, git);
      logSuccess();
      break;
    case 'stdout':
    default:
      process.stdout.write(result, 'utf8');
      break;
  }

  process.exit(0);
};
