import { MySQL } from 'dt-sql-parser/dist/parser/mysql'
import { MySqlLexer } from 'dt-sql-parser/dist/lib/mysql/MySqlLexer'
import { MySqlParser } from 'dt-sql-parser/dist/lib/mysql/MySqlParser'

type CharStream = ConstructorParameters<typeof MySqlLexer>[0]
type TokenStream = ConstructorParameters<typeof MySqlParser>[0]
type Token = ReturnType<MySqlLexer['nextToken']>

const KEYWORD_TOKEN_NAME_PREFIX = 'KW_'

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

// dt-sql-parser re-parses inside its own error listener, so a parser built without one must stay listener-free; this drops only antlr's console listener
export class EditorMySQLParser extends MySQL {
  protected override createLexerFromCharStream(charStreams: CharStream): MySqlLexer {
    const lexer = new QualifiedNameMySqlLexer(charStreams)
    lexer.removeErrorListeners()
    return lexer
  }

  protected override createParserFromTokenStream(tokenStream: TokenStream): MySqlParser {
    const parser = new MySqlParser(tokenStream)
    parser.removeErrorListeners()
    return parser
  }
}
