import type { KeyboardEvent } from 'react'
import type * as Monaco from 'monaco-editor'
import { isEquivalentJson } from '../../../lib/json-text'
import { isNullish } from '../../../lib/value-checks'
import type { CellEditorBaseProps } from '../grid-cell-editors'

const MONACO_INTERNAL_MOUSE_TARGETS =
  '.monaco-scrollable-element, .scrollbar, .slider, .margin, .glyph-margin, .line-numbers'

export const JSON_EDITOR_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  lineNumbers: 'off',
  scrollBeyondLastLine: false,
  wordWrap: 'off',
  tabSize: 2,
  contextmenu: false,
  quickSuggestions: false,
}

export function resolveCommittedValue(
  originalValue: string | null,
  editorValue: string
): string | null {
  if (originalValue === null) {
    return editorValue
  }

  if (isEquivalentJson(originalValue, editorValue)) {
    return originalValue
  }

  return editorValue === originalValue ? originalValue : editorValue
}

export function getJsonFallbackValue(
  originalValue: string | null,
  prettyPrintedOriginal: string
): string {
  if (originalValue !== null) {
    return prettyPrintedOriginal
  }

  return '{}'
}

export function getCurrentDomTheme(): 'light' | 'dark' {
  const theme = document.documentElement.getAttribute('data-theme')
  return theme === 'dark' ? 'dark' : 'light'
}

export function isCommitKeybinding(event: KeyboardEvent<HTMLDivElement>): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey)
}

export function isMonacoInternalMouseTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(target.closest(MONACO_INTERNAL_MOUSE_TARGETS))
}

export function isNullToggleTarget(
  target: EventTarget | null,
  wrapper: HTMLDivElement | null
): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (wrapper == null) return false

  const toggle = target.closest('.td-null-toggle')
  return toggle != null && wrapper.contains(toggle)
}

export function resolveRestoreValue(props: CellEditorBaseProps): unknown {
  const hasExplicitRestoreValue = Object.prototype.hasOwnProperty.call(props, 'cancelRestoreValue')
  if (hasExplicitRestoreValue) return props.cancelRestoreValue
  return props.row[props.column.key]
}

export function originalJsonText(restoreValue: unknown): string | null {
  if (isNullish(restoreValue)) return null
  return String(restoreValue)
}
