export function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

export function hasTauriApis(): boolean {
  if (!hasWindow()) return false
  return window.__TAURI_INTERNALS__ != null
}

export function isPlaywrightBuild(): boolean {
  return import.meta.env.VITE_PLAYWRIGHT === 'true'
}
