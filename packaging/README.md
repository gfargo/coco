# Packaging & distribution

Install paths for `coco`, beyond `npm install -g git-coco`.

## 1. curl installer

`install.sh` (repo root, also published at `https://coco.griffen.codes/install.sh`)
is a POSIX `sh` script that checks for Node 22+, installs `git-coco` globally
with whatever package manager is present (npm/pnpm/yarn), and prints next steps.

```bash
curl -fsSL https://coco.griffen.codes/install.sh | sh

# pin a version
curl -fsSL https://coco.griffen.codes/install.sh | COCO_VERSION=0.71.0 sh
```

The copy served by the site lives at `.www/public/install.sh`. Keep it in sync
with the root `install.sh` (the release flow copies it; see below).

## 2. Homebrew

`packaging/homebrew/coco.rb` is the canonical formula. Homebrew pulls in Node as
a dependency, so this is the **zero-prerequisite** path for users without a Node
toolchain.

### One-time tap setup

1. Create a public repo named **`gfargo/homebrew-tap`**.
2. Add the formula at `Formula/coco.rb` (copy from `packaging/homebrew/coco.rb`).
3. Users install with:

   ```bash
   brew install gfargo/tap/coco
   ```

### Keeping the formula current

After each `npm publish`, regenerate the `url` + `sha256` from the published
tarball and push it to the tap:

```bash
node bin/genHomebrewFormula.mjs            # latest published version
node bin/genHomebrewFormula.mjs 0.71.0     # a specific version
```

This is wired into the release flow via the `release:formula` script, and
into CI via `.github/workflows/update-homebrew-tap.yml` (runs on every
published GitHub release).

## 3. Scoop (Windows)

`packaging/scoop/coco.json` is the canonical bucket manifest. Like Homebrew,
it pulls Node in as a dependency (`depends: nodejs-lts`) and runs a global
`npm install` under the hood, so it's a zero-prerequisite path for Windows
users without their own Node toolchain.

### One-time bucket setup

1. Create a public repo named **`gfargo/scoop-bucket`**.
2. Add the manifest at `bucket/coco.json` (copy from `packaging/scoop/coco.json`).
3. Users add the bucket once, then install:

   ```powershell
   scoop bucket add gfargo https://github.com/gfargo/scoop-bucket
   scoop install gfargo/coco
   ```

## 4. winget (Windows)

`packaging/winget/` holds the three-file manifest winget expects
(`Gfargo.Coco.yaml`, `Gfargo.Coco.installer.yaml`,
`Gfargo.Coco.locale.en-US.yaml`). Unlike Scoop, winget has no "run npm
install" installer primitive — a real submission needs an actual packaged
Windows installer/portable artifact, which this repo doesn't build yet. The
manifest trio here is kept regenerable (version/url/sha256) so identity and
metadata never go stale, but **`packaging/winget/Gfargo.Coco.installer.yaml`
must be updated with a real installer artifact before opening a PR** against
[microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs). Not
wired into the automated fanout for that reason — see the comment at the top
of that file.

## 5. AUR (Arch Linux)

`packaging/aur/PKGBUILD` (+ generated `.SRCINFO`) is the canonical AUR
package. Installs via a global `npm install` against `nodejs`, same model as
Homebrew/Scoop.

### One-time AUR setup

1. Claim the `git-coco` package name on [aur.archlinux.org](https://aur.archlinux.org).
2. Register an SSH key with your AUR account; add its private half as the
   repo secret `AUR_SSH_KEY`.
3. Users install with an AUR helper, e.g. `yay -S git-coco`.

## 6. Nix

`packaging/nix/flake.nix` wraps the npm package with `buildNpmPackage`.

```bash
nix run github:gfargo/nix-coco       # once the flake repo exists
# or, straight from this repo's canonical copy:
nix run ./packaging/nix
```

`npmDepsHash` is a separate, Nix-specific hash of `package-lock.json` that
plain `node bin/genManifests.mjs` cannot compute (it isn't a sha256 of
downloaded bytes) — refresh it by hand after a release that changes
dependencies:

```bash
nix run nixpkgs#prefetch-npm-deps -- package-lock.json
```

### One-time flake repo setup

1. Create a public repo named **`gfargo/nix-coco`** with `flake.nix` at the root.
2. Add repo secret `NIX_FLAKE_TOKEN` — a fine-grained PAT that can push to it.

## Regenerating every manifest at once

`bin/genManifests.mjs` generalizes `genHomebrewFormula.mjs` to cover all of
the above (Homebrew, Scoop, winget, AUR, Nix) from one release:

```bash
node bin/genManifests.mjs                        # latest published version, all ecosystems
node bin/genManifests.mjs 0.71.0                  # a specific version, all ecosystems
node bin/genManifests.mjs --only=scoop,aur        # a subset
```

`.github/workflows/update-package-managers.yml` runs this on every published
release and pushes the result to each ecosystem's target repo (Scoop, AUR,
Nix), mirroring `update-homebrew-tap.yml`. Each job is a no-op — not a
failure — until its target repo + secret exist, so this workflow is safe to
merge before every tap does. winget is intentionally excluded (see §4).

## Release checklist (distribution bits)

- [ ] `npm publish` succeeded and `npm view git-coco version` shows the new version
- [ ] `node bin/genManifests.mjs` run; `packaging/{homebrew,scoop,winget,aur,nix}/*` updated
- [ ] Homebrew formula copied/pushed to `gfargo/homebrew-tap`
- [ ] Scoop manifest copied/pushed to `gfargo/scoop-bucket`
- [ ] AUR PKGBUILD + .SRCINFO pushed to the `git-coco` AUR package
- [ ] Nix flake copied/pushed to `gfargo/nix-coco`
- [ ] winget manifest reviewed by hand — needs a real installer artifact before submitting to `microsoft/winget-pkgs`
- [ ] `install.sh` unchanged or re-copied to `.www/public/install.sh`
- [ ] `brew install gfargo/tap/coco` smoke-tested on a clean machine (or CI)
