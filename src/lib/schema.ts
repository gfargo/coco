// This file is auto-generated - DO NOT EDIT
/* eslint-disable */

/**
 * Schema ID for JSON validation
 */
export const SCHEMA_PUBLIC_URL = "https://coco.griffen.codes/schema.json"

/**
 * Generated JSON schema
 */
export const schema = {
  "$id": "https://coco.griffen.codes/schema.json",
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$ref": "#/definitions/ConfigWithServiceObject",
  "definitions": {
    "ConfigWithServiceObject": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "service": {
          "$ref": "#/definitions/LLMService"
        },
        "interactive": {
          "type": "boolean"
        },
        "verbose": {
          "type": "boolean",
          "description": "Enable verbose logging.",
          "default": false
        },
        "version": {
          "type": "boolean"
        },
        "help": {
          "type": "boolean"
        },
        "repo": {
          "type": "string",
          "description": "Repository directory to operate against. When set, the command chdir's to this path before loading config / opening a git instance, so every downstream read (config lookup, simple-git baseDir, commitlint discovery, etc.) sees the same root.\n\n`--cwd` is an alias.\n\nInherited by every coco subcommand so scripts / editor wrappers / scenario tests can target arbitrary repos without `cd`-ing first. Defaults to `process.cwd()` when omitted (unchanged behavior for users who launch via the regular `cd && coco ...` path)."
        },
        "mode": {
          "type": "string",
          "enum": [
            "stdout",
            "interactive"
          ],
          "description": "The output destination for the generated result.\n- 'stdout': Prints the result to the standard output.  This is the default behavior.\n- 'interactive': Provides an interactive prompt for editing the result & committing the changes.",
          "default": "stdout"
        },
        "conventionalCommits": {
          "type": "boolean",
          "description": "Whether to generate commit messages in Conventional Commits format. When enabled, commit messages will follow the Conventional Commits specification.",
          "default": false
        },
        "openInEditor": {
          "type": "boolean",
          "description": "Open the commit message in an editor for editing before proceeding.",
          "default": false
        },
        "prompt": {
          "type": "string",
          "description": "The prompt text used for generating results."
        },
        "summarizePrompt": {
          "type": "string",
          "description": "The prompt text used specifically for generating summaries of large files."
        },
        "ignoredFiles": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "An array of file paths or patterns to be ignored during processing.\n\nNote: This is a list of patterns interpreted by the `minimatch` library.",
          "examples": [
            [
              "package-lock.json",
              "node_modules"
            ]
          ],
          "default": "['package-lock.json', contents of .gitignore, contents of .ignore]"
        },
        "ignoredExtensions": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "An array of file extensions to be ignored during processing.",
          "default": [
            ".map",
            ".lock"
          ]
        },
        "defaultBranch": {
          "type": "string",
          "description": "Default git branch for the repository.",
          "default": "main"
        },
        "includeBranchName": {
          "type": "boolean",
          "description": "Whether to include the current branch name in the commit prompt for context. When enabled, the current git branch name will be included in the prompt.",
          "default": true
        },
        "autoFixTool": {
          "type": "string",
          "description": "The AI CLI tool to use for auto-fixing review issues. Must match a registered adapter key (e.g. \"codex\", \"claude\", \"gemini\"). When unset, the auto-fix action is disabled."
        },
        "autoFixToolOptions": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          },
          "description": "Additional key-value flags passed to the auto-fix CLI tool. Keys are flag names (without leading dashes); values are flag values.",
          "examples": [
            {
              "model": "o4-mini",
              "approval-mode": "auto-edit"
            }
          ]
        },
        "logTui": {
          "type": "object",
          "properties": {
            "theme": {
              "$ref": "#/definitions/LogInkThemeConfig",
              "description": "Theme settings for `coco log -i`."
            },
            "idleTips": {
              "type": "boolean",
              "description": "Rotate short usage tips through the status line when the TUI has been idle for >10s. Off by default so power users aren't distracted."
            },
            "dateBucketing": {
              "type": "boolean",
              "description": "Group adjacent commits in the history surface under shared section headers (`── Today ──`, `── Yesterday ──`, `── April 2026 ──`) and drop the per-row date column in favor of the headers. On by default because the bucketed view gives stronger temporal orientation at a glance and the freed cells go to the commit subject. Flip off if you prefer a date column on every row.\n\nBucketing automatically suppresses itself while a search filter is active (results aren't chronological), regardless of this setting.",
              "default": true
            },
            "syntaxHighlight": {
              "type": "boolean",
              "description": "Syntax-highlight code in the diff view using tree-sitter (TypeScript / TSX / JavaScript today). On by default. Highlighting degrades gracefully — unsupported languages, non-ASCII lines, and parse failures fall back to the plain add/remove coloring — so the only reason to disable it is preference or a very low-color terminal. Set to `false` to opt out.",
              "default": true
            }
          },
          "additionalProperties": false,
          "description": "Interactive log TUI settings."
        },
        "workspace": {
          "type": "object",
          "properties": {
            "roots": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "Directories to scan for git repositories. Each entry may use a `~` prefix; resolved against the user's home directory. When omitted (and no `--root` flag is passed), the workspace scans the current working directory — so a bare `coco` / `coco ws` discovers repos wherever you launched it. Set this to pin a fixed tree (e.g. `[\"~/code\"]`) regardless of where you run from.\n\n(No static `@default` — the effective default is the runtime cwd.)"
            },
            "knownRepos": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "Repositories outside the configured roots that should still appear in the workspace view. Useful for one-off projects kept somewhere other than the main `code` tree. Entries may use a `~` prefix.",
              "default": []
            },
            "maxDepth": {
              "type": "number",
              "description": "Maximum depth to recurse into each configured root when looking for `.git/` directories. Stops descending as soon as a directory is identified as a repo.",
              "default": 3
            }
          },
          "additionalProperties": false,
          "description": "Multi-repo workspace surface settings (`coco workspace`)."
        }
      },
      "required": [
        "defaultBranch",
        "mode",
        "service"
      ]
    },
    "LLMService": {
      "anyOf": [
        {
          "$ref": "#/definitions/OpenAILLMService"
        },
        {
          "$ref": "#/definitions/OllamaLLMService"
        },
        {
          "$ref": "#/definitions/AnthropicLLMService"
        },
        {
          "$ref": "#/definitions/GeminiLLMService"
        },
        {
          "$ref": "#/definitions/MistralLLMService"
        },
        {
          "$ref": "#/definitions/AzureLLMService"
        },
        {
          "$ref": "#/definitions/BedrockLLMService"
        }
      ]
    },
    "OpenAILLMService": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "provider": {
          "$ref": "#/definitions/LLMProvider"
        },
        "model": {
          "$ref": "#/definitions/ConfiguredLLMModel"
        },
        "baseURL": {
          "type": "string",
          "description": "Custom base URL for OpenAI-compatible APIs (e.g., OpenRouter, Azure OpenAI). If not specified, uses the default OpenAI API endpoint.",
          "examples": [
            "https://openrouter.ai/api/v1",
            "https://your-resource.openai.azure.com"
          ]
        },
        "fields": {
          "type": "object",
          "additionalProperties": {},
          "description": "Provider-specific extra options forwarded to the underlying LangChain client. Decoupled from upstream input types so schema generation stays stable across langchain releases."
        },
        "tokenLimit": {
          "type": "number",
          "description": "The maximum number of tokens per request.",
          "default": 2048
        },
        "temperature": {
          "type": "number",
          "description": "The temperature value controls the randomness of the generated output. Higher values (e.g., 0.8) make the output more random, while lower values (e.g., 0.2) make it more deterministic.",
          "default": 0.4
        },
        "maxConcurrent": {
          "type": "number",
          "description": "The maximum number of requests to make concurrently.",
          "default": 6
        },
        "minTokensForSummary": {
          "type": "number",
          "description": "Minimum token count for a directory/file group to be eligible for summarization. Groups below this threshold preserve raw diffs to maintain detail.",
          "default": 400
        },
        "maxFileTokens": {
          "type": "number",
          "description": "Maximum tokens allowed for a single file diff before it gets pre-summarized. Prevents large files from biasing the overall summary. If not set, defaults to 25% of tokenLimit.",
          "default": "undefined (uses 0.25 * tokenLimit)"
        },
        "authentication": {
          "anyOf": [
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "None"
                },
                "credentials": {
                  "not": {}
                }
              },
              "required": [
                "type"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "OAuth"
                },
                "credentials": {
                  "type": "object",
                  "properties": {
                    "clientId": {
                      "type": "string"
                    },
                    "clientSecret": {
                      "type": "string"
                    },
                    "token": {
                      "type": "string"
                    }
                  },
                  "additionalProperties": false
                }
              },
              "required": [
                "type",
                "credentials"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "APIKey"
                },
                "credentials": {
                  "type": "object",
                  "properties": {
                    "apiKey": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "apiKey"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "type",
                "credentials"
              ],
              "additionalProperties": false
            }
          ]
        },
        "requestOptions": {
          "type": "object",
          "properties": {
            "timeout": {
              "type": "number"
            },
            "maxRetries": {
              "type": "number"
            }
          },
          "additionalProperties": false
        },
        "maxParsingAttempts": {
          "type": "number",
          "description": "The maximum number of attempts for schema parsing with retry logic.",
          "default": 3
        },
        "dynamicModels": {
          "$ref": "#/definitions/DynamicModelProfile",
          "description": "Optional task-to-model overrides used when model is set to \"dynamic\"."
        },
        "dynamicModelPreference": {
          "$ref": "#/definitions/DynamicModelPreference",
          "description": "Default dynamic routing preference when model is set to \"dynamic\".",
          "default": "balanced"
        },
        "streaming": {
          "type": "object",
          "properties": {
            "enabled": {
              "type": "boolean",
              "description": "Master switch. When `false` (default) every LLM call uses the existing non-streaming code path, regardless of which command or surface fires it.",
              "default": false
            }
          },
          "additionalProperties": false,
          "description": "Streaming output (#881). Wires `chain.stream()` instead of `chain.invoke()` into LLM-driven TUI surfaces so the user sees a live preview of the model's output as it generates, rather than staring at a spinner until the full response arrives.\n\nOutput contract is unchanged when enabled: the final draft / plan still goes through the same parser, schema validator, and retry logic as the non-streaming path. The stream is a *preview only* — it relieves the \"is this hanging?\" anxiety without touching what gets committed.\n\nOff by default while we shake the UX out across providers; some models stream poorly (one-shot blob disguised as a stream) and the preview just blinks in those cases. Off-by-default also lets users who prefer the quieter spinner-only UX skip the visual chatter.\n\nScope today: workstation compose surface's AI commit draft (the `I` keystroke). Other TUI LLM calls (split-plan, PR body) stay non-streaming pending separate validation."
        },
        "fastPath": {
          "type": "object",
          "properties": {
            "markdown": {
              "type": "boolean",
              "description": "Replace the LLM summary with a templated heading extract for `.md` / `.mdx` / `.markdown` modification diffs that have clear heading-level structural changes. Diffs without structural signals (paragraph-only edits) still go to the LLM regardless of this flag.\n\nBench impact (synthetic): collapses docs-update-shaped commits from ~24s cold to ~3ms (no LLM calls fire for the markdown files). Real-world wall-clock savings depend on per-call LLM latency.",
              "default": false
            },
            "languageAware": {
              "type": "object",
              "properties": {
                "enabled": {
                  "type": "boolean",
                  "description": "Master switch. When false (default) the languageAware path is skipped entirely regardless of `languages`.",
                  "default": false
                },
                "languages": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "enum": [
                      "ts",
                      "js",
                      "py",
                      "rs",
                      "go"
                    ]
                  },
                  "description": "Languages to opt in. Omit / empty to enable all supported languages."
                }
              },
              "additionalProperties": false,
              "description": "Language-aware structural fast path (#883). Replace the LLM summary with a symbol-level extract (\"added parseRequest(); removed legacyParse()\") for source files in the listed languages. Off by default; quality is harder to validate than the markdown fast path so we don't enable it without opt-in.\n\nDiffs without top-level structural signals (paragraph-only body edits, formatting changes) still go to the LLM regardless of this flag.\n\nCurrently supports:   - 'ts' : `.ts` / `.tsx` / `.mts` / `.cts`   - 'js' : `.js` / `.jsx` / `.mjs` / `.cjs`   - 'py' : `.py` / `.pyi`   - 'rs' : `.rs`   - 'go' : `.go`"
            }
          },
          "additionalProperties": false,
          "description": "Opt-in fast paths that trade summary detail for speed. Each flag here replaces an LLM summary call with a deterministic templated extract for a specific file shape. Off by default — when enabled, you accept that final commit messages on those file shapes may be blander than LLM-generated summaries (the templated extract names structural changes only).\n\nLossless optimizations (cache, trivial-shape skip on pure additions / deletions / renames / binary, sort discipline) ship default-on and are not configured here."
        }
      },
      "required": [
        "authentication",
        "model",
        "provider"
      ]
    },
    "LLMProvider": {
      "type": "string",
      "enum": [
        "openai",
        "ollama",
        "anthropic",
        "gemini",
        "mistral",
        "azure",
        "bedrock"
      ]
    },
    "ConfiguredLLMModel": {
      "anyOf": [
        {
          "$ref": "#/definitions/LLMModel"
        },
        {
          "type": "string",
          "const": "dynamic"
        }
      ]
    },
    "LLMModel": {
      "anyOf": [
        {
          "$ref": "#/definitions/OpenAIModel"
        },
        {
          "$ref": "#/definitions/OllamaModel"
        },
        {
          "$ref": "#/definitions/AnthropicModel"
        },
        {
          "$ref": "#/definitions/GeminiModel"
        },
        {
          "$ref": "#/definitions/MistralModel"
        },
        {
          "$ref": "#/definitions/BedrockModel"
        }
      ]
    },
    "OpenAIModel": {
      "type": "string",
      "enum": [
        "davinci-002",
        "babbage-002",
        "text-davinci-003",
        "text-davinci-002",
        "text-davinci-001",
        "text-curie-001",
        "text-babbage-001",
        "text-ada-001",
        "davinci",
        "curie",
        "babbage",
        "ada",
        "code-davinci-002",
        "code-davinci-001",
        "code-cushman-002",
        "code-cushman-001",
        "davinci-codex",
        "cushman-codex",
        "text-davinci-edit-001",
        "code-davinci-edit-001",
        "text-embedding-ada-002",
        "text-embedding-3-small",
        "text-embedding-3-large",
        "text-similarity-davinci-001",
        "text-similarity-curie-001",
        "text-similarity-babbage-001",
        "text-similarity-ada-001",
        "text-search-davinci-doc-001",
        "text-search-curie-doc-001",
        "text-search-babbage-doc-001",
        "text-search-ada-doc-001",
        "code-search-babbage-code-001",
        "code-search-ada-code-001",
        "gpt2",
        "gpt-3.5-turbo",
        "gpt-35-turbo",
        "gpt-3.5-turbo-0301",
        "gpt-3.5-turbo-0613",
        "gpt-3.5-turbo-1106",
        "gpt-3.5-turbo-0125",
        "gpt-3.5-turbo-16k",
        "gpt-3.5-turbo-16k-0613",
        "gpt-3.5-turbo-instruct",
        "gpt-3.5-turbo-instruct-0914",
        "gpt-4",
        "gpt-4-0314",
        "gpt-4-0613",
        "gpt-4-32k",
        "gpt-4-32k-0314",
        "gpt-4-32k-0613",
        "gpt-4-turbo",
        "gpt-4-turbo-2024-04-09",
        "gpt-4-turbo-preview",
        "gpt-4-1106-preview",
        "gpt-4-0125-preview",
        "gpt-4-vision-preview",
        "gpt-4o",
        "gpt-4o-2024-05-13",
        "gpt-4o-2024-08-06",
        "gpt-4o-2024-11-20",
        "gpt-4o-mini-2024-07-18",
        "gpt-4o-mini",
        "gpt-4o-search-preview",
        "gpt-4o-search-preview-2025-03-11",
        "gpt-4o-mini-search-preview",
        "gpt-4o-mini-search-preview-2025-03-11",
        "gpt-4o-audio-preview",
        "gpt-4o-audio-preview-2024-12-17",
        "gpt-4o-audio-preview-2024-10-01",
        "gpt-4o-mini-audio-preview",
        "gpt-4o-mini-audio-preview-2024-12-17",
        "o1",
        "o1-2024-12-17",
        "o1-mini",
        "o1-mini-2024-09-12",
        "o1-preview",
        "o1-preview-2024-09-12",
        "o1-pro",
        "o1-pro-2025-03-19",
        "o3",
        "o3-2025-04-16",
        "o3-mini",
        "o3-mini-2025-01-31",
        "o4-mini",
        "o4-mini-2025-04-16",
        "chatgpt-4o-latest",
        "gpt-4o-realtime",
        "gpt-4o-realtime-preview-2024-10-01",
        "gpt-4o-realtime-preview-2024-12-17",
        "gpt-4o-mini-realtime-preview",
        "gpt-4o-mini-realtime-preview-2024-12-17",
        "gpt-4.1",
        "gpt-4.1-2025-04-14",
        "gpt-4.1-mini",
        "gpt-4.1-mini-2025-04-14",
        "gpt-4.1-nano",
        "gpt-4.1-nano-2025-04-14",
        "gpt-4.5-preview",
        "gpt-4.5-preview-2025-02-27",
        "gpt-5",
        "gpt-5-2025-08-07",
        "gpt-5-nano",
        "gpt-5-nano-2025-08-07",
        "gpt-5-mini",
        "gpt-5-mini-2025-08-07",
        "gpt-5-chat-latest"
      ]
    },
    "OllamaModel": {
      "type": "string",
      "enum": [
        "deepseek-r1:1.5b",
        "deepseek-r1:8b",
        "deepseek-r1:32b",
        "codegemma:2b",
        "codegemma:7b-code",
        "codegemma",
        "codellama:13b",
        "codellama:34b",
        "codellama:70b",
        "codellama:7b",
        "codellama:instruct",
        "codellama:latest",
        "codellama",
        "gemma:2b",
        "gemma:7b",
        "gemma:latest",
        "gemma",
        "llama2:13b",
        "llama2:70b",
        "llama2:chat",
        "llama2:latest",
        "llama2:text",
        "llama2",
        "llama3:70b-text",
        "llama3:70b",
        "llama3:latest",
        "llama3:text",
        "llama3.1:70b",
        "llama3.1:8b",
        "llama3.1:latest",
        "llama3.2",
        "llama3.2:latest",
        "llama3.2:1b",
        "llama3.2:3b",
        "llama3",
        "llava-llama3:latest",
        "dolphin-llama3:latest",
        "dolphin-llama3:8b",
        "dolphin-llama3:70b",
        "mistral:7b",
        "mistral:latest",
        "mistral:text",
        "mistral",
        "phi3:14b",
        "phi3:3.8b",
        "phi3:instruct",
        "phi3:medium-128k",
        "phi3:medium-4k",
        "phi3:medium",
        "phi3",
        "qwen2:0.5b",
        "qwen2:1.5b",
        "qwen2:72b-text",
        "qwen2:72b",
        "qwen2",
        "qwen2.5-coder:latest",
        "qwen2.5-coder:0.5b",
        "qwen2.5-coder:1.5b",
        "qwen2.5-coder:3b",
        "qwen2.5-coder:7b",
        "qwen2.5-coder:14b",
        "qwen2.5-coder:32b"
      ]
    },
    "AnthropicModel": {
      "type": "string",
      "enum": [
        "claude-sonnet-4-6",
        "claude-haiku-4-5-20251001",
        "claude-haiku-4-5",
        "claude-opus-4-7",
        "claude-sonnet-4-0",
        "claude-3-7-sonnet-latest",
        "claude-3-5-haiku-latest",
        "claude-3-5-sonnet-latest",
        "claude-3-5-sonnet-20241022",
        "claude-3-5-sonnet-20240620",
        "claude-3-opus-20240229",
        "claude-3-sonnet-20240229",
        "claude-3-haiku-20240307"
      ]
    },
    "GeminiModel": {
      "type": "string",
      "enum": [
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-1.5-pro",
        "gemini-1.5-flash",
        "gemini-1.5-flash-8b"
      ]
    },
    "MistralModel": {
      "type": "string",
      "enum": [
        "mistral-large-latest",
        "mistral-medium-latest",
        "mistral-small-latest",
        "codestral-latest",
        "ministral-8b-latest",
        "ministral-3b-latest",
        "open-mistral-nemo"
      ]
    },
    "BedrockModel": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "string",
          "enum": [
            "anthropic.claude-3-5-sonnet-20241022-v2:0",
            "anthropic.claude-3-5-haiku-20241022-v1:0",
            "anthropic.claude-sonnet-4-20250514-v1:0",
            "anthropic.claude-3-haiku-20240307-v1:0",
            "meta.llama3-1-70b-instruct-v1:0",
            "mistral.mistral-large-2407-v1:0"
          ]
        }
      ],
      "description": "AWS Bedrock model ids are free-form (model id strings and inference-profile ARNs). The `(string & {})` member keeps the literal suggestions while still accepting any AWS id. It must NOT collapse `LLMModel` to bare `string` — `(string & {})` preserves the literal union members of the other providers."
    },
    "DynamicModelProfile": {
      "type": "object",
      "properties": {
        "summarize": {
          "$ref": "#/definitions/LLMModel"
        },
        "commit": {
          "$ref": "#/definitions/LLMModel"
        },
        "commitSplit": {
          "$ref": "#/definitions/LLMModel"
        },
        "changelog": {
          "$ref": "#/definitions/LLMModel"
        },
        "review": {
          "$ref": "#/definitions/LLMModel"
        },
        "recap": {
          "$ref": "#/definitions/LLMModel"
        },
        "repair": {
          "$ref": "#/definitions/LLMModel"
        },
        "largeDiff": {
          "$ref": "#/definitions/LLMModel"
        }
      },
      "additionalProperties": false
    },
    "DynamicModelPreference": {
      "type": "string",
      "enum": [
        "cost",
        "balanced",
        "quality"
      ]
    },
    "OllamaLLMService": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "provider": {
          "$ref": "#/definitions/LLMProvider"
        },
        "model": {
          "$ref": "#/definitions/ConfiguredLLMModel"
        },
        "endpoint": {
          "type": "string"
        },
        "fields": {
          "type": "object",
          "additionalProperties": {}
        },
        "tokenLimit": {
          "type": "number",
          "description": "The maximum number of tokens per request.",
          "default": 2048
        },
        "temperature": {
          "type": "number",
          "description": "The temperature value controls the randomness of the generated output. Higher values (e.g., 0.8) make the output more random, while lower values (e.g., 0.2) make it more deterministic.",
          "default": 0.4
        },
        "maxConcurrent": {
          "type": "number",
          "description": "The maximum number of requests to make concurrently.",
          "default": 6
        },
        "minTokensForSummary": {
          "type": "number",
          "description": "Minimum token count for a directory/file group to be eligible for summarization. Groups below this threshold preserve raw diffs to maintain detail.",
          "default": 400
        },
        "maxFileTokens": {
          "type": "number",
          "description": "Maximum tokens allowed for a single file diff before it gets pre-summarized. Prevents large files from biasing the overall summary. If not set, defaults to 25% of tokenLimit.",
          "default": "undefined (uses 0.25 * tokenLimit)"
        },
        "authentication": {
          "anyOf": [
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "None"
                },
                "credentials": {
                  "not": {}
                }
              },
              "required": [
                "type"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "OAuth"
                },
                "credentials": {
                  "type": "object",
                  "properties": {
                    "clientId": {
                      "type": "string"
                    },
                    "clientSecret": {
                      "type": "string"
                    },
                    "token": {
                      "type": "string"
                    }
                  },
                  "additionalProperties": false
                }
              },
              "required": [
                "type",
                "credentials"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "APIKey"
                },
                "credentials": {
                  "type": "object",
                  "properties": {
                    "apiKey": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "apiKey"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "type",
                "credentials"
              ],
              "additionalProperties": false
            }
          ]
        },
        "requestOptions": {
          "type": "object",
          "properties": {
            "timeout": {
              "type": "number"
            },
            "maxRetries": {
              "type": "number"
            }
          },
          "additionalProperties": false
        },
        "maxParsingAttempts": {
          "type": "number",
          "description": "The maximum number of attempts for schema parsing with retry logic.",
          "default": 3
        },
        "dynamicModels": {
          "$ref": "#/definitions/DynamicModelProfile",
          "description": "Optional task-to-model overrides used when model is set to \"dynamic\"."
        },
        "dynamicModelPreference": {
          "$ref": "#/definitions/DynamicModelPreference",
          "description": "Default dynamic routing preference when model is set to \"dynamic\".",
          "default": "balanced"
        },
        "streaming": {
          "type": "object",
          "properties": {
            "enabled": {
              "type": "boolean",
              "description": "Master switch. When `false` (default) every LLM call uses the existing non-streaming code path, regardless of which command or surface fires it.",
              "default": false
            }
          },
          "additionalProperties": false,
          "description": "Streaming output (#881). Wires `chain.stream()` instead of `chain.invoke()` into LLM-driven TUI surfaces so the user sees a live preview of the model's output as it generates, rather than staring at a spinner until the full response arrives.\n\nOutput contract is unchanged when enabled: the final draft / plan still goes through the same parser, schema validator, and retry logic as the non-streaming path. The stream is a *preview only* — it relieves the \"is this hanging?\" anxiety without touching what gets committed.\n\nOff by default while we shake the UX out across providers; some models stream poorly (one-shot blob disguised as a stream) and the preview just blinks in those cases. Off-by-default also lets users who prefer the quieter spinner-only UX skip the visual chatter.\n\nScope today: workstation compose surface's AI commit draft (the `I` keystroke). Other TUI LLM calls (split-plan, PR body) stay non-streaming pending separate validation."
        },
        "fastPath": {
          "type": "object",
          "properties": {
            "markdown": {
              "type": "boolean",
              "description": "Replace the LLM summary with a templated heading extract for `.md` / `.mdx` / `.markdown` modification diffs that have clear heading-level structural changes. Diffs without structural signals (paragraph-only edits) still go to the LLM regardless of this flag.\n\nBench impact (synthetic): collapses docs-update-shaped commits from ~24s cold to ~3ms (no LLM calls fire for the markdown files). Real-world wall-clock savings depend on per-call LLM latency.",
              "default": false
            },
            "languageAware": {
              "type": "object",
              "properties": {
                "enabled": {
                  "type": "boolean",
                  "description": "Master switch. When false (default) the languageAware path is skipped entirely regardless of `languages`.",
                  "default": false
                },
                "languages": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "enum": [
                      "ts",
                      "js",
                      "py",
                      "rs",
                      "go"
                    ]
                  },
                  "description": "Languages to opt in. Omit / empty to enable all supported languages."
                }
              },
              "additionalProperties": false,
              "description": "Language-aware structural fast path (#883). Replace the LLM summary with a symbol-level extract (\"added parseRequest(); removed legacyParse()\") for source files in the listed languages. Off by default; quality is harder to validate than the markdown fast path so we don't enable it without opt-in.\n\nDiffs without top-level structural signals (paragraph-only body edits, formatting changes) still go to the LLM regardless of this flag.\n\nCurrently supports:   - 'ts' : `.ts` / `.tsx` / `.mts` / `.cts`   - 'js' : `.js` / `.jsx` / `.mjs` / `.cjs`   - 'py' : `.py` / `.pyi`   - 'rs' : `.rs`   - 'go' : `.go`"
            }
          },
          "additionalProperties": false,
          "description": "Opt-in fast paths that trade summary detail for speed. Each flag here replaces an LLM summary call with a deterministic templated extract for a specific file shape. Off by default — when enabled, you accept that final commit messages on those file shapes may be blander than LLM-generated summaries (the templated extract names structural changes only).\n\nLossless optimizations (cache, trivial-shape skip on pure additions / deletions / renames / binary, sort discipline) ship default-on and are not configured here."
        }
      },
      "required": [
        "authentication",
        "endpoint",
        "model",
        "provider"
      ]
    },
    "AnthropicLLMService": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "provider": {
          "$ref": "#/definitions/LLMProvider"
        },
        "model": {
          "$ref": "#/definitions/ConfiguredLLMModel"
        },
        "baseURL": {
          "type": "string",
          "description": "Custom base URL for Anthropic-compatible APIs (e.g. a proxy or gateway). If not specified, uses the default Anthropic API endpoint."
        },
        "fields": {
          "type": "object",
          "properties": {
            "temperature": {
              "type": "number"
            },
            "maxTokens": {
              "type": "number"
            }
          },
          "additionalProperties": false
        },
        "tokenLimit": {
          "type": "number",
          "description": "The maximum number of tokens per request.",
          "default": 2048
        },
        "temperature": {
          "type": "number",
          "description": "The temperature value controls the randomness of the generated output. Higher values (e.g., 0.8) make the output more random, while lower values (e.g., 0.2) make it more deterministic.",
          "default": 0.4
        },
        "maxConcurrent": {
          "type": "number",
          "description": "The maximum number of requests to make concurrently.",
          "default": 6
        },
        "minTokensForSummary": {
          "type": "number",
          "description": "Minimum token count for a directory/file group to be eligible for summarization. Groups below this threshold preserve raw diffs to maintain detail.",
          "default": 400
        },
        "maxFileTokens": {
          "type": "number",
          "description": "Maximum tokens allowed for a single file diff before it gets pre-summarized. Prevents large files from biasing the overall summary. If not set, defaults to 25% of tokenLimit.",
          "default": "undefined (uses 0.25 * tokenLimit)"
        },
        "authentication": {
          "anyOf": [
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "None"
                },
                "credentials": {
                  "not": {}
                }
              },
              "required": [
                "type"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "OAuth"
                },
                "credentials": {
                  "type": "object",
                  "properties": {
                    "clientId": {
                      "type": "string"
                    },
                    "clientSecret": {
                      "type": "string"
                    },
                    "token": {
                      "type": "string"
                    }
                  },
                  "additionalProperties": false
                }
              },
              "required": [
                "type",
                "credentials"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "APIKey"
                },
                "credentials": {
                  "type": "object",
                  "properties": {
                    "apiKey": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "apiKey"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "type",
                "credentials"
              ],
              "additionalProperties": false
            }
          ]
        },
        "requestOptions": {
          "type": "object",
          "properties": {
            "timeout": {
              "type": "number"
            },
            "maxRetries": {
              "type": "number"
            }
          },
          "additionalProperties": false
        },
        "maxParsingAttempts": {
          "type": "number",
          "description": "The maximum number of attempts for schema parsing with retry logic.",
          "default": 3
        },
        "dynamicModels": {
          "$ref": "#/definitions/DynamicModelProfile",
          "description": "Optional task-to-model overrides used when model is set to \"dynamic\"."
        },
        "dynamicModelPreference": {
          "$ref": "#/definitions/DynamicModelPreference",
          "description": "Default dynamic routing preference when model is set to \"dynamic\".",
          "default": "balanced"
        },
        "streaming": {
          "type": "object",
          "properties": {
            "enabled": {
              "type": "boolean",
              "description": "Master switch. When `false` (default) every LLM call uses the existing non-streaming code path, regardless of which command or surface fires it.",
              "default": false
            }
          },
          "additionalProperties": false,
          "description": "Streaming output (#881). Wires `chain.stream()` instead of `chain.invoke()` into LLM-driven TUI surfaces so the user sees a live preview of the model's output as it generates, rather than staring at a spinner until the full response arrives.\n\nOutput contract is unchanged when enabled: the final draft / plan still goes through the same parser, schema validator, and retry logic as the non-streaming path. The stream is a *preview only* — it relieves the \"is this hanging?\" anxiety without touching what gets committed.\n\nOff by default while we shake the UX out across providers; some models stream poorly (one-shot blob disguised as a stream) and the preview just blinks in those cases. Off-by-default also lets users who prefer the quieter spinner-only UX skip the visual chatter.\n\nScope today: workstation compose surface's AI commit draft (the `I` keystroke). Other TUI LLM calls (split-plan, PR body) stay non-streaming pending separate validation."
        },
        "fastPath": {
          "type": "object",
          "properties": {
            "markdown": {
              "type": "boolean",
              "description": "Replace the LLM summary with a templated heading extract for `.md` / `.mdx` / `.markdown` modification diffs that have clear heading-level structural changes. Diffs without structural signals (paragraph-only edits) still go to the LLM regardless of this flag.\n\nBench impact (synthetic): collapses docs-update-shaped commits from ~24s cold to ~3ms (no LLM calls fire for the markdown files). Real-world wall-clock savings depend on per-call LLM latency.",
              "default": false
            },
            "languageAware": {
              "type": "object",
              "properties": {
                "enabled": {
                  "type": "boolean",
                  "description": "Master switch. When false (default) the languageAware path is skipped entirely regardless of `languages`.",
                  "default": false
                },
                "languages": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "enum": [
                      "ts",
                      "js",
                      "py",
                      "rs",
                      "go"
                    ]
                  },
                  "description": "Languages to opt in. Omit / empty to enable all supported languages."
                }
              },
              "additionalProperties": false,
              "description": "Language-aware structural fast path (#883). Replace the LLM summary with a symbol-level extract (\"added parseRequest(); removed legacyParse()\") for source files in the listed languages. Off by default; quality is harder to validate than the markdown fast path so we don't enable it without opt-in.\n\nDiffs without top-level structural signals (paragraph-only body edits, formatting changes) still go to the LLM regardless of this flag.\n\nCurrently supports:   - 'ts' : `.ts` / `.tsx` / `.mts` / `.cts`   - 'js' : `.js` / `.jsx` / `.mjs` / `.cjs`   - 'py' : `.py` / `.pyi`   - 'rs' : `.rs`   - 'go' : `.go`"
            }
          },
          "additionalProperties": false,
          "description": "Opt-in fast paths that trade summary detail for speed. Each flag here replaces an LLM summary call with a deterministic templated extract for a specific file shape. Off by default — when enabled, you accept that final commit messages on those file shapes may be blander than LLM-generated summaries (the templated extract names structural changes only).\n\nLossless optimizations (cache, trivial-shape skip on pure additions / deletions / renames / binary, sort discipline) ship default-on and are not configured here."
        }
      },
      "required": [
        "authentication",
        "model",
        "provider"
      ]
    },
    "GeminiLLMService": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "provider": {
          "$ref": "#/definitions/LLMProvider"
        },
        "model": {
          "$ref": "#/definitions/ConfiguredLLMModel"
        },
        "fields": {
          "type": "object",
          "additionalProperties": {}
        },
        "tokenLimit": {
          "type": "number",
          "description": "The maximum number of tokens per request.",
          "default": 2048
        },
        "temperature": {
          "type": "number",
          "description": "The temperature value controls the randomness of the generated output. Higher values (e.g., 0.8) make the output more random, while lower values (e.g., 0.2) make it more deterministic.",
          "default": 0.4
        },
        "maxConcurrent": {
          "type": "number",
          "description": "The maximum number of requests to make concurrently.",
          "default": 6
        },
        "minTokensForSummary": {
          "type": "number",
          "description": "Minimum token count for a directory/file group to be eligible for summarization. Groups below this threshold preserve raw diffs to maintain detail.",
          "default": 400
        },
        "maxFileTokens": {
          "type": "number",
          "description": "Maximum tokens allowed for a single file diff before it gets pre-summarized. Prevents large files from biasing the overall summary. If not set, defaults to 25% of tokenLimit.",
          "default": "undefined (uses 0.25 * tokenLimit)"
        },
        "authentication": {
          "anyOf": [
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "None"
                },
                "credentials": {
                  "not": {}
                }
              },
              "required": [
                "type"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "OAuth"
                },
                "credentials": {
                  "type": "object",
                  "properties": {
                    "clientId": {
                      "type": "string"
                    },
                    "clientSecret": {
                      "type": "string"
                    },
                    "token": {
                      "type": "string"
                    }
                  },
                  "additionalProperties": false
                }
              },
              "required": [
                "type",
                "credentials"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "APIKey"
                },
                "credentials": {
                  "type": "object",
                  "properties": {
                    "apiKey": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "apiKey"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "type",
                "credentials"
              ],
              "additionalProperties": false
            }
          ]
        },
        "requestOptions": {
          "type": "object",
          "properties": {
            "timeout": {
              "type": "number"
            },
            "maxRetries": {
              "type": "number"
            }
          },
          "additionalProperties": false
        },
        "maxParsingAttempts": {
          "type": "number",
          "description": "The maximum number of attempts for schema parsing with retry logic.",
          "default": 3
        },
        "dynamicModels": {
          "$ref": "#/definitions/DynamicModelProfile",
          "description": "Optional task-to-model overrides used when model is set to \"dynamic\"."
        },
        "dynamicModelPreference": {
          "$ref": "#/definitions/DynamicModelPreference",
          "description": "Default dynamic routing preference when model is set to \"dynamic\".",
          "default": "balanced"
        },
        "streaming": {
          "type": "object",
          "properties": {
            "enabled": {
              "type": "boolean",
              "description": "Master switch. When `false` (default) every LLM call uses the existing non-streaming code path, regardless of which command or surface fires it.",
              "default": false
            }
          },
          "additionalProperties": false,
          "description": "Streaming output (#881). Wires `chain.stream()` instead of `chain.invoke()` into LLM-driven TUI surfaces so the user sees a live preview of the model's output as it generates, rather than staring at a spinner until the full response arrives.\n\nOutput contract is unchanged when enabled: the final draft / plan still goes through the same parser, schema validator, and retry logic as the non-streaming path. The stream is a *preview only* — it relieves the \"is this hanging?\" anxiety without touching what gets committed.\n\nOff by default while we shake the UX out across providers; some models stream poorly (one-shot blob disguised as a stream) and the preview just blinks in those cases. Off-by-default also lets users who prefer the quieter spinner-only UX skip the visual chatter.\n\nScope today: workstation compose surface's AI commit draft (the `I` keystroke). Other TUI LLM calls (split-plan, PR body) stay non-streaming pending separate validation."
        },
        "fastPath": {
          "type": "object",
          "properties": {
            "markdown": {
              "type": "boolean",
              "description": "Replace the LLM summary with a templated heading extract for `.md` / `.mdx` / `.markdown` modification diffs that have clear heading-level structural changes. Diffs without structural signals (paragraph-only edits) still go to the LLM regardless of this flag.\n\nBench impact (synthetic): collapses docs-update-shaped commits from ~24s cold to ~3ms (no LLM calls fire for the markdown files). Real-world wall-clock savings depend on per-call LLM latency.",
              "default": false
            },
            "languageAware": {
              "type": "object",
              "properties": {
                "enabled": {
                  "type": "boolean",
                  "description": "Master switch. When false (default) the languageAware path is skipped entirely regardless of `languages`.",
                  "default": false
                },
                "languages": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "enum": [
                      "ts",
                      "js",
                      "py",
                      "rs",
                      "go"
                    ]
                  },
                  "description": "Languages to opt in. Omit / empty to enable all supported languages."
                }
              },
              "additionalProperties": false,
              "description": "Language-aware structural fast path (#883). Replace the LLM summary with a symbol-level extract (\"added parseRequest(); removed legacyParse()\") for source files in the listed languages. Off by default; quality is harder to validate than the markdown fast path so we don't enable it without opt-in.\n\nDiffs without top-level structural signals (paragraph-only body edits, formatting changes) still go to the LLM regardless of this flag.\n\nCurrently supports:   - 'ts' : `.ts` / `.tsx` / `.mts` / `.cts`   - 'js' : `.js` / `.jsx` / `.mjs` / `.cjs`   - 'py' : `.py` / `.pyi`   - 'rs' : `.rs`   - 'go' : `.go`"
            }
          },
          "additionalProperties": false,
          "description": "Opt-in fast paths that trade summary detail for speed. Each flag here replaces an LLM summary call with a deterministic templated extract for a specific file shape. Off by default — when enabled, you accept that final commit messages on those file shapes may be blander than LLM-generated summaries (the templated extract names structural changes only).\n\nLossless optimizations (cache, trivial-shape skip on pure additions / deletions / renames / binary, sort discipline) ship default-on and are not configured here."
        }
      },
      "required": [
        "authentication",
        "model",
        "provider"
      ]
    },
    "MistralLLMService": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "provider": {
          "$ref": "#/definitions/LLMProvider"
        },
        "model": {
          "$ref": "#/definitions/ConfiguredLLMModel"
        },
        "fields": {
          "type": "object",
          "additionalProperties": {}
        },
        "tokenLimit": {
          "type": "number",
          "description": "The maximum number of tokens per request.",
          "default": 2048
        },
        "temperature": {
          "type": "number",
          "description": "The temperature value controls the randomness of the generated output. Higher values (e.g., 0.8) make the output more random, while lower values (e.g., 0.2) make it more deterministic.",
          "default": 0.4
        },
        "maxConcurrent": {
          "type": "number",
          "description": "The maximum number of requests to make concurrently.",
          "default": 6
        },
        "minTokensForSummary": {
          "type": "number",
          "description": "Minimum token count for a directory/file group to be eligible for summarization. Groups below this threshold preserve raw diffs to maintain detail.",
          "default": 400
        },
        "maxFileTokens": {
          "type": "number",
          "description": "Maximum tokens allowed for a single file diff before it gets pre-summarized. Prevents large files from biasing the overall summary. If not set, defaults to 25% of tokenLimit.",
          "default": "undefined (uses 0.25 * tokenLimit)"
        },
        "authentication": {
          "anyOf": [
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "None"
                },
                "credentials": {
                  "not": {}
                }
              },
              "required": [
                "type"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "OAuth"
                },
                "credentials": {
                  "type": "object",
                  "properties": {
                    "clientId": {
                      "type": "string"
                    },
                    "clientSecret": {
                      "type": "string"
                    },
                    "token": {
                      "type": "string"
                    }
                  },
                  "additionalProperties": false
                }
              },
              "required": [
                "type",
                "credentials"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "APIKey"
                },
                "credentials": {
                  "type": "object",
                  "properties": {
                    "apiKey": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "apiKey"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "type",
                "credentials"
              ],
              "additionalProperties": false
            }
          ]
        },
        "requestOptions": {
          "type": "object",
          "properties": {
            "timeout": {
              "type": "number"
            },
            "maxRetries": {
              "type": "number"
            }
          },
          "additionalProperties": false
        },
        "maxParsingAttempts": {
          "type": "number",
          "description": "The maximum number of attempts for schema parsing with retry logic.",
          "default": 3
        },
        "dynamicModels": {
          "$ref": "#/definitions/DynamicModelProfile",
          "description": "Optional task-to-model overrides used when model is set to \"dynamic\"."
        },
        "dynamicModelPreference": {
          "$ref": "#/definitions/DynamicModelPreference",
          "description": "Default dynamic routing preference when model is set to \"dynamic\".",
          "default": "balanced"
        },
        "streaming": {
          "type": "object",
          "properties": {
            "enabled": {
              "type": "boolean",
              "description": "Master switch. When `false` (default) every LLM call uses the existing non-streaming code path, regardless of which command or surface fires it.",
              "default": false
            }
          },
          "additionalProperties": false,
          "description": "Streaming output (#881). Wires `chain.stream()` instead of `chain.invoke()` into LLM-driven TUI surfaces so the user sees a live preview of the model's output as it generates, rather than staring at a spinner until the full response arrives.\n\nOutput contract is unchanged when enabled: the final draft / plan still goes through the same parser, schema validator, and retry logic as the non-streaming path. The stream is a *preview only* — it relieves the \"is this hanging?\" anxiety without touching what gets committed.\n\nOff by default while we shake the UX out across providers; some models stream poorly (one-shot blob disguised as a stream) and the preview just blinks in those cases. Off-by-default also lets users who prefer the quieter spinner-only UX skip the visual chatter.\n\nScope today: workstation compose surface's AI commit draft (the `I` keystroke). Other TUI LLM calls (split-plan, PR body) stay non-streaming pending separate validation."
        },
        "fastPath": {
          "type": "object",
          "properties": {
            "markdown": {
              "type": "boolean",
              "description": "Replace the LLM summary with a templated heading extract for `.md` / `.mdx` / `.markdown` modification diffs that have clear heading-level structural changes. Diffs without structural signals (paragraph-only edits) still go to the LLM regardless of this flag.\n\nBench impact (synthetic): collapses docs-update-shaped commits from ~24s cold to ~3ms (no LLM calls fire for the markdown files). Real-world wall-clock savings depend on per-call LLM latency.",
              "default": false
            },
            "languageAware": {
              "type": "object",
              "properties": {
                "enabled": {
                  "type": "boolean",
                  "description": "Master switch. When false (default) the languageAware path is skipped entirely regardless of `languages`.",
                  "default": false
                },
                "languages": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "enum": [
                      "ts",
                      "js",
                      "py",
                      "rs",
                      "go"
                    ]
                  },
                  "description": "Languages to opt in. Omit / empty to enable all supported languages."
                }
              },
              "additionalProperties": false,
              "description": "Language-aware structural fast path (#883). Replace the LLM summary with a symbol-level extract (\"added parseRequest(); removed legacyParse()\") for source files in the listed languages. Off by default; quality is harder to validate than the markdown fast path so we don't enable it without opt-in.\n\nDiffs without top-level structural signals (paragraph-only body edits, formatting changes) still go to the LLM regardless of this flag.\n\nCurrently supports:   - 'ts' : `.ts` / `.tsx` / `.mts` / `.cts`   - 'js' : `.js` / `.jsx` / `.mjs` / `.cjs`   - 'py' : `.py` / `.pyi`   - 'rs' : `.rs`   - 'go' : `.go`"
            }
          },
          "additionalProperties": false,
          "description": "Opt-in fast paths that trade summary detail for speed. Each flag here replaces an LLM summary call with a deterministic templated extract for a specific file shape. Off by default — when enabled, you accept that final commit messages on those file shapes may be blander than LLM-generated summaries (the templated extract names structural changes only).\n\nLossless optimizations (cache, trivial-shape skip on pure additions / deletions / renames / binary, sort discipline) ship default-on and are not configured here."
        }
      },
      "required": [
        "authentication",
        "model",
        "provider"
      ]
    },
    "AzureLLMService": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "provider": {
          "$ref": "#/definitions/LLMProvider"
        },
        "model": {
          "$ref": "#/definitions/ConfiguredLLMModel"
        },
        "instanceName": {
          "type": "string"
        },
        "deploymentName": {
          "type": "string"
        },
        "apiVersion": {
          "type": "string"
        },
        "fields": {
          "type": "object",
          "additionalProperties": {}
        },
        "tokenLimit": {
          "type": "number",
          "description": "The maximum number of tokens per request.",
          "default": 2048
        },
        "temperature": {
          "type": "number",
          "description": "The temperature value controls the randomness of the generated output. Higher values (e.g., 0.8) make the output more random, while lower values (e.g., 0.2) make it more deterministic.",
          "default": 0.4
        },
        "maxConcurrent": {
          "type": "number",
          "description": "The maximum number of requests to make concurrently.",
          "default": 6
        },
        "minTokensForSummary": {
          "type": "number",
          "description": "Minimum token count for a directory/file group to be eligible for summarization. Groups below this threshold preserve raw diffs to maintain detail.",
          "default": 400
        },
        "maxFileTokens": {
          "type": "number",
          "description": "Maximum tokens allowed for a single file diff before it gets pre-summarized. Prevents large files from biasing the overall summary. If not set, defaults to 25% of tokenLimit.",
          "default": "undefined (uses 0.25 * tokenLimit)"
        },
        "authentication": {
          "anyOf": [
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "None"
                },
                "credentials": {
                  "not": {}
                }
              },
              "required": [
                "type"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "OAuth"
                },
                "credentials": {
                  "type": "object",
                  "properties": {
                    "clientId": {
                      "type": "string"
                    },
                    "clientSecret": {
                      "type": "string"
                    },
                    "token": {
                      "type": "string"
                    }
                  },
                  "additionalProperties": false
                }
              },
              "required": [
                "type",
                "credentials"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "APIKey"
                },
                "credentials": {
                  "type": "object",
                  "properties": {
                    "apiKey": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "apiKey"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "type",
                "credentials"
              ],
              "additionalProperties": false
            }
          ]
        },
        "requestOptions": {
          "type": "object",
          "properties": {
            "timeout": {
              "type": "number"
            },
            "maxRetries": {
              "type": "number"
            }
          },
          "additionalProperties": false
        },
        "maxParsingAttempts": {
          "type": "number",
          "description": "The maximum number of attempts for schema parsing with retry logic.",
          "default": 3
        },
        "dynamicModels": {
          "$ref": "#/definitions/DynamicModelProfile",
          "description": "Optional task-to-model overrides used when model is set to \"dynamic\"."
        },
        "dynamicModelPreference": {
          "$ref": "#/definitions/DynamicModelPreference",
          "description": "Default dynamic routing preference when model is set to \"dynamic\".",
          "default": "balanced"
        },
        "streaming": {
          "type": "object",
          "properties": {
            "enabled": {
              "type": "boolean",
              "description": "Master switch. When `false` (default) every LLM call uses the existing non-streaming code path, regardless of which command or surface fires it.",
              "default": false
            }
          },
          "additionalProperties": false,
          "description": "Streaming output (#881). Wires `chain.stream()` instead of `chain.invoke()` into LLM-driven TUI surfaces so the user sees a live preview of the model's output as it generates, rather than staring at a spinner until the full response arrives.\n\nOutput contract is unchanged when enabled: the final draft / plan still goes through the same parser, schema validator, and retry logic as the non-streaming path. The stream is a *preview only* — it relieves the \"is this hanging?\" anxiety without touching what gets committed.\n\nOff by default while we shake the UX out across providers; some models stream poorly (one-shot blob disguised as a stream) and the preview just blinks in those cases. Off-by-default also lets users who prefer the quieter spinner-only UX skip the visual chatter.\n\nScope today: workstation compose surface's AI commit draft (the `I` keystroke). Other TUI LLM calls (split-plan, PR body) stay non-streaming pending separate validation."
        },
        "fastPath": {
          "type": "object",
          "properties": {
            "markdown": {
              "type": "boolean",
              "description": "Replace the LLM summary with a templated heading extract for `.md` / `.mdx` / `.markdown` modification diffs that have clear heading-level structural changes. Diffs without structural signals (paragraph-only edits) still go to the LLM regardless of this flag.\n\nBench impact (synthetic): collapses docs-update-shaped commits from ~24s cold to ~3ms (no LLM calls fire for the markdown files). Real-world wall-clock savings depend on per-call LLM latency.",
              "default": false
            },
            "languageAware": {
              "type": "object",
              "properties": {
                "enabled": {
                  "type": "boolean",
                  "description": "Master switch. When false (default) the languageAware path is skipped entirely regardless of `languages`.",
                  "default": false
                },
                "languages": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "enum": [
                      "ts",
                      "js",
                      "py",
                      "rs",
                      "go"
                    ]
                  },
                  "description": "Languages to opt in. Omit / empty to enable all supported languages."
                }
              },
              "additionalProperties": false,
              "description": "Language-aware structural fast path (#883). Replace the LLM summary with a symbol-level extract (\"added parseRequest(); removed legacyParse()\") for source files in the listed languages. Off by default; quality is harder to validate than the markdown fast path so we don't enable it without opt-in.\n\nDiffs without top-level structural signals (paragraph-only body edits, formatting changes) still go to the LLM regardless of this flag.\n\nCurrently supports:   - 'ts' : `.ts` / `.tsx` / `.mts` / `.cts`   - 'js' : `.js` / `.jsx` / `.mjs` / `.cjs`   - 'py' : `.py` / `.pyi`   - 'rs' : `.rs`   - 'go' : `.go`"
            }
          },
          "additionalProperties": false,
          "description": "Opt-in fast paths that trade summary detail for speed. Each flag here replaces an LLM summary call with a deterministic templated extract for a specific file shape. Off by default — when enabled, you accept that final commit messages on those file shapes may be blander than LLM-generated summaries (the templated extract names structural changes only).\n\nLossless optimizations (cache, trivial-shape skip on pure additions / deletions / renames / binary, sort discipline) ship default-on and are not configured here."
        }
      },
      "required": [
        "authentication",
        "model",
        "provider"
      ]
    },
    "BedrockLLMService": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "provider": {
          "$ref": "#/definitions/LLMProvider"
        },
        "model": {
          "$ref": "#/definitions/ConfiguredLLMModel"
        },
        "region": {
          "type": "string"
        },
        "accessKeyId": {
          "type": "string"
        },
        "secretAccessKey": {
          "type": "string"
        },
        "sessionToken": {
          "type": "string"
        },
        "fields": {
          "type": "object",
          "additionalProperties": {}
        },
        "tokenLimit": {
          "type": "number",
          "description": "The maximum number of tokens per request.",
          "default": 2048
        },
        "temperature": {
          "type": "number",
          "description": "The temperature value controls the randomness of the generated output. Higher values (e.g., 0.8) make the output more random, while lower values (e.g., 0.2) make it more deterministic.",
          "default": 0.4
        },
        "maxConcurrent": {
          "type": "number",
          "description": "The maximum number of requests to make concurrently.",
          "default": 6
        },
        "minTokensForSummary": {
          "type": "number",
          "description": "Minimum token count for a directory/file group to be eligible for summarization. Groups below this threshold preserve raw diffs to maintain detail.",
          "default": 400
        },
        "maxFileTokens": {
          "type": "number",
          "description": "Maximum tokens allowed for a single file diff before it gets pre-summarized. Prevents large files from biasing the overall summary. If not set, defaults to 25% of tokenLimit.",
          "default": "undefined (uses 0.25 * tokenLimit)"
        },
        "authentication": {
          "anyOf": [
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "None"
                },
                "credentials": {
                  "not": {}
                }
              },
              "required": [
                "type"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "OAuth"
                },
                "credentials": {
                  "type": "object",
                  "properties": {
                    "clientId": {
                      "type": "string"
                    },
                    "clientSecret": {
                      "type": "string"
                    },
                    "token": {
                      "type": "string"
                    }
                  },
                  "additionalProperties": false
                }
              },
              "required": [
                "type",
                "credentials"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "const": "APIKey"
                },
                "credentials": {
                  "type": "object",
                  "properties": {
                    "apiKey": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "apiKey"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "type",
                "credentials"
              ],
              "additionalProperties": false
            }
          ]
        },
        "requestOptions": {
          "type": "object",
          "properties": {
            "timeout": {
              "type": "number"
            },
            "maxRetries": {
              "type": "number"
            }
          },
          "additionalProperties": false
        },
        "maxParsingAttempts": {
          "type": "number",
          "description": "The maximum number of attempts for schema parsing with retry logic.",
          "default": 3
        },
        "dynamicModels": {
          "$ref": "#/definitions/DynamicModelProfile",
          "description": "Optional task-to-model overrides used when model is set to \"dynamic\"."
        },
        "dynamicModelPreference": {
          "$ref": "#/definitions/DynamicModelPreference",
          "description": "Default dynamic routing preference when model is set to \"dynamic\".",
          "default": "balanced"
        },
        "streaming": {
          "type": "object",
          "properties": {
            "enabled": {
              "type": "boolean",
              "description": "Master switch. When `false` (default) every LLM call uses the existing non-streaming code path, regardless of which command or surface fires it.",
              "default": false
            }
          },
          "additionalProperties": false,
          "description": "Streaming output (#881). Wires `chain.stream()` instead of `chain.invoke()` into LLM-driven TUI surfaces so the user sees a live preview of the model's output as it generates, rather than staring at a spinner until the full response arrives.\n\nOutput contract is unchanged when enabled: the final draft / plan still goes through the same parser, schema validator, and retry logic as the non-streaming path. The stream is a *preview only* — it relieves the \"is this hanging?\" anxiety without touching what gets committed.\n\nOff by default while we shake the UX out across providers; some models stream poorly (one-shot blob disguised as a stream) and the preview just blinks in those cases. Off-by-default also lets users who prefer the quieter spinner-only UX skip the visual chatter.\n\nScope today: workstation compose surface's AI commit draft (the `I` keystroke). Other TUI LLM calls (split-plan, PR body) stay non-streaming pending separate validation."
        },
        "fastPath": {
          "type": "object",
          "properties": {
            "markdown": {
              "type": "boolean",
              "description": "Replace the LLM summary with a templated heading extract for `.md` / `.mdx` / `.markdown` modification diffs that have clear heading-level structural changes. Diffs without structural signals (paragraph-only edits) still go to the LLM regardless of this flag.\n\nBench impact (synthetic): collapses docs-update-shaped commits from ~24s cold to ~3ms (no LLM calls fire for the markdown files). Real-world wall-clock savings depend on per-call LLM latency.",
              "default": false
            },
            "languageAware": {
              "type": "object",
              "properties": {
                "enabled": {
                  "type": "boolean",
                  "description": "Master switch. When false (default) the languageAware path is skipped entirely regardless of `languages`.",
                  "default": false
                },
                "languages": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "enum": [
                      "ts",
                      "js",
                      "py",
                      "rs",
                      "go"
                    ]
                  },
                  "description": "Languages to opt in. Omit / empty to enable all supported languages."
                }
              },
              "additionalProperties": false,
              "description": "Language-aware structural fast path (#883). Replace the LLM summary with a symbol-level extract (\"added parseRequest(); removed legacyParse()\") for source files in the listed languages. Off by default; quality is harder to validate than the markdown fast path so we don't enable it without opt-in.\n\nDiffs without top-level structural signals (paragraph-only body edits, formatting changes) still go to the LLM regardless of this flag.\n\nCurrently supports:   - 'ts' : `.ts` / `.tsx` / `.mts` / `.cts`   - 'js' : `.js` / `.jsx` / `.mjs` / `.cjs`   - 'py' : `.py` / `.pyi`   - 'rs' : `.rs`   - 'go' : `.go`"
            }
          },
          "additionalProperties": false,
          "description": "Opt-in fast paths that trade summary detail for speed. Each flag here replaces an LLM summary call with a deterministic templated extract for a specific file shape. Off by default — when enabled, you accept that final commit messages on those file shapes may be blander than LLM-generated summaries (the templated extract names structural changes only).\n\nLossless optimizations (cache, trivial-shape skip on pure additions / deletions / renames / binary, sort discipline) ship default-on and are not configured here."
        }
      },
      "required": [
        "authentication",
        "model",
        "provider"
      ]
    },
    "LogInkThemeConfig": {
      "type": "object",
      "properties": {
        "ascii": {
          "type": "boolean"
        },
        "borderStyle": {
          "$ref": "#/definitions/LogInkBorderStyle"
        },
        "colors": {
          "$ref": "#/definitions/LogInkThemeColors"
        },
        "preset": {
          "$ref": "#/definitions/LogInkThemePreset"
        }
      },
      "additionalProperties": false
    },
    "LogInkBorderStyle": {
      "type": "string",
      "enum": [
        "round",
        "single",
        "classic"
      ]
    },
    "LogInkThemeColors": {
      "type": "object",
      "properties": {
        "accent": {
          "type": "string"
        },
        "border": {
          "type": "string"
        },
        "danger": {
          "type": "string"
        },
        "focusBorder": {
          "type": "string"
        },
        "gitAdded": {
          "type": "string"
        },
        "gitDeleted": {
          "type": "string"
        },
        "gitModified": {
          "type": "string"
        },
        "info": {
          "type": "string"
        },
        "muted": {
          "type": "string"
        },
        "selection": {
          "type": "string"
        },
        "selectionForeground": {
          "type": "string",
          "description": "Foreground for text sitting on the `selection` background. Derived automatically from `selection` (black on light, white on dark) so the selected row stays readable regardless of the user's terminal default foreground — but can be overridden per theme via `options.colors`."
        },
        "success": {
          "type": "string"
        },
        "warning": {
          "type": "string"
        },
        "syntaxKeyword": {
          "type": "string",
          "description": "Optional syntax-highlight token colors for the diff view (#1117 follow-up). All optional: when a slot is unset the resolver (`resolveSyntaxColor`) falls back to a sensible ANSI default, so themes get highlighting for free and only need to define these to customize. `noColor` themes skip syntax coloring entirely."
        },
        "syntaxString": {
          "type": "string"
        },
        "syntaxComment": {
          "type": "string"
        },
        "syntaxNumber": {
          "type": "string"
        },
        "syntaxType": {
          "type": "string"
        },
        "syntaxFunction": {
          "type": "string"
        },
        "syntaxConstant": {
          "type": "string"
        },
        "syntaxProperty": {
          "type": "string"
        }
      },
      "additionalProperties": false
    },
    "LogInkThemePreset": {
      "type": "string",
      "enum": [
        "default",
        "monochrome",
        "catppuccin",
        "gruvbox",
        "dracula",
        "nord",
        "solarized-dark",
        "tokyo-night",
        "one-dark",
        "rose-pine",
        "kanagawa",
        "everforest",
        "monokai",
        "synthwave",
        "ayu-dark",
        "palenight",
        "github-dark",
        "horizon",
        "nightfox",
        "carbonfox",
        "tokyonight-storm",
        "catppuccin-latte",
        "solarized-light",
        "github-light",
        "iceberg",
        "material-ocean",
        "moonlight",
        "poimandres",
        "vitesse-dark",
        "vesper",
        "flexoki",
        "mellow",
        "night-owl",
        "cobalt2",
        "oceanic-next",
        "catppuccin-macchiato",
        "gruvbox-light",
        "tokyo-night-day",
        "one-light",
        "ayu-light",
        "rose-pine-dawn",
        "everforest-light",
        "vitesse-light",
        "dayfox",
        "night-owl-light",
        "flexoki-light",
        "material-lighter",
        "papercolor-light",
        "modus-operandi",
        "quiet-light",
        "catppuccin-frappe",
        "rose-pine-moon",
        "kanagawa-dragon",
        "kanagawa-lotus",
        "nordfox",
        "duskfox",
        "terafox",
        "dawnfox",
        "ayu-mirage",
        "material-darker",
        "tokyo-night-moon",
        "gruvbox-material",
        "gruvbox-material-light",
        "modus-vivendi",
        "zenburn",
        "oxocarbon",
        "tomorrow-night",
        "monokai-pro",
        "sonokai",
        "doom-one",
        "andromeda",
        "aura",
        "cyberdream",
        "nightfly",
        "panda",
        "hyper-snazzy",
        "apprentice",
        "melange",
        "melange-light",
        "spaceduck",
        "embark",
        "bluloco-dark",
        "bluloco-light",
        "papercolor-dark",
        "base16-ocean",
        "base16-eighties",
        "everblush",
        "darcula",
        "eldritch",
        "edge-light",
        "zenbones",
        "iceberg-light",
        "github-dark-dimmed",
        "edge-dark",
        "selenized-dark",
        "selenized-black",
        "selenized-light",
        "monokai-pro-machine",
        "monokai-pro-octagon",
        "monokai-pro-ristretto",
        "monokai-pro-spectrum",
        "base16-default-dark",
        "base16-default-light",
        "tomorrow",
        "tokyodark",
        "spacemacs-dark",
        "bamboo",
        "citylights",
        "oxocarbon-light"
      ]
    }
  }
} as const