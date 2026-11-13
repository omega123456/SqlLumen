import type { GenerateDdlRequest, GenerateDdlResponse, TableDesignerSchema } from '../types/schema'
import { invokeArgumentCommand, invokeCommand } from './ipc/dispatch'

export async function loadTableForDesigner(
  connectionId: string,
  database: string,
  tableName: string
): Promise<TableDesignerSchema> {
  return invokeCommand({
    command: 'load_table_for_designer',
    payload: { connectionId, database, tableName },
  })
}

export async function generateTableDdl(request: GenerateDdlRequest): Promise<GenerateDdlResponse> {
  return invokeArgumentCommand({ command: 'generate_table_ddl', argument: { request } })
}

export async function applyTableDdl(
  connectionId: string,
  database: string,
  ddl: string
): Promise<void> {
  return invokeCommand({ command: 'apply_table_ddl', payload: { connectionId, database, ddl } })
}
