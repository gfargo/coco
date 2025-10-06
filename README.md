![coco banner image](https://repository-images.githubusercontent.com/663130268/2fc2b7a1-2626-4f9a-9938-a5b410db1b0e)

# `coco`

[![NPM Version](https://img.shields.io/npm/v/git-coco.svg)](https://www.npmjs.com/package/git-coco)
[![Typescript Support](https://img.shields.io/npm/types/git-coco.svg)](https://www.npmjs.com/package/git-coco)
[![NPM Downloads](https://img.shields.io/npm/dt/git-coco.svg)](https://www.npmjs.com/package/git-coco)
[![GitHub issues](https://img.shields.io/github/issues/gfargo/coco)](https://github.com/gfargo/coco/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/gfargo/coco)](https://github.com/gfargo/coco/pulls)
[![Last Commit](https://img.shields.io/github/last-commit/gfargo/coco)](https://github.com/gfargo/coco/tree/main)
[![Discord](https://img.shields.io/discord/1176716060825767948)](https://discord.gg/KGu9nE9Ejx)

Spawned by the dream to automate away the tedium of writing commit messages, `coco` has grown into a multi-facetted git assistant to expedite any developer git workflow.

Currently `coco` generates commit messages with **first-class Conventional Commits support**, creates changelogs, summarizes code changes, performs code reviews, and more - with new features being added regularly!

**✨ Key Features:**

- 🤖 **AI-Powered Commit Messages** - Generate contextual commits from your staged changes
- 📋 **Conventional Commits** - Full support with automatic validation and formatting
- 🔧 **Commitlint Integration** - Seamless integration with your existing commitlint configuration
- 📦 **Package Manager Friendly** - Works with npm, yarn, and pnpm (with automatic compatibility handling)
- 🛠️ **Robust Error Recovery** - Advanced JSON parsing with automatic repair capabilities
- 🏠 **Local AI Support** - Run completely offline with Ollama (no API costs, full privacy)

## Commands

- **`commit`**: generates commit messages based on staged changes with intelligent conventional commits support and robust error handling.

- **`changelog`**: create changelogs for the current branch or a range of commits.

- **`recap`**: summarize changes from working-tree, or yesterday, or in the last month, or since the last tag.

- **`review`**: perform a code review on the changes in the working directory.

- **`init`**: step by step wizard to set up `coco` globally or for a project.

- **`help`**: display help for `coco` commands.

## Getting Started

**`coco init`** is the first step to getting started with `coco`. It will guide you through the installation process, including setting up your OpenAI API key and configuring `coco` to your preferences.

```bash
# For local project use
npx git-coco@latest init -l project

# For global use
npx git-coco@latest init -l global
```

## Usage

### **`coco commit`**

Generates commit messages based on staged changes with intelligent commitlint integration.

```bash
coco

# or 

coco commit
```

#### Conventional Commits & Commitlint Integration

`coco` provides first-class support for Conventional Commits with intelligent commitlint integration:

**Conventional Commits Support:**

- **Automatic Detection**: Enables conventional commits mode when commitlint config is detected
- **Smart Formatting**: Generates properly formatted conventional commits (feat, fix, docs, etc.)
- **Breaking Changes**: Supports breaking change syntax (`feat!:` and `feat(scope)!:`)
- **Scoped Commits**: Intelligent scope detection and formatting
- **Robust Parsing**: Advanced JSON parsing with automatic error recovery

**Commitlint Integration:**

- **Smart Detection**: Automatically finds commitlint config files (`.commitlintrc.*`, `commitlint.config.*`, or `package.json` with commitlint field)
- **AI-Aware Rules**: Passes your commitlint rules to the AI for better compliance from the start
- **Automatic Retry**: When validation fails, `coco` automatically retries generation with error feedback (up to 2 attempts)
- **Package Manager Compatibility**: Works seamlessly with npm, yarn, and pnpm (with automatic fallback for ES module issues)
- **User-Friendly Flow**: After auto-retries, offers options to try 2 more times or edit manually
- **Full Validation**: Both AI-generated and manually edited commit messages are validated against your rules

#### Command Options

**Basic Options:**

```bash
# Interactive mode - opens editor for review and editing
coco -i, --interactive

# Verbose output - shows detailed processing information
coco --verbose

# Help - display command help
coco --help
```

**Commit Enhancement Options:**

```bash
# Add content to the end of the generated commit message
coco --append "Resolves #128"

# Automatically append Jira/Linear ticket ID from branch name
coco -t, --append-ticket

# Add extra context to guide commit generation
coco -a, --additional "Resolves UX bug with sign up button"

# Include previous commits for context (specify number)
coco -p, --with-previous-commits 3
```

**Conventional Commits Options:**

```bash
# Force conventional commits mode
coco -c, --conventional

# Include/exclude branch name in context (default: true)
coco --include-branch-name
coco --no-include-branch-name
```

**Processing Options:**

```bash
# Ignore specific files (can be used multiple times)
coco --ignored-files "*.lock" --ignored-files "dist/*"

# Ignore file extensions (can be used multiple times)  
coco --ignored-extensions ".map" --ignored-extensions ".min.js"

# Use basic git status instead of full diff (faster for large changes)
coco --no-diff

# Open commit message in editor before proceeding
coco --open-in-editor
```

### **`coco changelog`**

Creates changelogs from commit history.

```bash
# Basic changelog for current branch
coco changelog

# Interactive mode
coco changelog -i, --interactive
```

#### Changelog Options

**Range Selection:**

```bash
# Specific commit range (HEAD references)
coco changelog -r HEAD~5:HEAD

# Specific commit range (commit hashes)  
coco changelog -r abc1234:def5678

# Compare against target branch
coco changelog -b main, --branch main

# All commits since last tag
coco changelog -t, --since-last-tag
```

**Content Options:**

```bash
# Include diff for each commit in analysis
coco changelog --with-diff

# Generate changelog based only on branch diff
coco changelog --only-diff

# Include author attribution
coco changelog --author

# Add extra context to guide generation
coco changelog -a "Focus on user-facing changes" --additional "Focus on user-facing changes"
```

### **`coco recap`**

Summarize changes across different time periods.

```bash
# Summarize current working directory changes
coco recap

# Interactive mode
coco recap -i, --interactive
```

#### Recap Time Periods

```bash
# Yesterday's changes
coco recap --yesterday

# Last week's changes  
coco recap --last-week, --week

# Last month's changes
coco recap --last-month, --month

# Changes since last git tag
coco recap --last-tag, --tag

# Current branch changes
coco recap --current-branch
```

### **`coco review`**

Perform AI-powered code review on your changes.

```bash
# Review current working directory changes
coco review

# Interactive mode
coco review -i, --interactive

# Review specific branch
coco review -b feature-branch, --branch feature-branch
```

### **`coco init`**

Interactive setup wizard for configuring coco.

```bash
# Setup wizard (will prompt for scope)
coco init

# Configure for current project only
coco init --scope project

# Configure globally for current user
coco init --scope global
```

### Stdout vs. Interactive Mode

`coco` offers two modes of operation: **stdout** and **interactive**, defaulting to **stdout**. You can specify your preferred mode in your config file or via command line flags.

```bash
# Stdout mode
git commit -m $(coco)

# Interactive mode
coco -i
```

### Generate and commit all in one

`coco` can generate and commit your changes in one command.

```bash
coco -s
```

### **Conventional Commits Examples**

`coco` excels at generating properly formatted conventional commits:

```bash
# Basic conventional commit
coco --conventional
# Output: feat: add user authentication system

# With scope
coco --conventional -a 'fixes login timeout'
# Output: fix(auth): resolve login timeout issue

# With additional context and ticket
coco --conventional --additional "Resolves login issues" --append-ticket
# Output: feat(auth): add OAuth2 integration
#         
#         Implement OAuth2 flow with Google and GitHub providers.
#         Resolves login issues
#         
#         Part of **PROJ-123**
```

## Configuration

`coco` offers flexible configuration through multiple methods with a clear priority system. See the complete [Configuration Overview](CONFIG_OVERVIEW.md) for detailed setup instructions, all available options, and examples.

**Quick Start:**

```bash
# Interactive setup wizard
coco init

# Project-specific configuration
coco init --scope project

# Global user configuration  
coco init --scope global
```

**Configuration Methods (in priority order):**

1. Command line flags (highest priority)
2. Environment variables
3. Project config (`.coco.config.json`)
4. Git config (`.gitconfig`)
5. XDG config directory (lowest priority)

**AI Providers:**

- **OpenAI**: GPT-4o, GPT-4o-mini, GPT-4 Turbo (API key required)
- **Anthropic**: Claude 3.5 Sonnet, Claude 3 Haiku (API key required)  
- **Ollama**: Local models, no API costs, full privacy - [Setup Guide](USING_OLLAMA.md)

### **Ignoring Files & Extensions**

`coco` can ignore specific files and extensions to focus on meaningful changes. See the complete [Ignoring Files & Extensions Guide](IGNORING_FILES_EXTENSIONS.md) for detailed configuration options and examples.

**Quick Examples:**

```bash
# Command line flags
coco --ignored-files "*.lock" --ignored-extensions ".map"

# Config file
{
  "ignoredFiles": ["package-lock.json", "dist/*"],
  "ignoredExtensions": [".map", ".min.js"]
}
```

**Default Ignores:**

- Files: `package-lock.json` + contents of `.gitignore`
- Extensions: `.map`, `.lock`

## Troubleshooting

### **pnpm Compatibility**

If you encounter ES module errors with pnpm and commitlint:

```bash
# Update commitlint packages to latest versions
pnpm add -D @commitlint/config-conventional@latest @commitlint/cli@latest

# Or continue without commitlint validation
# coco will automatically fall back to built-in conventional commit rules
```

### **Conventional Commits Issues**

- **JSON Parsing Errors**: `coco` automatically repairs common JSON formatting issues from AI responses
- **Commitlint Validation**: If validation fails, `coco` provides clear error messages and retry options
- **Missing Dependencies**: `coco` gracefully handles missing commitlint packages with helpful installation guidance

## Documentation

For comprehensive guides, advanced usage, and detailed configuration options, visit our complete documentation:

### 📚 **[Coco Wiki](https://github.com/gfargo/coco/wiki)**

**Essential Guides:**

- **[Getting Started](https://github.com/gfargo/coco/wiki/Getting-Started)** - Complete beginner's guide from installation to first commit
- **[Configuration Overview](https://github.com/gfargo/coco/wiki/Config-Overview)** - All configuration options and setup methods
- **[Team Collaboration](https://github.com/gfargo/coco/wiki/Team-Collaboration)** - Enterprise deployment and team adoption strategies
- **[Using Ollama](https://github.com/gfargo/coco/wiki/Using-Ollama)** - Local AI setup for privacy and cost control

**Advanced Resources:**

- **[Advanced Usage](https://github.com/gfargo/coco/wiki/Advanced-Usage)** - Custom prompts, automation, and power-user features
- **[Troubleshooting](https://github.com/gfargo/coco/wiki/Troubleshooting)** - Solutions for common issues and debugging
- **[Ignoring Files & Extensions](https://github.com/gfargo/coco/wiki/Ignoring-Files-&-Extensions)** - Advanced file filtering and pattern matching

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
