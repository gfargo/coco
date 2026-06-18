/**
 * Embedded tree-sitter highlight queries (one per language).
 *
 * We ship our own compact queries rather than reading the upstream
 * `queries/highlights.scm` from the grammar packages because those are
 * dev-only / not present in a published install, and they lean on
 * `#match?` / `#is-not? local` predicates that web-tree-sitter's
 * `Query.captures()` does NOT evaluate for us — including them would
 * mis-tag every identifier. These subsets are **predicate-free** (so
 * every capture is unconditionally correct) and use only grammar-valid
 * node/token names (so the query compiles — verified against the real
 * grammars), distilled from each language's upstream `highlights.scm`.
 *
 * The TS query serves both `typescript` and `tsx` (tsx is a superset).
 */
export const TS_HIGHLIGHT_QUERY = `
; Comments
(comment) @comment

; Strings
[
  (string)
  (template_string)
] @string
(regex) @string

; Numbers
(number) @number

; Types
(type_identifier) @type
(predefined_type) @type

; Literals
[
  (true)
  (false)
  (null)
  (undefined)
] @constant
(this) @keyword
(super) @keyword

; Properties
(property_identifier) @property

; Function definitions and calls (field-name patterns — no predicates)
(function_declaration
  name: (identifier) @function)
(function_expression
  name: (identifier) @function)
(method_definition
  name: (property_identifier) @function)
(call_expression
  function: (identifier) @function)
(call_expression
  function: (member_expression
    property: (property_identifier) @function))
(variable_declarator
  name: (identifier) @function
  value: [(function_expression) (arrow_function)])

; Keywords (anonymous tokens — all valid in the TS/TSX grammars)
[
  "abstract"
  "declare"
  "enum"
  "implements"
  "interface"
  "keyof"
  "namespace"
  "private"
  "protected"
  "public"
  "type"
  "readonly"
  "override"
  "satisfies"
  "as"
  "async"
  "await"
  "break"
  "case"
  "catch"
  "class"
  "const"
  "continue"
  "debugger"
  "default"
  "delete"
  "do"
  "else"
  "export"
  "extends"
  "finally"
  "for"
  "from"
  "function"
  "get"
  "if"
  "import"
  "in"
  "instanceof"
  "let"
  "new"
  "of"
  "return"
  "set"
  "static"
  "switch"
  "throw"
  "try"
  "typeof"
  "var"
  "void"
  "while"
  "with"
  "yield"
] @keyword
`.trim()

/** Python (validated against tree-sitter-python 0.23.6). */
export const PYTHON_HIGHLIGHT_QUERY = `
(comment) @comment
(string) @string
(integer) @number
(float) @number
(type) @type
(function_definition
  name: (identifier) @function)
(class_definition
  name: (identifier) @type)
(call
  function: (identifier) @function)
[ (true) (false) (none) ] @constant
[
  "def" "class" "return" "pass" "if" "elif" "else" "for" "while"
  "import" "from" "as" "with" "try" "except" "finally" "raise"
  "lambda" "yield" "global" "nonlocal" "assert" "del" "in" "not"
  "and" "or" "is" "await" "async"
] @keyword
`.trim()

/** Rust (validated against tree-sitter-rust 0.24.0). */
export const RUST_HIGHLIGHT_QUERY = `
[ (line_comment) (block_comment) ] @comment
[ (string_literal) (char_literal) (raw_string_literal) ] @string
(integer_literal) @number
(float_literal) @number
[ (primitive_type) (type_identifier) ] @type
(function_item
  name: (identifier) @function)
(call_expression
  function: (identifier) @function)
(boolean_literal) @constant
[
  "fn" "let" "const" "static" "if" "else" "match" "for" "while"
  "loop" "return" "break" "continue" "struct" "enum" "trait" "impl"
  "use" "mod" "pub" "as" "where" "in" "unsafe" "async" "await"
  "dyn" "type"
] @keyword
`.trim()

/** Go (validated against tree-sitter-go 0.25.0). */
export const GO_HIGHLIGHT_QUERY = `
(comment) @comment
[ (interpreted_string_literal) (raw_string_literal) (rune_literal) ] @string
(int_literal) @number
(float_literal) @number
(type_identifier) @type
(function_declaration
  name: (identifier) @function)
(method_declaration
  name: (field_identifier) @function)
(call_expression
  function: (identifier) @function)
(call_expression
  function: (selector_expression
    field: (field_identifier) @function))
[ (true) (false) (nil) (iota) ] @constant
[
  "func" "var" "const" "type" "struct" "interface" "map" "chan"
  "package" "import" "return" "if" "else" "for" "range" "switch"
  "case" "default" "break" "continue" "go" "defer" "select"
  "fallthrough" "goto"
] @keyword
`.trim()

/**
 * JSON (validated against tree-sitter-json 0.24.8).
 *
 * The highlighter tokenizes one diff line at a time, and a bare
 * `"key": "value",` line is NOT a valid JSON document — tree-sitter
 * recovers it as `(string) (ERROR) (string) (ERROR)`, so the `pair`
 * node never forms and keys can't be told apart from values on a
 * fragment. We therefore tag every `(string)` uniformly; numbers,
 * literals, and comments (JSONC) still stand out.
 */
export const JSON_HIGHLIGHT_QUERY = `
(comment) @comment
(string) @string
(number) @number
[ (true) (false) (null) ] @constant
`.trim()

/**
 * YAML (validated against @tree-sitter-grammars/tree-sitter-yaml 0.7.1).
 *
 * Unlike JSON, YAML is line-oriented: a single `key: value` line parses
 * into a complete `block_mapping_pair`, so we CAN distinguish keys
 * (`@property`) from value scalars by type. Block-sequence items and
 * flow collections render plain — a deliberate v1 scope; the common
 * `key: value` config shape is what carries the visual signal.
 */
export const YAML_HIGHLIGHT_QUERY = `
(comment) @comment
(integer_scalar) @number
(float_scalar) @number
(boolean_scalar) @constant
(null_scalar) @constant
[ (double_quote_scalar) (single_quote_scalar) ] @string
(block_mapping_pair key: (flow_node (plain_scalar) @property))
(block_mapping_pair value: (flow_node (plain_scalar (string_scalar) @string)))
`.trim()

/** Highlight query keyed by tree-sitter language id. */
export const HIGHLIGHT_QUERIES: Record<string, string> = {
  typescript: TS_HIGHLIGHT_QUERY,
  tsx: TS_HIGHLIGHT_QUERY,
  python: PYTHON_HIGHLIGHT_QUERY,
  rust: RUST_HIGHLIGHT_QUERY,
  go: GO_HIGHLIGHT_QUERY,
  json: JSON_HIGHLIGHT_QUERY,
  yaml: YAML_HIGHLIGHT_QUERY,
}
