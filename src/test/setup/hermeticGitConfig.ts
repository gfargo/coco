/**
 * Keep the user's own git configuration out of the test run.
 *
 * Many suites create real repositories and commit in them. With a developer's
 * global config in play, `commit.gpgsign=true` makes every one of those commits
 * run gpg, and `release-it`'s `npm test` hook then times out on a busy laptop
 * while CI (which has no signing) stays green. Pointing git at a throwaway
 * global file with an identity and signing off makes the run behave the same
 * everywhere. Suites that exercise config or signing set their own
 * `GIT_CONFIG_*` and are unaffected.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (!process.env.COCO_TEST_USE_USER_GIT_CONFIG) {
  const dir = mkdtempSync(join(tmpdir(), 'coco-jest-gitconfig-'))
  const file = join(dir, 'gitconfig')
  writeFileSync(
    file,
    [
      '[user]',
      '\tname = Coco Test',
      '\temail = coco-test@example.com',
      '[commit]',
      '\tgpgsign = false',
      '[tag]',
      '\tgpgsign = false',
      '\tforcesignannotated = false',
      '[init]',
      '\tdefaultBranch = main',
      '',
    ].join('\n')
  )
  process.env.GIT_CONFIG_GLOBAL = file
  process.env.GIT_CONFIG_NOSYSTEM = '1'
}
