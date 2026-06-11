import { execFileSync } from 'node:child_process'

/**
 * Live `glab` CLI compatibility check. Runs the actual `glab <subcommand>
 * --help` for every verb coco shells out to and asserts the flags coco passes
 * still exist. This catches CLI drift — exactly the class of bug that shipped
 * once (`glab mr note --message` was deprecated to an erroring command group and
 * the fixture-only tests never noticed).
 *
 * Gated on `glab` being installed, so CI without glab simply skips it. When glab
 * IS present (locally, or a CI job that installs it), this is a real contract
 * test against the shipping binary. No GitLab auth is needed for `--help`.
 */

function glabInstalled(): boolean {
  try {
    execFileSync('glab', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function glabHelp(args: string[]): string {
  try {
    return execFileSync('glab', [...args, '--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    const e = error as { stdout?: Buffer | string; stderr?: Buffer | string }
    return `${e.stdout?.toString() ?? ''}\n${e.stderr?.toString() ?? ''}`
  }
}

const describeIfGlab = glabInstalled() ? describe : describe.skip

describeIfGlab('glab CLI flag compatibility (live glab) (#0.70)', () => {
  // The flag contract coco depends on, mirrored from the action modules. If a
  // future glab release renames/removes one of these, this test fails loudly
  // instead of users hitting a broken action.
  const FLAG_CASES: Array<{ label: string; cmd: string[]; flags: string[] }> = [
    { label: 'mr create', cmd: ['mr', 'create'], flags: ['--source-branch', '--target-branch', '--title', '--description', '--push', '--yes', '--draft'] },
    { label: 'mr merge', cmd: ['mr', 'merge'], flags: ['--squash', '--rebase', '--yes'] },
    { label: 'mr note create', cmd: ['mr', 'note', 'create'], flags: ['--message'] },
    { label: 'mr update', cmd: ['mr', 'update'], flags: ['--label', '--assignee'] },
    { label: 'issue note', cmd: ['issue', 'note'], flags: ['--message'] },
    { label: 'issue update', cmd: ['issue', 'update'], flags: ['--label', '--assignee'] },
  ]

  it.each(FLAG_CASES)('`glab $label` accepts the flags coco passes', ({ cmd, flags }) => {
    const help = glabHelp(cmd)
    for (const flag of flags) {
      expect(help).toContain(flag)
    }
  })

  // Verbs that take no flags coco depends on — assert the subcommand PATH exists
  // (a missing/renamed verb makes `glab <verb> --help` exit non-zero).
  const VERB_CASES: string[][] = [
    ['mr', 'approve'],
    ['mr', 'close'],
    ['mr', 'note', 'create'],
    ['mr', 'view'],
    ['issue', 'close'],
    ['issue', 'reopen'],
    ['issue', 'note'],
  ]

  it.each(VERB_CASES)('`glab %s` exists as a subcommand', (...cmd) => {
    expect(() => execFileSync('glab', [...cmd, '--help'], { stdio: 'ignore' })).not.toThrow()
  })

  it('mr create includes --push so the source branch is pushed', () => {
    // Regression guard for the parity fix: gh assumes a pushed branch; glab
    // needs --push or the MR can't be opened from a local-only branch.
    expect(glabHelp(['mr', 'create'])).toContain('--push')
  })
})
