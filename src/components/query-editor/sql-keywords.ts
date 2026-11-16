import { BUILTIN_FUNCTION_SIGNATURES } from './builtin-function-signatures'
import { SQL_RESERVED_WORDS } from './sql-keywords/reserved-words'
import { STATEMENT_START_KEYWORDS } from './sql-keywords/statement-start-keywords'

export const SQL_KEYWORDS: readonly string[] = [
  ...new Set([...STATEMENT_START_KEYWORDS, ...SQL_RESERVED_WORDS]),
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
