/**
 * Embedded tree-sitter highlight queries.
 *
 * We ship our own compact queries rather than reading the upstream
 * `queries/highlights.scm` from the grammar packages because those are
 * dev-only dependencies (not present in a published install) and they
 * lean on `#match?` / `#is-not? local` predicates that web-tree-sitter's
 * `Query.captures()` does NOT evaluate for us — including them would
 * mis-tag every identifier. This subset is **predicate-free** (so every
 * capture is unconditionally correct) and uses only grammar-valid token
 * names (so the query compiles), distilled from the upstream TS + JS
 * `highlights.scm`.
 *
 * The same query serves `typescript` and `tsx`: the tsx grammar is a
 * superset, and every node/keyword referenced here exists in both.
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
