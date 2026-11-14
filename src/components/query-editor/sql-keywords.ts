import { GENERAL_FUNCTION_NAMES } from './sql-keywords/general-function-names'
import { GEOMETRY_AND_MYSQL_FUNCTION_NAMES } from './sql-keywords/geometry-and-mysql-function-names'
import { SQL_RESERVED_WORDS } from './sql-keywords/reserved-words'
import { STATEMENT_KEYWORDS_A_TO_H } from './sql-keywords/statement-keywords-a-to-h'
import { STATEMENT_KEYWORDS_I_TO_R } from './sql-keywords/statement-keywords-i-to-r'
import { STATEMENT_KEYWORDS_S_TO_Z } from './sql-keywords/statement-keywords-s-to-z'

/**
 * Centralised SQL keyword and built-in function lists.
 *
 * - `SQL_KEYWORDS` — uppercase MySQL 8.4 keyword list used for fallback
 *   completions. These are rendered as `CompletionItemKind.Keyword` in the editor.
 *   Sourced from the MySQL 8.4 Keywords and Reserved Words reference so stored
 *   programs, transaction control, and newer clause keywords are covered.
 * - `SQL_BUILTIN_FUNCTIONS` — uppercase MySQL/MariaDB built-in function names used
 *   for fallback completions. These are rendered as `CompletionItemKind.Function`.
 *   Sourced from the MariaDB Functions & Operators reference plus MySQL 8.4's
 *   built-in function reference to cover server-specific functions on both engines.
 * - `SQL_RESERVED_WORDS_SET` — lowercase Set used to filter out reserved words
 *   that cannot be table aliases. This intentionally tracks MySQL's reserved-word
 *   subset rather than every keyword so nonreserved identifiers remain valid aliases.
 */

// ---------------------------------------------------------------------------
// SQL statement keywords (uppercase — used for completion items)
// ---------------------------------------------------------------------------

export const SQL_KEYWORDS: readonly string[] = [
  ...STATEMENT_KEYWORDS_A_TO_H,
  ...STATEMENT_KEYWORDS_I_TO_R,
  ...STATEMENT_KEYWORDS_S_TO_Z,
]

export const STORED_PROGRAM_BODY_KEYWORDS: readonly string[] = [
  'CALL',
  'CASE',
  'CLOSE',
  'CONDITION',
  'CONTINUE',
  'CURSOR',
  'DECLARE',
  'ELSE',
  'ELSEIF',
  'EXIT',
  'FETCH',
  'HANDLER',
  'IF',
  'ITERATE',
  'LEAVE',
  'LOOP',
  'OPEN',
  'REPEAT',
  'RESIGNAL',
  'RETURN',
  'SIGNAL',
  'THEN',
  'UNTIL',
  'WHEN',
  'WHILE',
]

// ---------------------------------------------------------------------------
// MySQL/MariaDB built-in functions (uppercase — used for completion items)
//
// Sourced from the MariaDB Functions & Operators reference and MySQL 8.4's
// built-in function reference:
//   https://mariadb.com/docs/server/reference/sql-functions/
//   https://dev.mysql.com/doc/refman/8.4/en/built-in-function-reference.html
// Excludes: pure symbol operators, multi-word operator phrases,
//           SYS.* schema-qualified stored functions, and internal-only functions.
// Single-word operator keywords such as DIV/REGEXP/RLIKE/XOR are covered by
// SQL_KEYWORDS; BINARY remains here because MySQL documents it as both an
// operator keyword and a cast-like built-in.
// ---------------------------------------------------------------------------

export const SQL_BUILTIN_FUNCTIONS: readonly string[] = [
  ...GENERAL_FUNCTION_NAMES,
  ...GEOMETRY_AND_MYSQL_FUNCTION_NAMES,
]

// ---------------------------------------------------------------------------
// Reserved-word Set (lowercase — used by alias resolver to reject aliases
// that are actually SQL keywords)
// ---------------------------------------------------------------------------

export const SQL_RESERVED_WORDS_SET: ReadonlySet<string> = new Set(
  SQL_RESERVED_WORDS.map((keyword) => keyword.toLowerCase())
)
