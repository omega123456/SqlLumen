import type {
  ArgumentCommandMap,
  ArgumentCommandName,
  PayloadCommandMap,
  PayloadCommandName,
} from '../ipc/command-map'

export type PlaywrightIpcArgs = Record<string, unknown> | undefined

export type PluginIpcHandler = (args: PlaywrightIpcArgs) => unknown

export type PayloadCommandHandlers = {
  [TCommand in PayloadCommandName]: (payload: PayloadCommandMap[TCommand]['request']) => unknown
}

export type ArgumentCommandHandlers = {
  [TCommand in ArgumentCommandName]: (argument: ArgumentCommandMap[TCommand]['request']) => unknown
}

export type ParsedCommandHandler = (request: never) => unknown

export function returnNull(): null {
  return null
}

export function returnTrue(): boolean {
  return true
}

export function returnUndefined(): undefined {
  return undefined
}

export function returnEmptyList(): never[] {
  return []
}

export function returnAvailableStatus(): { status: string } {
  return { status: 'available' }
}
