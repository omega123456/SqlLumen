import { readFileSync } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(process.cwd(), 'src')
const THEME_HEADER = '@theme static'
const DECLARATION = /^\s*(--[a-z0-9-]+)\s*:\s*([\s\S]+?)\s*$/

export function readSourceFile(relativePath: string): string {
  return readFileSync(path.join(SRC, relativePath), 'utf8')
}

export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

interface CssWalk {
  headers: string[]
  declarations: string[]
}

function walkCssAtDepth(css: string, depth: number): CssWalk {
  const walk: CssWalk = { headers: [], declarations: [] }
  let currentDepth = 0
  let pending = ''
  for (const character of css) {
    const isAtWalkedDepth = currentDepth === depth
    if (character === '{') {
      if (isAtWalkedDepth) walk.headers.push(pending.trim())
      currentDepth += 1
      pending = ''
      continue
    }
    if (character === '}') {
      currentDepth -= 1
      pending = ''
      continue
    }
    if (character === ';' && isAtWalkedDepth) {
      walk.declarations.push(pending.trim())
      pending = ''
      continue
    }
    if (isAtWalkedDepth) pending += character
  }
  return walk
}

export function topLevelStatements(css: string): string[] {
  const withoutComments = stripCssComments(css)
  const walk = walkCssAtDepth(withoutComments, 0)
  return [...walk.declarations, ...walk.headers].filter(Boolean)
}

function themeBlockBody(css: string): string {
  const headerIndex = css.indexOf(THEME_HEADER)
  const openIndex = css.indexOf('{', headerIndex)
  let depth = 0
  for (let index = openIndex; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') depth -= 1
    if (depth === 0) return css.slice(openIndex + 1, index)
  }
  throw new Error('The @theme static block is not closed')
}

export function readThemeTokens(): Record<string, string> {
  const body = themeBlockBody(stripCssComments(readSourceFile('index.css')))
  const tokens: Record<string, string> = {}
  for (const declaration of walkCssAtDepth(body, 0).declarations) {
    const match = DECLARATION.exec(declaration)
    if (match) tokens[match[1]] = match[2].replace(/\s+/g, ' ')
  }
  return tokens
}
