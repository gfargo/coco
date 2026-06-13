#!/bin/sh
# coco installer — https://coco.griffen.codes
#
#   curl -fsSL https://coco.griffen.codes/install.sh | sh
#
# Installs the `coco` CLI (npm package `git-coco`) globally. Node 22+ is
# required; if it's missing this script tells you the shortest way to get it
# rather than guessing. Pin a version with COCO_VERSION, e.g.
#
#   curl -fsSL https://coco.griffen.codes/install.sh | COCO_VERSION=0.71.0 sh
#
set -eu

PKG="git-coco"
VERSION="${COCO_VERSION:-latest}"
MIN_NODE_MAJOR=22

# ---- pretty output (no-ops when not a TTY or NO_COLOR is set) --------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD="$(printf '\033[1m')"; DIM="$(printf '\033[2m')"
  GREEN="$(printf '\033[32m')"; YELLOW="$(printf '\033[33m')"
  RED="$(printf '\033[31m')"; RESET="$(printf '\033[0m')"
else
  BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi

info()  { printf '%s\n' "${DIM}›${RESET} $*"; }
ok()    { printf '%s\n' "${GREEN}✓${RESET} $*"; }
warn()  { printf '%s\n' "${YELLOW}!${RESET} $*" >&2; }
fail()  { printf '%s\n' "${RED}✗${RESET} $*" >&2; exit 1; }

have()  { command -v "$1" >/dev/null 2>&1; }

printf '%s\n' "${BOLD}coco installer${RESET}"

# ---- Node check -----------------------------------------------------------
if ! have node; then
  warn "Node.js ${MIN_NODE_MAJOR}+ is required but was not found."
  cat >&2 <<EOF

Install Node first, then re-run this script:

  • macOS (Homebrew):   brew install node
  • nvm (any OS):        nvm install ${MIN_NODE_MAJOR} && nvm use ${MIN_NODE_MAJOR}
  • Or download it from: https://nodejs.org/

Prefer not to manage Node yourself? On macOS/Linux you can install coco
with Homebrew, which brings Node along as a dependency:

  brew install gfargo/tap/coco

EOF
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  fail "Node ${MIN_NODE_MAJOR}+ required; found $(node -v). Upgrade Node and re-run."
fi
ok "Node $(node -v) detected."

# ---- package manager ------------------------------------------------------
if have npm; then
  PM="npm"; INSTALL="npm install -g ${PKG}@${VERSION}"
elif have pnpm; then
  PM="pnpm"; INSTALL="pnpm add -g ${PKG}@${VERSION}"
elif have yarn; then
  PM="yarn"; INSTALL="yarn global add ${PKG}@${VERSION}"
else
  fail "No npm, pnpm, or yarn found. Install one (npm ships with Node) and re-run."
fi

info "Installing ${BOLD}${PKG}@${VERSION}${RESET} with ${PM}…"
if ! sh -c "$INSTALL"; then
  warn "Global install failed."
  cat >&2 <<EOF

This is usually a permissions issue with the global prefix. Options:

  • Use a Node version manager (nvm/fnm) so global installs need no sudo, or
  • Point npm at a user-writable prefix:
        npm config set prefix "\$HOME/.npm-global"
        export PATH="\$HOME/.npm-global/bin:\$PATH"
  • Then re-run this script.

EOF
  exit 1
fi

# ---- verify ---------------------------------------------------------------
if have coco; then
  ok "Installed: $(coco --version 2>/dev/null || echo "${PKG}@${VERSION}")"
  printf '\n'
  printf '%s\n' "${BOLD}Next:${RESET}"
  printf '  %s   %s\n' "coco init" "${DIM}# pick a provider, set preferences${RESET}"
  printf '  %s        %s\n' "coco" "${DIM}# opens the workstation in a git repo${RESET}"
  printf '  %s %s\n' "coco commit -i" "${DIM}# AI commit message from staged changes${RESET}"
  printf '\nDocs: %s\n' "https://coco.griffen.codes/docs"
else
  warn "Installed, but 'coco' is not on your PATH yet."
  warn "Open a new shell, or add your package manager's global bin to PATH."
fi
