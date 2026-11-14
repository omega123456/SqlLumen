import { useMemo } from 'react'
import type * as MonacoType from 'monaco-editor'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../../stores/settings-store'

const DEFAULT_EDITOR_FONT_SIZE = Number(SETTINGS_DEFAULTS['editor.fontSize'])
const DEFAULT_EDITOR_LINE_HEIGHT = Number(SETTINGS_DEFAULTS['editor.lineHeight'])
const DECIMAL_RADIX = 10

const STATIC_EDITOR_OPTIONS: MonacoType.editor.IStandaloneEditorConstructionOptions = {
  suggestFontSize: 14,
  suggestLineHeight: 36,
  scrollBeyondLastLine: false,
  tabSize: 2,
  insertSpaces: true,
  automaticLayout: true,
  fixedOverflowWidgets: true,
  padding: { top: 8, bottom: 16 },
  lineNumbersMinChars: 4,
  lineDecorationsWidth: 14,
  showFoldingControls: 'never',
  renderLineHighlight: 'line',
  renderLineHighlightOnlyWhenFocus: true,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  scrollbar: {
    vertical: 'auto',
    horizontal: 'auto',
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
  },
  suggest: {
    showIcons: true,
    showWords: false,
  },
  parameterHints: { enabled: true },
  quickSuggestions: {
    other: true,
    comments: false,
    strings: false,
  },
}

function useEditorSettings() {
  const fontFamily = useSettingsStore((state) => state.getSetting('editor.fontFamily'))
  const fontSize = useSettingsStore((state) =>
    parseInt(state.getSetting('editor.fontSize'), DECIMAL_RADIX)
  )
  const lineHeight = useSettingsStore((state) => parseFloat(state.getSetting('editor.lineHeight')))
  const wordWrap = useSettingsStore((state) => state.getSetting('editor.wordWrap')) === 'true'
  const minimap = useSettingsStore((state) => state.getSetting('editor.minimap')) === 'true'
  const lineNumbers = useSettingsStore((state) => state.getSetting('editor.lineNumbers')) === 'true'
  return { fontFamily, fontSize, lineHeight, wordWrap, minimap, lineNumbers }
}

export function useEditorOptions(isReadOnly: boolean) {
  const { fontFamily, fontSize, lineHeight, wordWrap, minimap, lineNumbers } = useEditorSettings()
  return useMemo(() => {
    const effectiveFontSize = fontSize || DEFAULT_EDITOR_FONT_SIZE
    return {
      ...STATIC_EDITOR_OPTIONS,
      readOnly: isReadOnly,
      fontSize: effectiveFontSize,
      lineHeight: effectiveFontSize * (lineHeight || DEFAULT_EDITOR_LINE_HEIGHT),
      fontFamily: `'${fontFamily}', 'Fira Code', ui-monospace, monospace`,
      minimap: { enabled: minimap },
      lineNumbers: lineNumbers ? ('on' as const) : ('off' as const),
      wordWrap: wordWrap ? ('on' as const) : ('off' as const),
    }
  }, [isReadOnly, fontSize, lineHeight, fontFamily, minimap, lineNumbers, wordWrap])
}
