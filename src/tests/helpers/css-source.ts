import { readFileSync } from 'node:fs'
import path from 'node:path'

// Vitest stubs CSS imports (including ?raw) to empty strings, so read the sources directly.
const SRC = path.resolve(process.cwd(), 'src')

/**
 * Returns the declarations of the first rule whose selector list is exactly `selector`
 * in `src/<file>`, with comments stripped and whitespace collapsed.
 */
export function cssRule(file: string, selector: string): string {
  const css = readFileSync(path.join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].replace(/\s+/g, ' ').trim() === selector) {
      return match[2].replace(/\s+/g, ' ').trim()
    }
  }
  throw new Error(`No rule "${selector}" in ${file}`)
}
