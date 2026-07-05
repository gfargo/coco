import { readFileSync } from 'fs'
import { resolve as resolvePath, sep } from 'path'
import { SimpleGit } from 'simple-git'
import { writeFileAtomic } from '../lib/utils/atomicFileWrite'
import { BranchActionResult } from './branchActions'

/**
 * Conflict-region extraction + write-back for AI conflict resolution
 * (#1369).
 *
 * A conflicted file contains one or more marker regions:
 *
 *   <<<<<<< <ours label>
 *   ...our side...
 *   ||||||| <base label>        (only with merge.conflictStyle=diff3)
 *   ...merged base...
 *   =======
 *   ...their side...
 *   >>>>>>> <theirs label>
 *
 * `parseConflictRegions` lifts each region into a structured record;
 * `applyConflictResolution` replaces ONE region's whole marker block
 * with accepted resolution text and rewrites the file atomically
 * (tmp+rename). Regions are re-parsed and matched BY CONTENT at apply
 * time — earlier accepts shift line numbers, so positional identity
 * would target the wrong block.
 */

export type ConflictRegion = {
  /** 0-based ordinal among the file's regions at parse time. */
  index: number
  /** 1-based line number of the `<<<<<<<` marker. */
  startLine: number
  /** 1-based line number of the `>>>>>>>` marker. */
  endLine: number
  /** Ref label after `<<<<<<<` (usually HEAD / a branch). */
  oursLabel: string
  /** Ref label after `>>>>>>>` (the incoming ref). */
  theirsLabel: string
  ours: string[]
  /** diff3-style base section (`|||||||`), when present. */
  base?: string[]
  theirs: string[]
}

// Git's markers are EXACTLY seven marker characters: `<<<<<<< <label>`,
// `||||||| <base-label>`, a bare `=======`, `>>>>>>> <label>`. Matching
// by prefix (#1395) let ordinary content flip the parser — an RST/
// markdown setext underline (`========`) or a `//======== divider`
// comment inside the "ours" side started the theirs section early, and
// the real separator then landed INSIDE theirs. The AI resolver and
// accept-ours/theirs would operate on the wrong side contents. The
// `(?:\s|$)` tail (rather than requiring a label) tolerates CRLF and
// label-less markers; an 8th marker character fails the match.
export const CONFLICT_OURS_MARKER = /^<{7}(?:\s|$)/
export const CONFLICT_BASE_MARKER = /^\|{7}(?:\s|$)/
export const CONFLICT_SEPARATOR_MARKER = /^={7}\s*$/
export const CONFLICT_THEIRS_MARKER = /^>{7}(?:\s|$)/

export function parseConflictRegions(content: string): {
  lines: string[]
  regions: ConflictRegion[]
} {
  const lines = content.split('\n')
  const regions: ConflictRegion[] = []

  let i = 0
  while (i < lines.length) {
    if (!CONFLICT_OURS_MARKER.test(lines[i])) {
      i += 1
      continue
    }
    const startLine = i + 1
    const oursLabel = lines[i].slice(7).trim()
    const ours: string[] = []
    let base: string[] | undefined
    const theirs: string[] = []
    let section: 'ours' | 'base' | 'theirs' = 'ours'
    let endLine = -1
    let theirsLabel = ''
    let j = i + 1
    for (; j < lines.length; j += 1) {
      const line = lines[j]
      if (section !== 'theirs' && CONFLICT_BASE_MARKER.test(line)) {
        section = 'base'
        base = []
        continue
      }
      if (section !== 'theirs' && CONFLICT_SEPARATOR_MARKER.test(line)) {
        section = 'theirs'
        continue
      }
      if (section === 'theirs' && CONFLICT_THEIRS_MARKER.test(line)) {
        theirsLabel = line.slice(7).trim()
        endLine = j + 1
        break
      }
      if (section === 'ours') ours.push(line)
      else if (section === 'base') base!.push(line)
      else theirs.push(line)
    }
    if (endLine === -1) {
      // Unterminated region (file truncated mid-conflict) — stop
      // scanning rather than mis-attributing the tail.
      break
    }
    regions.push({
      index: regions.length,
      startLine,
      endLine,
      oursLabel,
      theirsLabel,
      ours,
      base,
      theirs,
    })
    i = endLine
  }

  return { lines, regions }
}

