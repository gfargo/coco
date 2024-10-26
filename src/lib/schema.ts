// This file is auto-generated - DO NOT EDIT
/* eslint-disable */

/**
 * Schema ID for JSON validation
 */
export const SCHEMA_PUBLIC_URL = "https://git-co.co/schema.json"

/**
 * Generated JSON schema
 */
export const schema = {
  "$id": "https://git-co.co/schema.json",
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
        "mode": {
          "type": "string",
          "enum": [
            "stdout",
            "interactive"
          ],
          "description": "The output destination for the generated result.\n- 'stdout': Prints the result to the standard output.  This is the default behavior.\n- 'interactive': Provides an interactive prompt for editing the result & committing the changes.",
          "default": "stdout"
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
          "$ref": "#/definitions/LLMModel"
        },
        "fields": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "verbose": {
              "type": "boolean"
            },
            "callbacks": {
              "$ref": "#/definitions/Callbacks"
            },
            "tags": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "metadata": {
              "type": "object",
              "additionalProperties": {}
            },
            "maxConcurrency": {
              "type": "number",
              "description": "The maximum number of concurrent calls that can be made. Defaults to `Infinity`, which means no limit."
            },
            "maxRetries": {
              "type": "number",
              "description": "The maximum number of retries that can be made for a single call, with an exponential backoff between each attempt. Defaults to 6."
            },
            "onFailedAttempt": {
              "$ref": "#/definitions/FailedAttemptHandler",
              "description": "Custom handler to handle failed attempts. Takes the originally thrown error object as input, and should itself throw an error if the input error is not retryable."
            },
            "callbackManager": {
              "$ref": "#/definitions/CallbackManager",
              "deprecated": "Use `callbacks` instead"
            },
            "cache": {
              "anyOf": [
                {
                  "$ref": "#/definitions/BaseCache"
                },
                {
                  "type": "boolean"
                }
              ]
            },
            "concurrency": {
              "type": "number",
              "deprecated": "Use `maxConcurrency` instead"
            },
            "bestOf": {
              "type": "number",
              "description": "Generates `bestOf` completions server side and returns the \"best\""
            },
            "batchSize": {
              "type": "number",
              "description": "Batch size to use when passing multiple documents to generate"
            },
            "temperature": {
              "type": "number",
              "description": "Sampling temperature to use"
            },
            "maxTokens": {
              "type": "number",
              "description": "Maximum number of tokens to generate in the completion. -1 returns as many tokens as possible given the prompt and the model's maximum context size."
            },
            "topP": {
              "type": "number",
              "description": "Total probability mass of tokens to consider at each step"
            },
            "frequencyPenalty": {
              "type": "number",
              "description": "Penalizes repeated tokens according to frequency"
            },
            "presencePenalty": {
              "type": "number",
              "description": "Penalizes repeated tokens"
            },
            "n": {
              "type": "number",
              "description": "Number of completions to generate for each prompt"
            },
            "logitBias": {
              "type": "object",
              "additionalProperties": {
                "type": "number"
              },
              "description": "Dictionary used to adjust the probability of specific tokens being generated"
            },
            "user": {
              "type": "string",
              "description": "Unique string identifier representing your end-user, which can help OpenAI to monitor and detect abuse."
            },
            "streaming": {
              "type": "boolean",
              "description": "Whether to stream the results or not. Enabling disables tokenUsage reporting"
            },
            "streamUsage": {
              "type": "boolean",
              "description": "Whether or not to include token usage data in streamed chunks.",
              "default": true
            },
            "modelName": {
              "type": "string",
              "description": "Model name to use Alias for `model`"
            },
            "model": {
              "type": "string",
              "description": "Model name to use"
            },
            "modelKwargs": {
              "type": "object",
              "description": "Holds any additional parameters that are valid to pass to  {@link  * https://platform.openai.com/docs/api-reference/completions/create | }      * `openai.createCompletion`} that are not explicitly specified on this class."
            },
            "stop": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "List of stop words to use when generating Alias for `stopSequences`"
            },
            "stopSequences": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "List of stop words to use when generating"
            },
            "timeout": {
              "type": "number",
              "description": "Timeout to use when making requests to OpenAI."
            },
            "openAIApiKey": {
              "type": "string",
              "description": "API key to use when making requests to OpenAI. Defaults to the value of `OPENAI_API_KEY` environment variable. Alias for `apiKey`"
            },
            "apiKey": {
              "type": "string",
              "description": "API key to use when making requests to OpenAI. Defaults to the value of `OPENAI_API_KEY` environment variable."
            }
          }
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
        "anthropic"
      ]
    },
    "LLMModel": {
      "anyOf": [
        {
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
            "gpt-4o-2024-05-13"
          ]
        },
        {
          "$ref": "#/definitions/OllamaModel"
        },
        {
          "$ref": "#/definitions/AnthropicModel"
        }
      ]
    },
    "OllamaModel": {
      "type": "string",
      "enum": [
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
        "llama3.2:1b-instruct-fp16",
        "llama3.2:1b-instruct-q3_K_M",
        "llama3",
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
        "qwen2"
      ]
    },
    "AnthropicModel": {
      "type": "string",
      "enum": [
        "claude-3-5-sonnet-20240620",
        "claude-3-opus-20240229",
        "claude-3-sonnet-20240229",
        "claude-3-haiku-20240307",
        "claude-2.1",
        "claude-2.0"
      ]
    },
    "Callbacks": {
      "anyOf": [
        {
          "$ref": "#/definitions/CallbackManager"
        },
        {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "$ref": "#/definitions/BaseCallbackHandler"
              },
              {
                "$ref": "#/definitions/CallbackHandlerMethods"
              }
            ]
          }
        }
      ]
    },
    "CallbackManager": {
      "type": "object",
      "properties": {
        "handlers": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/BaseCallbackHandler"
          }
        },
        "inheritableHandlers": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/BaseCallbackHandler"
          }
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "inheritableTags": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "metadata": {
          "type": "object",
          "additionalProperties": {}
        },
        "inheritableMetadata": {
          "type": "object",
          "additionalProperties": {}
        },
        "name": {
          "type": "string"
        },
        "_parentRunId": {
          "type": "string"
        }
      },
      "required": [
        "handlers",
        "inheritableHandlers",
        "tags",
        "inheritableTags",
        "metadata",
        "inheritableMetadata",
        "name"
      ],
      "additionalProperties": false
    },
    "BaseCallbackHandler": {
      "type": "object",
      "properties": {
        "lc_serializable": {
          "type": "boolean"
        },
        "lc_kwargs": {
          "$ref": "#/definitions/SerializedFields"
        },
        "lc_namespace": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "A path to the module that contains the class, eg. [\"langchain\", \"llms\"] Usually should be the same as the entrypoint the class is exported from."
        },
        "ignoreLLM": {
          "type": "boolean"
        },
        "ignoreChain": {
          "type": "boolean"
        },
        "ignoreAgent": {
          "type": "boolean"
        },
        "ignoreRetriever": {
          "type": "boolean"
        },
        "ignoreCustomEvent": {
          "type": "boolean"
        },
        "_awaitHandler": {
          "type": "boolean"
        },
        "raiseError": {
          "type": "boolean"
        },
        "name": {
          "type": "string"
        },
        "awaitHandlers": {
          "type": "boolean"
        }
      },
      "required": [
        "awaitHandlers",
        "ignoreAgent",
        "ignoreChain",
        "ignoreCustomEvent",
        "ignoreLLM",
        "ignoreRetriever",
        "lc_kwargs",
        "lc_namespace",
        "lc_serializable",
        "name",
        "raiseError"
      ],
      "additionalProperties": false,
      "description": "Abstract base class for creating callback handlers in the LangChain framework. It provides a set of optional methods that can be overridden in derived classes to handle various events during the execution of a LangChain application."
    },
    "SerializedFields": {
      "type": "object"
    },
    "CallbackHandlerMethods": {
      "type": "object",
      "additionalProperties": false,
      "description": "Base interface for callbacks. All methods are optional. If a method is not implemented, it will be ignored. If a method is implemented, it will be called at the appropriate time. All methods are called with the run ID of the LLM/ChatModel/Chain that is running, which is generated by the CallbackManager."
    },
    "FailedAttemptHandler": {
      "$comment": "(error: any) => any",
      "type": "object",
      "properties": {
        "namedArgs": {
          "type": "object",
          "properties": {
            "error": {}
          },
          "required": [
            "error"
          ],
          "additionalProperties": false
        }
      }
    },
    "BaseCache": {
      "type": "object",
      "additionalProperties": false,
      "description": "Base class for all caches. All caches should extend this class."
    },
    "OllamaLLMService": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "provider": {
          "$ref": "#/definitions/LLMProvider"
        },
        "model": {
          "$ref": "#/definitions/LLMModel"
        },
        "endpoint": {
          "type": "string"
        },
        "fields": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "verbose": {
              "type": "boolean"
            },
            "callbacks": {
              "$ref": "#/definitions/Callbacks"
            },
            "tags": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "metadata": {
              "type": "object",
              "additionalProperties": {}
            },
            "maxConcurrency": {
              "type": "number",
              "description": "The maximum number of concurrent calls that can be made. Defaults to `Infinity`, which means no limit."
            },
            "maxRetries": {
              "type": "number",
              "description": "The maximum number of retries that can be made for a single call, with an exponential backoff between each attempt. Defaults to 6."
            },
            "onFailedAttempt": {
              "$ref": "#/definitions/FailedAttemptHandler",
              "description": "Custom handler to handle failed attempts. Takes the originally thrown error object as input, and should itself throw an error if the input error is not retryable."
            },
            "callbackManager": {
              "$ref": "#/definitions/CallbackManager",
              "deprecated": "Use `callbacks` instead"
            },
            "cache": {
              "anyOf": [
                {
                  "$ref": "#/definitions/BaseCache"
                },
                {
                  "type": "boolean"
                }
              ]
            },
            "concurrency": {
              "type": "number",
              "deprecated": "Use `maxConcurrency` instead"
            },
            "embeddingOnly": {
              "type": "boolean"
            },
            "f16KV": {
              "type": "boolean"
            },
            "frequencyPenalty": {
              "type": "number"
            },
            "headers": {
              "type": "object",
              "additionalProperties": {
                "type": "string"
              }
            },
            "keepAlive": {
              "type": "string"
            },
            "logitsAll": {
              "type": "boolean"
            },
            "lowVram": {
              "type": "boolean"
            },
            "mainGpu": {
              "type": "number"
            },
            "model": {
              "type": "string"
            },
            "baseUrl": {
              "type": "string"
            },
            "mirostat": {
              "type": "number"
            },
            "mirostatEta": {
              "type": "number"
            },
            "mirostatTau": {
              "type": "number"
            },
            "numBatch": {
              "type": "number"
            },
            "numCtx": {
              "type": "number"
            },
            "numGpu": {
              "type": "number"
            },
            "numGqa": {
              "type": "number"
            },
            "numKeep": {
              "type": "number"
            },
            "numPredict": {
              "type": "number"
            },
            "numThread": {
              "type": "number"
            },
            "penalizeNewline": {
              "type": "boolean"
            },
            "presencePenalty": {
              "type": "number"
            },
            "repeatLastN": {
              "type": "number"
            },
            "repeatPenalty": {
              "type": "number"
            },
            "ropeFrequencyBase": {
              "type": "number"
            },
            "ropeFrequencyScale": {
              "type": "number"
            },
            "temperature": {
              "type": "number"
            },
            "stop": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "tfsZ": {
              "type": "number"
            },
            "topK": {
              "type": "number"
            },
            "topP": {
              "type": "number"
            },
            "typicalP": {
              "type": "number"
            },
            "useMLock": {
              "type": "boolean"
            },
            "useMMap": {
              "type": "boolean"
            },
            "vocabOnly": {
              "type": "boolean"
            },
            "format": {
              "$ref": "#/definitions/StringWithAutocomplete%3C%22json%22%3E"
            }
          }
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
        }
      },
      "required": [
        "authentication",
        "endpoint",
        "model",
        "provider"
      ]
    },
    "StringWithAutocomplete<\"json\">": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "string",
          "enum": [
            "json"
          ]
        }
      ],
      "description": "Represents a string value with autocompleted, but not required, suggestions."
    },
    "AnthropicLLMService": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "provider": {
          "$ref": "#/definitions/LLMProvider"
        },
        "model": {
          "$ref": "#/definitions/LLMModel"
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
        }
      },
      "required": [
        "authentication",
        "model",
        "provider"
      ]
    }
  }
} as const