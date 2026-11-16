import { BUILTIN_FUNCTION_SIGNATURES } from './builtin-function-signatures'
import { SQL_RESERVED_WORDS } from './sql-keywords/reserved-words'
import { STATEMENT_KEYWORDS_A_TO_H } from './sql-keywords/statement-keywords-a-to-h'
import { STATEMENT_KEYWORDS_I_TO_R } from './sql-keywords/statement-keywords-i-to-r'
import { STATEMENT_KEYWORDS_S_TO_Z } from './sql-keywords/statement-keywords-s-to-z'

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

export const SQL_BUILTIN_FUNCTIONS: readonly string[] = [...BUILTIN_FUNCTION_SIGNATURES.keys()]

export const SQL_RESERVED_WORDS_SET: ReadonlySet<string> = new Set(
  SQL_RESERVED_WORDS.map((keyword) => keyword.toLowerCase())
)