/** Content-identity check — labels + all three sections must match. */
function sameRegionContent(a: ConflictRegion, b: ConflictRegion): boolean {
  const arraysEqual = (x: string[] | undefined, y: string[] | undefined): boolean => {
    if (x === undefined || y === undefined) return x === y
    return x.length === y.length && x.every((line, i) => line === y[i])
  }
  return (
    a.oursLabel === b.oursLabel &&
    a.theirsLabel === b.theirsLabel &&
    arraysEqual(a.ours, b.ours) &&
    arraysEqual(a.base, b.base) &&
    arraysEqual(a.theirs, b.theirs)
  )
}

async function resolveWorktreeFile(git: SimpleGit, path: string): Promise<string> {
  const root = (await git.revparse(['--show-toplevel'])).trim()
  const resolved = resolvePath(root, path)
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Refusing to resolve path outside worktree root: ${path}`)
  }
  return resolved
}

/**
 * Read + parse the current conflict regions of a worktree file.
 */
export async function getConflictFileRegions(
  git: SimpleGit,
  path: string
): Promise<{ ok: true; regions: ConflictRegion[] } | { ok: false; message: string }> {
  try {
    const file = await resolveWorktreeFile(git, path)
    const { regions } = parseConflictRegions(readFileSync(file, 'utf8'))
    if (regions.length === 0) {
      return { ok: false, message: `No conflict markers found in ${path}.` }
    }
    return { ok: true, regions }
  } catch (error) {
    return { ok: false, message: (error as Error).message.split('\n')[0] || `Failed to read ${path}.` }
  }
}

export type ApplyConflictResolutionResult = BranchActionResult & {
  /** Marker regions still present in the file after the write. */
  remainingRegions?: number
}

/**
 * Replace one conflict region's marker block with `resolution` and
 * rewrite the file atomically. The region is matched by CONTENT
 * against a fresh parse (see module header). An empty resolution
 * deletes the block outright (both sides removed).
 */
export async function applyConflictResolution(
  git: SimpleGit,
  path: string,
  region: ConflictRegion,
  resolution: string
): Promise<ApplyConflictResolutionResult> {
  try {
    const file = await resolveWorktreeFile(git, path)
    const { lines, regions } = parseConflictRegions(readFileSync(file, 'utf8'))
    const matches = regions.filter((candidate) => sameRegionContent(candidate, region))
    if (matches.length === 0) {
      return { ok: false, message: `Conflict region not found in ${path} — file changed on disk.` }
    }
    if (matches.length > 1) {
      return { ok: false, message: `Conflict region is ambiguous in ${path} (identical duplicates).` }
    }
    const target = matches[0]

    // Normalize the replacement: drop ONE trailing newline (the region
    // block itself ends at a line boundary), keep interior blank lines.
    const replacement = resolution === ''
      ? []
      : (resolution.endsWith('\n') ? resolution.slice(0, -1) : resolution).split('\n')

    const nextLines = [
      ...lines.slice(0, target.startLine - 1),
      ...replacement,
      ...lines.slice(target.endLine),
    ]
    const next = nextLines.join('\n')

    // tmp+rename so a crash mid-write can't leave a half-resolved file.
    writeFileAtomic(file, next)

    const remaining = parseConflictRegions(next).regions.length
    return {
      ok: true,
      message: `Resolved region in ${path}${remaining ? ` — ${remaining} remaining` : ' — file clean'}`,
      remainingRegions: remaining,
    }
  } catch (error) {
    return { ok: false, message: (error as Error).message.split('\n')[0] || `Failed to write ${path}.` }
  }
}
