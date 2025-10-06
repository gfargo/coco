![coco banner image](https://repository-images.githubusercontent.com/663130268/2fc2b7a1-2626-4f9a-9938-a5b410db1b0e)

# `coco`

[![NPM Version](https://img.shields.io/npm/v/git-coco.svg)](https://www.npmjs.com/package/git-coco)
[![Typescript Support](https://img.shields.io/npm/types/git-coco.svg)](https://www.npmjs.com/package/git-coco)
[![NPM Downloads](https://img.shields.io/npm/dt/git-coco.svg)](https://www.npmjs.com/package/git-coco)
[![GitHub issues](https://img.shields.io/github/issues/gfargo/coco)](https://github.com/gfargo/coco/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/gfargo/coco)](https://github.com/gfargo/coco/pulls)
[![Last Commit](https://img.shields.io/github/last-commit/gfargo/coco)](https://github.com/gfargo/coco/tree/main)
[![Discord](https://img.shields.io/discord/1176716060825767948)](https://discord.gg/KGu9nE9Ejx)

An AI-powered git assistant that generates meaningful commit messages, creates changelogs, and streamlines your development workflow.

**✨ Key Features:**

- 🤖 **AI-Powered Commit Messages** - Generate contextual commits from your staged changes
- 📋 **Conventional Commits** - Full support with automatic validation and formatting  
- 🔧 **Commitlint Integration** - Seamless integration with your existing commitlint configuration
- 🏠 **Local AI Support** - Run completely offline with Ollama (no API costs, full privacy)
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
```

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
