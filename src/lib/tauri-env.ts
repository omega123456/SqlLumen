export function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

/** Returns `true` when running inside a real Tauri webview with injected internals. */
export function hasTauriApis(): boolean {
  if (!hasWindow()) return false
  return (
    '__TAURI_INTERNALS__' in window &&
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ != null
  )
}

export function isPlaywrightBuild(): boolean {
  return import.meta.env.VITE_PLAYWRIGHT === 'true'
}
