#!/usr/bin/env node
// Regenerate every packaging manifest under packaging/ from a published npm
// release: Homebrew formula, Scoop bucket manifest, winget manifest trio,
// AUR PKGBUILD (+ .SRCINFO), and the Nix flake.
//
//   node bin/genManifests.mjs            # latest published version
//   node bin/genManifests.mjs 0.71.0     # a specific version
//   node bin/genManifests.mjs 0.71.0 --only=homebrew,scoop
//
// Fetches the tarball from the npm registry, computes its SHA-256, and
// rewrites each manifest's url/version/hash fields in place. Run this after
// `npm publish` on release (wired into the release flow via
// `release:manifests`) and fan the results out to each ecosystem's target
// repo — see .github/workflows/update-package-managers.yml and
// packaging/README.md.
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const PKG = "git-coco"
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const paths = {
  homebrew: join(repoRoot, "packaging", "homebrew", "coco.rb"),
  scoop: join(repoRoot, "packaging", "scoop", "coco.json"),
  wingetVersion: join(repoRoot, "packaging", "winget", "Gfargo.Coco.yaml"),
  wingetInstaller: join(repoRoot, "packaging", "winget", "Gfargo.Coco.installer.yaml"),
  wingetLocale: join(repoRoot, "packaging", "winget", "Gfargo.Coco.locale.en-US.yaml"),
  aurPkgbuild: join(repoRoot, "packaging", "aur", "PKGBUILD"),
  aurSrcinfo: join(repoRoot, "packaging", "aur", ".SRCINFO"),
  nixFlake: join(repoRoot, "packaging", "nix", "flake.nix"),
}

const ALL_TARGETS = ["homebrew", "scoop", "winget", "aur", "nix"]

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.json()
}

/** Resolves the requested (or latest) published version + its tarball url/sha256. */
async function resolveRelease(requested) {
  const meta = await fetchJson(`https://registry.npmjs.org/${PKG}`)
  const version = requested === "latest" ? meta["dist-tags"]?.latest : requested
  const release = meta.versions?.[version]
  if (!release) {
    throw new Error(`Version ${version} not found on npm for ${PKG}`)
  }
  const url = release.dist.tarball

  process.stdout.write(`Fetching ${url} …\n`)
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
  const sha256 = createHash("sha256").update(buf).digest("hex")

  return { version, url, sha256 }
}

function writeIfChanged(path, updated, original, label) {
  if (updated === original) {
    process.stdout.write(`  ${label}: already up to date.\n`)
    return false
  }
  writeFileSync(path, updated)
  process.stdout.write(`  ${label}: updated.\n`)
  return true
}

function regenerateHomebrew({ url, sha256 }) {
  const original = readFileSync(paths.homebrew, "utf8")
  const updated = original
    .replace(/url ".*"/, `url "${url}"`)
    .replace(/sha256 ".*"/, `sha256 "${sha256}"`)
  return writeIfChanged(paths.homebrew, updated, original, "packaging/homebrew/coco.rb")
}

function regenerateScoop({ version, url, sha256 }) {
  const original = readFileSync(paths.scoop, "utf8")
  const updated = original
    .replace(/"version": ".*"/, `"version": "${version}"`)
    .replace(/"url": "https:\/\/registry\.npmjs\.org\/git-coco\/-\/git-coco-.*\.tgz"/, `"url": "${url}"`)
    .replace(/"hash": "sha256:[0-9a-f]*"/, `"hash": "sha256:${sha256}"`)
  return writeIfChanged(paths.scoop, updated, original, "packaging/scoop/coco.json")
}

function regenerateWinget({ version, url, sha256 }) {
  let changed = false

  for (const path of [paths.wingetVersion, paths.wingetInstaller, paths.wingetLocale]) {
    const original = readFileSync(path, "utf8")
    const updated = original.replace(/^PackageVersion: .*/m, `PackageVersion: ${version}`)
    changed = writeIfChanged(path, updated, original, `packaging/winget/${path.split("/").pop()}`) || changed
  }

  const original = readFileSync(paths.wingetInstaller, "utf8")
  const updated = original
    .replace(/InstallerUrl: .*/, `InstallerUrl: ${url}`)
    .replace(/InstallerSha256: [0-9A-Fa-f]*/, `InstallerSha256: ${sha256.toUpperCase()}`)
  changed = writeIfChanged(paths.wingetInstaller, updated, original, "packaging/winget/Gfargo.Coco.installer.yaml (hash)") || changed

  return changed
}

