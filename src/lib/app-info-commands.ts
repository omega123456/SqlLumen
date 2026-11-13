import type { AppInfo } from '../types/schema'
import { invokeArgumentCommand, NO_ARGUMENTS } from './ipc/dispatch'

export async function getAppInfo(): Promise<AppInfo> {
  return invokeArgumentCommand({ command: 'get_app_info', argument: NO_ARGUMENTS })
}
