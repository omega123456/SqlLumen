import { invoke } from '@tauri-apps/api/core'
import type { AppInfo } from '../types/schema'

/**
 * Get application info (version, log directory, RUST_LOG override status).
 */
export async function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>('get_app_info')
}
