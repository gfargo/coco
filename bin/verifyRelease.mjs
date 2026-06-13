#!/usr/bin/env node
// Release guard: refuse to publish a version whose shipped `dist/` is identical
// to what's already on npm.
//
// This is the check that would have caught the 0.70.0 incident, where the
// version was bumped but the feature branch never merged, so the published
// tarball was byte-for-byte identical to 0.69.0. It also refuses to re-publish
// a version that already exists on the registry.
//
//   node bin/verifyRelease.mjs            # build, pack, compare against latest npm
//   node bin/verifyRelease.mjs --no-build # skip the build (dist/ assumed current)
//
// Exit non-zero (and explain) on a problem; exit 0 when the release looks real.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
const PKG = pkg.name
const VERSION = pkg.version
const noBuild = process.argv.includes("--no-build")

const log = (m) => process.stdout.write(`${m}\n`)
const die = (m) => {
  process.stderr.write(`\n✗ ${m}\n`)
  process.exit(1)
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: repoRoot, encoding: "utf8", ...opts })
}

async function fetchJson(url) {
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) die(`registry error ${res.status} for ${url}`)
  return res.json()
}

// Hash every file under package/dist/ in an extracted tarball dir.
function hashDist(rootDir) {
  const distDir = join(rootDir, "package", "dist")
  const map = new Map()
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(abs, relPath)
      else if (entry.isFile()) {
        map.set(relPath, createHash("sha256").update(readFileSync(abs)).digest("hex"))
      }
    }
  }
  try {
    statSync(distDir)
  } catch {
    die(`packed tarball has no dist/ — build output is missing`)
  }
  walk(distDir, "")
  return map
}

function extractTarball(tgz, label) {
  const dir = mkdtempSync(join(tmpdir(), `coco-${label}-`))
  sh("tar", ["-xzf", tgz, "-C", dir])
  return dir
}

async function main() {
  log(`Verifying release ${PKG}@${VERSION}`)

  const meta = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(PKG)}`)
  if (!meta || !meta.versions) {
    log("No prior publish found on npm — first release, skipping diff check.")
    return
  }

  if (meta.versions[VERSION]) {
    die(
      `${PKG}@${VERSION} is already published on npm. ` +
        `Bump the version before releasing.`,
    )
  }

  const latest = meta["dist-tags"]?.latest
  const prevTarballUrl = meta.versions[latest]?.dist?.tarball
  if (!latest || !prevTarballUrl) {
    log("Could not resolve the latest published tarball — skipping diff check.")
    return
  }

  // Build fresh unless told not to, then pack the local tree.
  if (!noBuild) {
    log("Building…")
    sh("npm", ["run", "build"], { stdio: "inherit" })
  }
  log("Packing local tarball…")
  const packJson = JSON.parse(sh("npm", ["pack", "--json"]))
  const localTgz = join(repoRoot, packJson[0].filename)

  log(`Downloading published ${PKG}@${latest}…`)
  const prevBuf = Buffer.from(await (await fetch(prevTarballUrl)).arrayBuffer())
  const prevTgz = join(mkdtempSync(join(tmpdir(), "coco-prev-")), "prev.tgz")
  const { writeFileSync } = await import("node:fs")
  writeFileSync(prevTgz, prevBuf)

  const localDist = hashDist(extractTarball(localTgz, "local"))
  const prevDist = hashDist(extractTarball(prevTgz, "prev"))

  // Compare dist file trees.
  const added = [...localDist.keys()].filter((f) => !prevDist.has(f))
  const removed = [...prevDist.keys()].filter((f) => !localDist.has(f))
  const changed = [...localDist.keys()].filter(
    (f) => prevDist.has(f) && prevDist.get(f) !== localDist.get(f),
  )

  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    die(
      `dist/ in ${PKG}@${VERSION} is byte-identical to the published ${latest}.\n` +
        `  Nothing would ship. Did the feature branch actually merge into the ` +
        `release commit?\n  (This is the 0.70.0 failure mode — aborting before publish.)`,
    )
  }

  log("")
  log(`✓ Release content differs from ${latest}:`)
  log(`    ${changed.length} changed, ${added.length} added, ${removed.length} removed (dist/)`)
  if (changed.length) log(`    changed: ${changed.slice(0, 8).join(", ")}${changed.length > 8 ? " …" : ""}`)
  if (added.length) log(`    added:   ${added.slice(0, 8).join(", ")}${added.length > 8 ? " …" : ""}`)
  if (removed.length) log(`    removed: ${removed.slice(0, 8).join(", ")}${removed.length > 8 ? " …" : ""}`)
}

main().catch((err) => die(err.message))
