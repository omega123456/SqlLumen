export type ThemeName = 'light' | 'dark'

const DARK_THEME_CLASS = 'dark'
const CLASS_ATTRIBUTE = 'class'

function rootElement(): HTMLElement {
  return document.documentElement
}

export function currentTheme(): ThemeName {
  if (rootElement().classList.contains(DARK_THEME_CLASS)) return 'dark'
  return 'light'
}

export function applyResolvedTheme(theme: ThemeName): void {
  rootElement().classList.toggle(DARK_THEME_CLASS, theme === 'dark')
}

export function readToken(name: string): string {
  return getComputedStyle(rootElement()).getPropertyValue(name).trim()
}

export function readPixelToken(name: string, fallbackPixels: number): number {
  return parseFloat(readToken(name)) || fallbackPixels
}

export function readThemeColor(name: string): string {
  return readToken(`--color-${currentTheme()}-${name}`)
}

export function observeThemeChange(onChange: () => void): () => void {
  let observedTheme = currentTheme()
  const observer = new MutationObserver(() => {
    const changedTheme = currentTheme()
    if (changedTheme === observedTheme) return
    observedTheme = changedTheme
    onChange()
  })
  observer.observe(rootElement(), { attributes: true, attributeFilter: [CLASS_ATTRIBUTE] })
  return () => observer.disconnect()
}