function regenerateAur({ version, url, sha256 }) {
  const pkgbuildOriginal = readFileSync(paths.aurPkgbuild, "utf8")
  const pkgbuildUpdated = pkgbuildOriginal
    .replace(/^pkgver=.*/m, `pkgver=${version}`)
    .replace(
      /^source=\(.*\)$/m,
      `source=("$pkgname-$pkgver.tgz::https://registry.npmjs.org/$pkgname/-/$pkgname-$pkgver.tgz")`
    )
    .replace(/^sha256sums=\('.*'\)$/m, `sha256sums=('${sha256}')`)
  const pkgbuildChanged = writeIfChanged(paths.aurPkgbuild, pkgbuildUpdated, pkgbuildOriginal, "packaging/aur/PKGBUILD")

  const srcinfoOriginal = readFileSync(paths.aurSrcinfo, "utf8")
  const srcinfoUpdated = srcinfoOriginal
    .replace(/^(\tpkgver = ).*/m, `$1${version}`)
    .replace(
      /^(\tsource = ).*/m,
      `$1git-coco-${version}.tgz::${url}`
    )
    .replace(/^(\tsha256sums = ).*/m, `$1${sha256}`)
  const srcinfoChanged = writeIfChanged(paths.aurSrcinfo, srcinfoUpdated, srcinfoOriginal, "packaging/aur/.SRCINFO")

  return pkgbuildChanged || srcinfoChanged
}

function regenerateNix({ version, sha256 }) {
  // `url` stays parameterized as `${version}` (Nix string interpolation) —
  // only the pinned `version` and the tarball `sha256` are literal values.
  const original = readFileSync(paths.nixFlake, "utf8")
  const updated = original
    .replace(/pname = "git-coco";\n(\s*)version = ".*";/, `pname = "git-coco";\n$1version = "${version}";`)
    .replace(/sha256 = "[0-9a-f]*";/, `sha256 = "${sha256}";`)
  const changed = writeIfChanged(paths.nixFlake, updated, original, "packaging/nix/flake.nix")
  process.stdout.write(
    "  packaging/nix/flake.nix: npmDepsHash NOT regenerated — refresh by hand with " +
      "`nix run nixpkgs#prefetch-npm-deps -- package-lock.json` if dependencies changed.\n"
  )
  return changed
}

const REGENERATORS = {
  homebrew: regenerateHomebrew,
  scoop: regenerateScoop,
  winget: regenerateWinget,
  aur: regenerateAur,
  nix: regenerateNix,
}

/**
 * Regenerates the requested (default: all) packaging manifests for the
 * given/latest published version. Exported so `genHomebrewFormula.mjs` can
 * delegate to the `homebrew`-only path without duplicating the fetch/hash
 * logic.
 */
export async function regenerateManifests({ requestedVersion = "latest", only = ALL_TARGETS } = {}) {
  const release = await resolveRelease(requestedVersion)
  process.stdout.write(`Resolved ${PKG}@${release.version}\n  sha256 ${release.sha256}\n`)

  const results = {}
  for (const target of only) {
    process.stdout.write(`${target}:\n`)
    results[target] = REGENERATORS[target](release)
  }
  return { release, results }
}

function parseArgs(argv) {
  const only = argv.find((arg) => arg.startsWith("--only="))
  const positional = argv.find((arg) => !arg.startsWith("--"))
  return {
    requestedVersion: positional || "latest",
    only: only ? only.slice("--only=".length).split(",") : ALL_TARGETS,
  }
}

async function main() {
  const { requestedVersion, only } = parseArgs(process.argv.slice(2))
  for (const target of only) {
    if (!REGENERATORS[target]) {
      throw new Error(`Unknown manifest target "${target}" — expected one of: ${ALL_TARGETS.join(", ")}`)
    }
  }
  await regenerateManifests({ requestedVersion, only })
}

// Only run when invoked directly (`node bin/genManifests.mjs`), not when
// imported by genHomebrewFormula.mjs.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`genManifests failed: ${err.message}\n`)
    process.exit(1)
  })
}
