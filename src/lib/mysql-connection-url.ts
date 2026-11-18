export const DEFAULT_MYSQL_PORT = 3306

const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i
const MYSQL_PROTOCOL = 'mysql:'
const MYSQL_X_PROTOCOL = 'mysqlx:'
const IPV6_BRACKETS_PATTERN = /^\[(.*)\]$/
const PATH_SEPARATOR = '/'
const IPV6_SEPARATOR = ':'

export const MYSQL_X_REJECTED_REASON =
  'mysqlx:// URLs use the X Protocol, which SqlLumen does not support. Use a mysql:// URL.'
export const OTHER_SCHEME_REJECTED_REASON = 'Only mysql:// URLs can be added.'
export const UNREADABLE_URL_REASON = 'This URL could not be read.'
export const MISSING_HOST_REASON = 'This URL has no host.'

export interface ConnectionUrlFields {
  host: string
  port: number
  username: string
  password: string
  database: string | null
}

export type ComposerText =
  | { kind: 'search'; query: string }
  | { kind: 'rejected'; reason: string }
  | { kind: 'url'; fields: ConnectionUrlFields; ignoredOptions: string[] }

export interface ConnectionUrlTarget {
  host: string
  port: number
  username: string
  defaultDatabase: string | null
}

function rejected(reason: string): ComposerText {
  return { kind: 'rejected', reason: reason }
}

function hostWithoutBrackets(hostname: string): string {
  return hostname.replace(IPV6_BRACKETS_PATTERN, '$1')
}

function databaseFromPath(pathname: string): string | null {
  const database = decodeURIComponent(pathname.replace(PATH_SEPARATOR, ''))
  return database === '' ? null : database
}

function portFromUrl(url: URL): number {
  return url.port === '' ? DEFAULT_MYSQL_PORT : Number(url.port)
}

function fieldsFromUrl(url: URL): ConnectionUrlFields {
  return {
    host: hostWithoutBrackets(url.hostname),
    port: portFromUrl(url),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: databaseFromPath(url.pathname),
  }
}

function parsedMysqlUrl(text: string): ComposerText {
  const url = new URL(text)
  if (url.protocol === MYSQL_X_PROTOCOL) return rejected(MYSQL_X_REJECTED_REASON)
  if (url.protocol !== MYSQL_PROTOCOL) return rejected(OTHER_SCHEME_REJECTED_REASON)
  const fields = fieldsFromUrl(url)
  if (fields.host === '') return rejected(MISSING_HOST_REASON)
  return { kind: 'url', fields: fields, ignoredOptions: [...url.searchParams.keys()] }
}

export function parseConnectionComposerText(text: string): ComposerText {
  const trimmed = text.trim()
  if (!URL_SCHEME_PATTERN.test(trimmed)) return { kind: 'search', query: trimmed }
  try {
    return parsedMysqlUrl(trimmed)
  } catch {
    return rejected(UNREADABLE_URL_REASON)
  }
}

function hostForUrl(host: string): string {
  return host.includes(IPV6_SEPARATOR) ? `[${host}]` : host
}

function databasePath(database: string | null): string {
  if (!database) return ''
  return PATH_SEPARATOR + encodeURIComponent(database)
}

function userInfo(username: string): string {
  if (username === '') return ''
  return `${encodeURIComponent(username)}@`
}

export function formatConnectionUrl(target: ConnectionUrlTarget): string {
  const authority = `${userInfo(target.username)}${hostForUrl(target.host)}:${target.port}`
  return `mysql://${authority}${databasePath(target.defaultDatabase)}`
}
