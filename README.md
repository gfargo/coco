![coco banner image](https://repository-images.githubusercontent.com/663130268/2fc2b7a1-2626-4f9a-9938-a5b410db1b0e)

# `coco`

[![NPM Version](https://img.shields.io/npm/v/git-coco.svg)](https://www.npmjs.com/package/git-coco)
[![Typescript Support](https://img.shields.io/npm/types/git-coco.svg)](https://www.npmjs.com/package/git-coco)
[![NPM Downloads](https://img.shields.io/npm/dt/git-coco.svg)](https://www.npmjs.com/package/git-coco)
[![GitHub issues](https://img.shields.io/github/issues/gfargo/coco)](https://github.com/gfargo/coco/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/gfargo/coco)](https://github.com/gfargo/coco/pulls)
[![Last Commit](https://img.shields.io/github/last-commit/gfargo/coco)](https://github.com/gfargo/coco/tree/main)
[![Discord](https://img.shields.io/discord/1176716060825767948)](https://discord.gg/KGu9nE9Ejx)

An AI-powered git assistant that generates meaningful commit messages, creates changelogs, explores repository history, and streamlines your development workflow.

**✨ Key Features:**

- 🤖 **AI-Powered Commit Messages** - Generate contextual commits from your staged changes
- 📋 **Conventional Commits** - Full support with automatic validation and formatting  
- 🔧 **Commitlint Integration** - Seamless integration with your existing commitlint configuration
- 🏠 **Local AI Support** - Run completely offline with Ollama (no API costs, full privacy)
- 🖥️ **Coco UI Git Workstation** - Eleven top-level views (history, status, diff, compose, branches, tags, stash, worktrees, pull-request, conflicts, reflog) reachable via `g`-prefixed chords, with an interactive command palette (`:`), global search (`/`), and cross-view flows like compare-two-refs
- 📦 **Package Manager Friendly** - Works with npm, yarn, and pnpm
- 👥 **Team Ready** - Shared configurations and enterprise deployment

## Quick Start

```bash
# Try without installing
npx git-coco@latest init

# Install globally  
npm install -g git-coco

# Setup and configure
coco init

# Generate your first commit
git add .
coco -i
```

## Commands

- **`coco commit`** - Generate commit messages from staged changes
- **`coco changelog`** - Create changelogs from commit history  
- **`coco recap`** - Summarize recent changes and activity
- **`coco review`** - AI-powered code review of your changes
- **`coco log`** - Explore commit history with graph, filters, JSON output, and commit details
- **`coco ui`** - Open the full-screen Git workstation TUI
- **`coco init`** - Interactive setup wizard

## Usage Examples

### Basic Workflow

```bash
# Make your changes
git add .

# Generate commit message (interactive mode recommended)
coco -i

# Or use stdout mode
git commit -m "$(coco)"
```

### Conventional Commits

```bash
# Enable conventional commits format
coco --conventional

# With additional context
coco -a "Fixes login timeout" --conventional

# Include ticket from branch name
coco --append-ticket --conventional
```

### Team Workflows

```bash
# Generate changelog for releases
coco changelog --since-last-tag

# Summarize recent work
coco recap --yesterday

# Code review before committing
coco review

# Explore commit history
coco ui
coco ui --view status
coco log --limit 20
coco log -i
coco log --view full --limit 20
coco log --all --limit 20
coco log --author "Grace Hopper" --path src
coco log --commit HEAD
coco log --format json
```

### Navigating the TUI

`coco ui` and `coco log -i` share a chord-driven navigation model. Press `g` and then a second key to jump anywhere; `<` (or `Esc`) pops the navigation stack back.

```text
g h   history          g c   compose         g x   conflicts
g s   status           g b   branches        g r   reflog
g d   diff             g t   tags            <     back
                       g z   stash           Esc   back / close modal
                       g w   worktrees       ?     help overlay
                       g p   pull request    :     command palette
```

The command palette (`:`) is an interactive launcher with fuzzy filter and recently-used at the top — every keybinding and workflow action is reachable from there. `/` searches the active view (history, branches, tags, stash, or reflog). On branches, tags, and history, press `m` to mark a ref as the compare base — then `Enter` on a second ref opens a `git diff <base>..<head>` view. See the [Coco UI](https://github.com/gfargo/coco/wiki/Coco-UI) and [TUI Navigation](https://github.com/gfargo/coco/wiki/TUI-Navigation) wiki pages for the full keymap.

## Configuration

Configure `coco` for your workflow with the interactive setup wizard:

```bash
# Setup wizard
coco init

# Project-specific setup
coco init --scope project
```

**AI Providers:**
- **OpenAI** - GPT-4o, GPT-4o-mini (API key required)
- **Anthropic** - Claude 3.5 Sonnet (API key required)  
- **Ollama** - Local models, no API costs, full privacy

**Example Configuration:**
```json
{
  "mode": "interactive",
  "conventionalCommits": true,
  "logTui": {
    "theme": {
      "preset": "catppuccin"
    }
  },
  "service": {
    "provider": "openai",
    "model": "gpt-4o"
  }
}
```

## Documentation

For comprehensive guides, advanced usage, and detailed configuration options, visit our complete documentation:

### 📚 **[Coco Wiki](https://github.com/gfargo/coco/wiki)**

**Essential Guides:**
- **[Getting Started](https://github.com/gfargo/coco/wiki/Getting-Started)** - Complete beginner's guide from installation to first commit
- **[Command Reference](https://github.com/gfargo/coco/wiki/Command-Reference)** - Detailed command options and examples
- **[Configuration Overview](https://github.com/gfargo/coco/wiki/Config-Overview)** - All configuration options and setup methods
- **[Coco UI](https://github.com/gfargo/coco/wiki/Coco-UI)** - GitKraken-style terminal workstation guide
- **[Interactive Log TUI](https://github.com/gfargo/coco/wiki/Interactive-Log-TUI)** - History-focused `coco log -i` guide
- **[Team Collaboration](https://github.com/gfargo/coco/wiki/Team-Collaboration)** - Enterprise deployment and team adoption strategies

**Advanced Resources:**
- **[Using Ollama](https://github.com/gfargo/coco/wiki/Using-Ollama)** - Local AI setup for privacy and cost control
- **[Advanced Usage](https://github.com/gfargo/coco/wiki/Advanced-Usage)** - Custom prompts, automation, and power-user features
- **[Troubleshooting](https://github.com/gfargo/coco/wiki/Troubleshooting)** - Solutions for common issues and debugging

### 🆘 **Need Help?**

- **[Troubleshooting Guide](https://github.com/gfargo/coco/wiki/Troubleshooting)** - Comprehensive problem-solving resource
- **[GitHub Issues](https://github.com/gfargo/coco/issues)** - Bug reports and feature requests
- **[Discord Community](https://discord.gg/KGu9nE9Ejx)** - Real-time help and discussion

## Contribution

We welcome contributions! Check out our [CONTRIBUTING.md](CONTRIBUTING.md) for more information.

## Project Stats

![Alt](https://repobeats.axiom.co/api/embed/ea76b881139f16595a343046d4f2bc9125a47e26.svg "Repobeats analytics image")

## License

MIT © [gfargo](https://github.com/gfargo/)

<div style="text-align:center; padding-top: 2rem;">
<img src="https://coco.griffen.codes/mascott/mascott_d.png" width="200px">
<p>Thanks for using <code>coco</code> ✨💜</p>
</div>
