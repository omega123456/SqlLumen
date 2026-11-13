import type { NodeType } from '../../types/schema'

const NODE_ID_SEPARATOR = ':'

function toBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)))
}

function fromBase64(encoded: string): string {
  return decodeURIComponent(escape(atob(encoded)))
}

export function makeNodeId(type: NodeType, database: string, name: string): string {
  return `${type}${NODE_ID_SEPARATOR}${toBase64(database)}${NODE_ID_SEPARATOR}${toBase64(name)}`
}

export function parseNodeId(nodeId: string): { type: NodeType; database: string; name: string } {
  const firstColon = nodeId.indexOf(NODE_ID_SEPARATOR)
  const secondColon = nodeId.indexOf(NODE_ID_SEPARATOR, firstColon + 1)
  const type = nodeId.slice(0, firstColon) as NodeType
  const database = fromBase64(nodeId.slice(firstColon + 1, secondColon))
  const name = fromBase64(nodeId.slice(secondColon + 1))
  return { type, database, name }
}

export function databaseNodeId(databaseName: string): string {
  return makeNodeId('database', databaseName, databaseName)
}
