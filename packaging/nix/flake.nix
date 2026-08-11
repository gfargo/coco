# Nix flake for coco (npm package `git-coco`). Canonical source — see
# packaging/README.md for usage (`nix run`/`nix profile install`).
#
# Regenerate `version`/`url`/`sha256` on each release with:
#
#     node bin/genManifests.mjs            # latest published version
#     node bin/genManifests.mjs 0.71.0     # a specific version
#
# `npmDepsHash` is a separate, Nix-specific hash of `package-lock.json`
# (computed offline for network-sandboxed builds) that `genManifests.mjs`
# cannot produce — it isn't a plain sha256 of downloaded bytes. Refresh it
# manually after a release that changes dependencies:
#
#     nix run nixpkgs#prefetch-npm-deps -- package-lock.json
{
  description = "coco — AI-powered git assistant (commits, changelogs, reviews, terminal workstation)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        packages.default = pkgs.buildNpmPackage rec {
          pname = "git-coco";
          version = "0.87.0";

          src = pkgs.fetchurl {
            url = "https://registry.npmjs.org/git-coco/-/git-coco-${version}.tgz";
            sha256 = "0db09c65cc472b550c98ff4609bfcfc8f8a763435aa58a44e753c6cf3f0d165e";
          };

          # See the file header — must be refreshed by hand with
          # `prefetch-npm-deps`, not by genManifests.mjs.
          npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

          dontNpmBuild = true;

          meta = with pkgs.lib; {
            description = "AI-powered git assistant: commits, changelogs, reviews, and a terminal workstation";
            homepage = "https://coco.griffen.codes";
            license = licenses.mit;
            mainProgram = "coco";
          };
        };

        apps.default = flake-utils.lib.mkApp { drv = self.packages.${system}.default; };
      });
}
