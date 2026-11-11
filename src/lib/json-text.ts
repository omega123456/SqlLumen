import { logParseFallback } from './app-log-commands'

const PRETTY_PRINT_INDENT = 2

export function prettyPrintJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, PRETTY_PRINT_INDENT)
  } catch (error) {
    logParseFallback('[json-text] prettyPrintJson', error)
    return value
  }
}

export function normalizeJson(value: string): string | null {
  try {
    return JSON.stringify(JSON.parse(value))
  } catch (error) {
    logParseFallback('[json-text] normalizeJson', error)
    return null
  }
}
