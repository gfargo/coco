/**
 * Synthetic fixture-repo generator for the workstation benchmark
 * (#1425). Builds bare-metal git history at three scales (100 / 5k /
 * 50k commits) with wide branch fan-out, fast enough that generating
 * the fixture never dominates the benchmark's own wall-clock.
 *
 * `@gfargo/git-scenarios` was considered and ruled out — it only
 * ships small hand-authored scenarios with no bulk-generation knobs.
 *
 * The 50k-commit case is the reason this uses `git fast-import`
 * rather than a loop of `git commit` subprocesses: one spawn per
 * commit at that scale would itself take minutes, swamping the
 * benchmark it's meant to set up for.
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export type WorkstationFixtureScale = 'small' | 'medium' | 'large'

export type WorkstationFixtureSpec = {
  scale: WorkstationFixtureScale
  totalCommits: number
  branchCount: number
  commitsPerBranch: number
}

export const WORKSTATION_FIXTURE_SPECS: Record<WorkstationFixtureScale, WorkstationFixtureSpec> = {
  small: { scale: 'small', totalCommits: 100, branchCount: 10, commitsPerBranch: 3 },
  medium: { scale: 'medium', totalCommits: 5_000, branchCount: 50, commitsPerBranch: 5 },
  large: { scale: 'large', totalCommits: 50_000, branchCount: 200, commitsPerBranch: 10 },
}

export type WorkstationFixture = {
  dir: string
  spec: WorkstationFixtureSpec
  /** Wall-clock cost of building the fixture itself — reported separately from measured phases. */
  generationMs: number
  cleanup: () => void
}

function runGit(args: string[], cwd: string, input?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`git ${args.join(' ')} exited ${code}: ${stderr.trim()}`))
      }
    })
    if (input !== undefined) {
      child.stdin?.end(input)
    }
  })
}

/**
 * `data <byte-count>\n<content>` — the fast-import exact-byte-count
 * form. No trailing newline of its own: `lines.join('\n')` already
 * supplies the one separator line the format allows after `<raw>`:
 * adding a second one here reads as a blank line to the parser, which
 * ends the enclosing commit early and dumps the next `M` line at the
 * top level ("Unsupported command: M ...").
 */
function dataCommand(content: string): string {
  return `data ${Buffer.byteLength(content, 'utf8')}\n${content}`
}

/**
 * Builds a `git fast-import` stream: a linear `main` history plus
 * `branchCount` branches (wide fan-out), each forking off a different
 * point along `main` and carrying `commitsPerBranch` short-lived
 * commits of its own. Every commit touches a single small file so
 * generation cost stays flat regardless of scale.
 */
function buildFastImportStream(spec: WorkstationFixtureSpec): string {
  const BASE_TIMESTAMP = 1_700_000_000
  const lines: string[] = []
  let mark = 0

  const branchCommitTotal = spec.branchCount * spec.commitsPerBranch
  const mainCommits = Math.max(spec.totalCommits - branchCommitTotal, 1)
  const mainMarks: number[] = []

  for (let i = 0; i < mainCommits; i++) {
    mark += 1
    lines.push('commit refs/heads/main')
    lines.push(`mark :${mark}`)
    lines.push(`committer Bench Author <bench@example.com> ${BASE_TIMESTAMP + i} +0000`)
    lines.push(dataCommand(`commit ${i} on main`))
    lines.push('M 100644 inline file.txt')
    lines.push(dataCommand(`main content at commit ${i}\n`))
    mainMarks.push(mark)
  }

  for (let branch = 0; branch < spec.branchCount; branch++) {
    const forkIndex = Math.floor((mainMarks.length - 1) * (branch / Math.max(spec.branchCount, 1)))
    const forkMark = mainMarks[forkIndex] ?? mainMarks[0]

    for (let c = 0; c < spec.commitsPerBranch; c++) {
      mark += 1
      lines.push(`commit refs/heads/branch-${branch}`)
      lines.push(`mark :${mark}`)
      lines.push(
        `committer Bench Author <bench@example.com> ${
          BASE_TIMESTAMP + mainCommits + branch * spec.commitsPerBranch + c
        } +0000`
      )
      lines.push(dataCommand(`commit ${c} on branch-${branch}`))
      if (c === 0) {
        // Only the branch's first commit needs `from` — later commits
        // on the same ref implicitly parent onto the ref's current tip.
        lines.push(`from :${forkMark}`)
      }
      lines.push(`M 100644 inline branch-${branch}.txt`)
      lines.push(dataCommand(`branch ${branch} content at commit ${c}\n`))
    }
  }

  return `${lines.join('\n')}\n`
}

export async function generateWorkstationFixture(
  scale: WorkstationFixtureScale
): Promise<WorkstationFixture> {
  const spec = WORKSTATION_FIXTURE_SPECS[scale]
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `coco-bench-${scale}-`))
  const startedAt = Date.now()

  await runGit(['init', '-q'], dir)
  await runGit(['symbolic-ref', 'HEAD', 'refs/heads/main'], dir)
  await runGit(['config', 'user.email', 'bench@example.com'], dir)
  await runGit(['config', 'user.name', 'Bench Author'], dir)
  await runGit(['fast-import', '--quiet'], dir, buildFastImportStream(spec))
  // fast-import writes objects + refs directly; it never touches the
  // working tree or index, so a checkout is needed before any
  // status/worktree overview reads a sane tree.
  await runGit(['reset', '-q', '--hard', 'main'], dir)

  const generationMs = Date.now() - startedAt

  return {
    dir,
    spec,
    generationMs,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  }
}
