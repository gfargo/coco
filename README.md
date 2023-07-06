# Commit Copilot (`coco`) 🤖 🦍

Commit Copilot, or `coco`, is an intelligent command-line tool designed to automate away the process of writing Git commit messages using the power of OpenAI's language model.

With `coco`, you can generate meaningful commit messages for your code changes effortlessly, allowing you to focus more on coding and less on commit documentation.

## Installation

```bash
npm i @gfargo/coco --save-dev
```

Or, if you prefer, you can instal globally:

```bash
npm i -g @gfargo/coco
```

After installing, both `commit-copilot` 🤖 *or* `coco` 🦍  commands will be available.  Going forward, we will use `coco` in our examples.

## Usage

Once installed, you can use `coco` in two ways:

1. [Interactive](#interactive)
1. [CLI](#cli)

### **Interactive**

Simply type `coco` and follow the prompts! ✨

```bash
coco -i
```

`coco` will analyze your staged changes and interactively guide you through the commit process.  One advantage using `coco` interactively provides is the ability to edit the generated commit message before performing the commit.

### **CLI**

Pass your commit message directly as a command line argument:

```bash
coco --openAIApiKey="sk_your-openai-api-key"
```

Assuming you have stored the API key in the config file ([see below](#the-cococonfig))...

```bash
git commit -m $(coco)
```

Simplify things even further by letting coco make the commit for you!

```bash
coco -s
```

## **The `coco.config`**

The `coco.config` settings allow you to specify project-level configuration. These settings can be defined in multiple ways and are sourced in a hierarchical order. If the same configuration setting is defined in multiple places, the setting from the higher priority source will be used.

The order of priority from highest to lowest is as follows:

1. **Command Line Flags**: Any configuration options set as flags in the command line will override all other sources.
2. **Environment Variables**: Environment variables are the next highest priority. You can set any of the configuration options as an environment variable in your system.
3. **Project Config (`.coco.config.json`)**: You can create a `.coco.config.json` file in your project root directory to set any of the configuration options. This file is optional, but it is recommended to store your OpenAI API key here as well as any other configuration settings you want to use for the project.
4. **Git Profile (`.gitconfig`)**: Configuration options can be set in your git profile under a `[coco]` section. These settings will be used if not overridden by any of the above.
5. **XDG Configuration Directory**: If the `XDG_CONFIG_HOME` environment variable is set, Coco will look for a `coco/config` file within this directory to use as configuration options.

Here's an example of how you might define settings in a `.coco.config.json` file:

```json
{
    "openAIApiKey": "sk_your-openai-api-key",
    "prompt": "What are the changes in this commit?",
}
```

And here's an example of the same settings defined in a `.gitconfig`:

```ini
[coco]
    openAIApiKey = sk_your-openai-api-key
    prompt = What are the changes in this commit?
```

Please note that command line flags and environment variables should be in `UPPER_SNAKE_CASE`. For example, the `openAIApiKey` setting would be `OPENAI_API_KEY` when used as a flag or environment variable.

### Options

| Name                     | Type                            | Default Value                             | Description                                                                                                               |
|--------------------------|---------------------------------|-------------------------------------------|---------------------------------------------------------------------------------------------------------------------------|
| openAIApiKey                   | string                          | None                                      | Your OpenAI API key                                                                                                       |
| tokenLimit               | number                          | 500                                       | Maximum number of tokens to generate for the commit message                                                               |
| prompt                   | string                          | `"What are the changes in this commit?"`  | Prompt for OpenAI GPT-3                                                                                                   |
| temperature              | number                          | 0.4                                       | Controls randomness of OpenAI's GPT-3 output. Lower values (e.g. 0.2) make the output focused, while higher make it diverse|
| mode                     | `stdout` \| `interactive`       | `stdout`                                  | Output method for generated commit message. message                                                                              |
| summarizePrompt   | string                          | `"Summarize the changes in this large file:"` | Prompt for OpenAI GPT-3 when summarizing large files                                         |
| ignoredFiles             | string[]                        | `["package-lock.json"]`                  | List of file paths to ignore when generating commit messages                                                             |
| ignoredExtensions        | string[]                        | `[".map", ".lock"]`                      | List of file extensions to ignore when generating commit messages                                                        |

## Contribution

As an open source project, we welcome contributions! Please check out our [CONTRIBUTING.md](CONTRIBUTING.md) for more information.
