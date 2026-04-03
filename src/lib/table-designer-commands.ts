import { invoke } from '@tauri-apps/api/core'
import type { GenerateDdlRequest, GenerateDdlResponse, TableDesignerSchema } from '../types/schema'

export async function loadTableForDesigner(
  connectionId: string,
  database: string,
  tableName: string
): Promise<TableDesignerSchema> {
  return invoke<TableDesignerSchema>('load_table_for_designer', {
    connectionId,
    database,
    tableName,
  })
}

export async function generateTableDdl(request: GenerateDdlRequest): Promise<GenerateDdlResponse> {
  return invoke<GenerateDdlResponse>('generate_table_ddl', { request })
}

export async function applyTableDdl(
  connectionId: string,
  database: string,
  ddl: string
): Promise<void> {
  return invoke<void>('apply_table_ddl', { connectionId, database, ddl })
}
