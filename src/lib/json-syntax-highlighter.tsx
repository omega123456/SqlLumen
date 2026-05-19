import type { ReactNode } from 'react'

type JsonTokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation'

type JsonTokenClassNameMap = Partial<Record<JsonTokenKind, string>>

export class JsonSyntaxHighlighter {
  private static readonly TOKEN_REGEX =
    /("(?:[^"\\]|\\.)*")(?=\s*:)|("(?:[^"\\]|\\.)*")|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}[\]:,]/g

  private static joinClasses(...parts: Array<string | undefined>): string {
    return parts.filter(Boolean).join(' ')
  }

  private static renderToken(
    token: string,
    key: string,
    classNames: JsonTokenClassNameMap = {}
  ): ReactNode {
    if (token === 'true' || token === 'false') {
      return (
        <span
          key={key}
          className={JsonSyntaxHighlighter.joinClasses(classNames.boolean, 'boolean')}
        >
          {token}
        </span>
      )
    }

    if (token === 'null') {
      return (
        <span key={key} className={JsonSyntaxHighlighter.joinClasses(classNames.null, 'null')}>
          {token}
        </span>
      )
    }

    if (/^[{}[\]:,]$/.test(token)) {
      return (
        <span
          key={key}
          className={JsonSyntaxHighlighter.joinClasses(classNames.punctuation, 'punctuation')}
        >
          {token}
        </span>
      )
    }

    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) {
      return (
        <span key={key} className={JsonSyntaxHighlighter.joinClasses(classNames.number, 'number')}>
          {token}
        </span>
      )
    }

    return (
      <span key={key} className={JsonSyntaxHighlighter.joinClasses(classNames.string, 'string')}>
        {token}
      </span>
    )
  }

  static highlightJson(json: string, classNames?: JsonTokenClassNameMap): ReactNode[] {
    const nodes: ReactNode[] = []
    let lastIndex = 0
    let matchIndex = 0

    for (const match of json.matchAll(JsonSyntaxHighlighter.TOKEN_REGEX)) {
      const index = match.index ?? 0
      const token = match[0]
      const keyToken = match[1]

      if (index > lastIndex) {
        nodes.push(json.slice(lastIndex, index))
      }

      if (keyToken) {
        nodes.push(
          <span
            key={`token-${matchIndex}`}
            className={JsonSyntaxHighlighter.joinClasses(classNames?.key, 'key')}
          >
            {keyToken}
          </span>
        )
      } else {
        nodes.push(
          JsonSyntaxHighlighter.renderToken(token, `token-${matchIndex}`, classNames ?? {})
        )
      }

      lastIndex = index + token.length
      matchIndex += 1
    }

    if (lastIndex < json.length) {
      nodes.push(json.slice(lastIndex))
    }

    return nodes
  }
}
