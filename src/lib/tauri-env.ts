/** Returns `true` when running inside a real Tauri webview with injected internals. */
export function hasTauriApis(): boolean {
  if (typeof window === 'undefined') return false
  return (
    '__TAURI_INTERNALS__' in window &&
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ != null
  )
}
