import type { InvokeArgs } from '@tauri-apps/api/core'
import {
  APP_ARGUMENT_HANDLERS,
  APP_PAYLOAD_HANDLERS,
  CONNECTION_ARGUMENT_HANDLERS,
  CONNECTION_PAYLOAD_HANDLERS,
  COPY_TO_HOST_ARGUMENT_HANDLERS,
  SCHEMA_ARGUMENT_HANDLERS,
  SCHEMA_PAYLOAD_HANDLERS,
} from './playwright-ipc-mock/app-and-schema-handlers'
import { TAURI_PLUGIN_HANDLERS } from './playwright-ipc-mock/mock-events'
import { returnNull } from './playwright-ipc-mock/mock-handler-types'
import type {
  ArgumentCommandHandlers,
  ParsedCommandHandler,
  PayloadCommandHandlers,
} from './playwright-ipc-mock/mock-handler-types'
import {
  AI_ARGUMENT_HANDLERS,
  AI_PAYLOAD_HANDLERS,
  DUMP_AND_IMPORT_ARGUMENT_HANDLERS,
  DUMP_AND_IMPORT_PAYLOAD_HANDLERS,
  OBJECT_EDITOR_ARGUMENT_HANDLERS,
  OBJECT_EDITOR_PAYLOAD_HANDLERS,
  PROCESS_LIST_AND_HISTORY_ARGUMENT_HANDLERS,
  PROCESS_LIST_AND_HISTORY_PAYLOAD_HANDLERS,
  QUERY_ARGUMENT_HANDLERS,
  QUERY_PAYLOAD_HANDLERS,
  SESSION_SNAPSHOT_ARGUMENT_HANDLERS,
  SESSION_SNAPSHOT_PAYLOAD_HANDLERS,
  TABLE_DATA_ARGUMENT_HANDLERS,
  TABLE_DATA_PAYLOAD_HANDLERS,
} from './playwright-ipc-mock/query-and-data-handlers'
export { resetPlaywrightSessionAllocator } from './playwright-ipc-mock/mock-session-state'

const PAYLOAD_COMMAND_HANDLERS: PayloadCommandHandlers = {
  ...APP_PAYLOAD_HANDLERS,
  ...CONNECTION_PAYLOAD_HANDLERS,
  ...SCHEMA_PAYLOAD_HANDLERS,
  ...QUERY_PAYLOAD_HANDLERS,
  ...TABLE_DATA_PAYLOAD_HANDLERS,
  ...OBJECT_EDITOR_PAYLOAD_HANDLERS,
  ...DUMP_AND_IMPORT_PAYLOAD_HANDLERS,
  ...PROCESS_LIST_AND_HISTORY_PAYLOAD_HANDLERS,
  ...AI_PAYLOAD_HANDLERS,
  ...SESSION_SNAPSHOT_PAYLOAD_HANDLERS,
}

const ARGUMENT_COMMAND_HANDLERS: ArgumentCommandHandlers = {
  ...APP_ARGUMENT_HANDLERS,
  ...CONNECTION_ARGUMENT_HANDLERS,
  ...SCHEMA_ARGUMENT_HANDLERS,
  ...COPY_TO_HOST_ARGUMENT_HANDLERS,
  ...QUERY_ARGUMENT_HANDLERS,
  ...TABLE_DATA_ARGUMENT_HANDLERS,
  ...OBJECT_EDITOR_ARGUMENT_HANDLERS,
  ...DUMP_AND_IMPORT_ARGUMENT_HANDLERS,
  ...PROCESS_LIST_AND_HISTORY_ARGUMENT_HANDLERS,
  ...AI_ARGUMENT_HANDLERS,
  ...SESSION_SNAPSHOT_ARGUMENT_HANDLERS,
}

const PAYLOAD_HANDLERS_BY_COMMAND = new Map<string, ParsedCommandHandler>(
  Object.entries(PAYLOAD_COMMAND_HANDLERS)
)

const ARGUMENT_HANDLERS_BY_COMMAND = new Map<string, ParsedCommandHandler>(
  Object.entries(ARGUMENT_COMMAND_HANDLERS)
)

function isArgumentRecord(args: InvokeArgs | undefined): args is Record<string, unknown> {
  if (args === undefined) return false
  if (Array.isArray(args)) return false
  if (args instanceof ArrayBuffer) return false
  return !(args instanceof Uint8Array)
}

export function playwrightIpcMockHandler(command: string, invokeArgs?: InvokeArgs): unknown {
  const args = isArgumentRecord(invokeArgs) ? invokeArgs : undefined

  const payloadHandler = PAYLOAD_HANDLERS_BY_COMMAND.get(command)
  if (payloadHandler) return payloadHandler(args?.payload as never)

  const argumentHandler = ARGUMENT_HANDLERS_BY_COMMAND.get(command)
  if (argumentHandler) return argumentHandler(args as never)

  const pluginHandler = TAURI_PLUGIN_HANDLERS[command] ?? returnNull
  return pluginHandler(args)
}
