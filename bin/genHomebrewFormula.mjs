#!/usr/bin/env node
// Thin alias over bin/genManifests.mjs, kept as its own entry point for
// `npm run release:formula` and existing muscle memory. Regenerates only the
// Homebrew formula (packaging/homebrew/coco.rb) — see genManifests.mjs for
// the full multi-ecosystem generator (Homebrew, Scoop, winget, AUR, Nix).
//
//   node bin/genHomebrewFormula.mjs            # latest published version
//   node bin/genHomebrewFormula.mjs 0.71.0     # a specific version
import { regenerateManifests } from "./genManifests.mjs"

const requestedVersion = process.argv[2] || "latest"

regenerateManifests({ requestedVersion, only: ["homebrew"] }).catch((err) => {
  process.stderr.write(`genHomebrewFormula failed: ${err.message}\n`)
  process.exit(1)
})
