import { MySQL } from 'dt-sql-parser/dist/parser/mysql'
import { MySqlLexer } from 'dt-sql-parser/dist/lib/mysql/MySqlLexer'

type CharStream = ConstructorParameters<typeof MySqlLexer>[0]
type Token = ReturnType<MySqlLexer['nextToken']>
type ParseErrorListener = NonNullable<Parameters<MySQL['createParser']>[1]>
type MySqlParser = ReturnType<MySQL['createParser']>

const KEYWORD_TOKEN_NAME_PREFIX = 'KW_'

const SILENT_PARSE_ERROR_LISTENER: ParseErrorListener = () => {}

function isKeywordTokenName(symbolicName: string | null): boolean {
  if (symbolicName === null) {
    return false
  }
  return symbolicName.startsWith(KEYWORD_TOKEN_NAME_PREFIX)
}

function keywordTokenTypes(): ReadonlySet<number> {
  const keywordTypes = new Set<number>()
  MySqlLexer.symbolicNames.forEach((symbolicName, tokenType) => {
    if (isKeywordTokenName(symbolicName)) {
      keywordTypes.add(tokenType)
    }
  })
  return keywordTypes
}

const KEYWORD_TOKEN_TYPES = keywordTokenTypes()

// MySQL reads any word after a qualified-name period as an identifier; dt-sql-parser's grammar rejects most keywords there
class QualifiedNameMySqlLexer extends MySqlLexer {
  private previousTokenType: number | null = null

  override nextToken(): Token {
    const token = super.nextToken()
    if (token.channel !== MySqlLexer.DEFAULT_TOKEN_CHANNEL) {
      return token
    }
    if (this.isKeywordAfterDot(token)) {
      token.type = MySqlLexer.ID
    }
    this.previousTokenType = token.type
    return token
  }

  private isKeywordAfterDot(token: Token): boolean {
    const followsDot = this.previousTokenType === MySqlLexer.DOT
    return followsDot && KEYWORD_TOKEN_TYPES.has(token.type)
  }
}

export class EditorMySQLParser extends MySQL {
  protected override createLexerFromCharStream(charStreams: CharStream): MySqlLexer {
    return new QualifiedNameMySqlLexer(charStreams)
  }

  override createParser(input: string, errorListener?: ParseErrorListener): MySqlParser {
    return super.createParser(input, errorListener ?? SILENT_PARSE_ERROR_LISTENER)
  }
}
