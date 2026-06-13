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

1. Create a public repo named **`gfargo/homebrew-coco`**.
2. Add the formula at `Formula/coco.rb` (copy from `packaging/homebrew/coco.rb`).
3. Users install with:

   ```bash
   brew install gfargo/coco/coco
   ```

### Keeping the formula current

After each `npm publish`, regenerate the `url` + `sha256` from the published
tarball and push it to the tap:

```bash
node bin/genHomebrewFormula.mjs            # latest published version
node bin/genHomebrewFormula.mjs 0.71.0     # a specific version
```

This is wired into the release flow via the `release:formula` script.

## Release checklist (distribution bits)

- [ ] `npm publish` succeeded and `npm view git-coco version` shows the new version
- [ ] `node bin/genHomebrewFormula.mjs` run; `packaging/homebrew/coco.rb` updated
- [ ] formula copied/pushed to `gfargo/homebrew-coco`
- [ ] `install.sh` unchanged or re-copied to `.www/public/install.sh`
- [ ] `brew install gfargo/coco/coco` smoke-tested on a clean machine (or CI)
