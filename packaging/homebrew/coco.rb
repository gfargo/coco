# Homebrew formula for coco (npm package `git-coco`).
#
# This lives here as the canonical source. To publish it, copy it into a tap
# repo named `gfargo/homebrew-tap` (file: Formula/coco.rb). Users then run:
#
#     brew install gfargo/tap/coco
#
# Regenerate the url + sha256 on each release with:
#
#     node bin/genHomebrewFormula.mjs            # latest published version
#     node bin/genHomebrewFormula.mjs 0.71.0     # a specific version
#
# Homebrew brings Node along as a dependency, so this is the zero-prerequisite
# install path for users who don't already have a Node toolchain.
require "language/node"

class Coco < Formula
  desc "AI-powered git assistant: commits, changelogs, reviews, and a terminal workstation"
  homepage "https://coco.griffen.codes"
  url "https://registry.npmjs.org/git-coco/-/git-coco-0.71.0.tgz"
  sha256 "1850834cea63f66d0234ed3a443fff058889a315391667fa45174b8bf8979870"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]

    # Shell completions are generated at runtime (`coco completion` /
    # `coco completion fish`), not shipped as static files — invoke the
    # just-installed binary to produce them (#1587). `coco completion`
    # picks bash vs zsh from $SHELL at generation time, so each variant
    # needs its own forced-env invocation rather than reusing one script
    # for both directories.
    bash_output = with_env(SHELL: "/bin/bash") { Utils.safe_popen_read(bin/"coco", "completion") }
    zsh_output = with_env(SHELL: "/bin/zsh") { Utils.safe_popen_read(bin/"coco", "completion") }
    (bash_completion/"coco").write bash_output
    (zsh_completion/"_coco").write zsh_output
    (fish_completion/"coco.fish").write Utils.safe_popen_read(bin/"coco", "completion", "fish")
  end

  test do
    assert_match "coco", shell_output("#{bin}/coco --help 2>&1")
  end
end
