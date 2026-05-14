import type {
  checkbox as inquirerCheckbox,
  confirm as inquirerConfirm,
  editor as inquirerEditor,
  input as inquirerInput,
  password as inquirerPassword,
  select as inquirerSelect,
} from '@inquirer/prompts'

type InquirerPromptsModule = {
  checkbox: typeof inquirerCheckbox
  confirm: typeof inquirerConfirm
  editor: typeof inquirerEditor
  input: typeof inquirerInput
  password: typeof inquirerPassword
  select: typeof inquirerSelect
}

const dynamicImport = new Function('specifier', 'return import(specifier)') as <
  T
>(specifier: string) => Promise<T>

let promptsPromise: Promise<InquirerPromptsModule> | undefined

export function loadInquirerPrompts(): Promise<InquirerPromptsModule> {
  if (!promptsPromise) {
    promptsPromise = dynamicImport<InquirerPromptsModule>('@inquirer/prompts')
  }

  return promptsPromise
}

export async function confirmPrompt(
  ...args: Parameters<typeof inquirerConfirm>
): ReturnType<typeof inquirerConfirm> {
  const { confirm } = await loadInquirerPrompts()

  return confirm(...args)
}

export async function editorPrompt(
  ...args: Parameters<typeof inquirerEditor>
): ReturnType<typeof inquirerEditor> {
  const { editor } = await loadInquirerPrompts()

  return editor(...args)
}

export async function inputPrompt(
  ...args: Parameters<typeof inquirerInput>
): ReturnType<typeof inquirerInput> {
  const { input } = await loadInquirerPrompts()

  return input(...args)
}

export async function passwordPrompt(
  ...args: Parameters<typeof inquirerPassword>
): ReturnType<typeof inquirerPassword> {
  const { password } = await loadInquirerPrompts()

  return password(...args)
}

export async function selectPrompt<Value>(
  ...args: [config: unknown, context?: unknown]
): Promise<Value> {
  const { select } = await loadInquirerPrompts()

  return (select as (config: unknown, context?: unknown) => Promise<Value>)(...args)
}

export async function checkboxPrompt<Value>(
  ...args: [config: unknown, context?: unknown]
): Promise<Value[]> {
  const { checkbox } = await loadInquirerPrompts()

  return (checkbox as (config: unknown, context?: unknown) => Promise<Value[]>)(...args)
}
