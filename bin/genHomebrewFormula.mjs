#!/usr/bin/env node
// Regenerate packaging/homebrew/coco.rb from a published npm release.
//
//   node bin/genHomebrewFormula.mjs            # latest published version
//   node bin/genHomebrewFormula.mjs 0.71.0     # a specific version
//
// Fetches the tarball from the npm registry, computes its SHA-256, and rewrites
// the formula's url + sha256 in place. Run this after `npm publish` on release
// (or wire it into the release flow) and copy the result into the Homebrew tap.
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const PKG = "git-coco"
const here = dirname(fileURLToPath(import.meta.url))
const formulaPath = join(here, "..", "packaging", "homebrew", "coco.rb")

async function main() {
  const requested = process.argv[2] || "latest"

  const meta = await fetchJson(`https://registry.npmjs.org/${PKG}`)
  const version =
    requested === "latest" ? meta["dist-tags"]?.latest : requested
  const release = meta.versions?.[version]
  if (!release) {
    throw new Error(`Version ${version} not found on npm for ${PKG}`)
  }
  const url = release.dist.tarball

  process.stdout.write(`Fetching ${url} …\n`)
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
  const sha256 = createHash("sha256").update(buf).digest("hex")

  const formula = readFileSync(formulaPath, "utf8")
  const updated = formula
    .replace(/url ".*"/, `url "${url}"`)
    .replace(/sha256 ".*"/, `sha256 "${sha256}"`)

  if (updated === formula) {
    process.stdout.write("Formula already up to date.\n")
  } else {
    writeFileSync(formulaPath, updated)
    process.stdout.write(`Updated formula → ${version}\n  sha256 ${sha256}\n`)
  }
}

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.json()
}

main().catch((err) => {
  process.stderr.write(`genHomebrewFormula failed: ${err.message}\n`)
  process.exit(1)
})
