import type * as Monaco from 'monaco-editor'

export type MonacoThemeName = 'precision-studio-dark' | 'precision-studio-light'

const registeredInstances = new WeakSet<typeof Monaco>()

const BRACKET_HIGHLIGHT_LEVEL_COUNT = 6
const BRACKET_HIGHLIGHT_LEVELS = Array.from(
  { length: BRACKET_HIGHLIGHT_LEVEL_COUNT },
  (_, levelOffset) => levelOffset + 1
)

interface MonacoPalette {
  base: 'vs' | 'vs-dark'
  well: string
  text: string
  keyword: string
  string: string
  number: string
  quotedIdentifier: string
  comment: string
  builtin: string
  table: string
  column: string
  lineNumber: string
  currentLine: string
  accent: string
  selection: string
  card: string
  cardText: string
  flyoutStroke: string
  neutralSelected: string
  subtleHover: string
  controlFill: string
  controlStroke: string
  scrollbar: string
  scrollbarHover: string
}

const DARK: MonacoPalette = {
  base: 'vs-dark',
  well: '#1c1c1c',
  text: '#d4d4d4',
  keyword: '#569cd6',
  string: '#ce9178',
  number: '#b5cea8',
  quotedIdentifier: '#9cdcfe',
  comment: '#6a9955',
  builtin: '#dcdcaa',
  table: '#4ec9b0',
  column: '#9cdcfe',
  lineNumber: '#6e7681',
  currentLine: '#ffffff0a',
  accent: '#4cc2ff',
  selection: '#4cc2ff26',
  card: '#2c2c2c',
  cardText: '#ffffff',
  flyoutStroke: '#00000059',
  neutralSelected: '#ffffff12',
  subtleHover: '#ffffff0f',
  controlFill: '#ffffff0f',
  controlStroke: '#ffffff12',
  scrollbar: '#717171',
  scrollbarHover: '#9d9d9d',
}

const LIGHT: MonacoPalette = {
  base: 'vs',
  well: '#ffffff',
  text: '#1b1b1b',
  keyword: '#0000ff',
  string: '#a31515',
  number: '#098658',
  quotedIdentifier: '#001080',
  comment: '#008000',
  builtin: '#795e26',
  table: '#267f99',
  column: '#001080',
  lineNumber: '#8c8c8c',
  currentLine: '#00000009',
  accent: '#0067c0',
  selection: '#0067c01c',
  card: '#ffffff',
  cardText: '#1b1b1b',
  flyoutStroke: '#0000001a',
  neutralSelected: '#0000000f',
  subtleHover: '#0000000a',
  controlFill: '#ffffffb3',
  controlStroke: '#00000014',
  scrollbar: '#a3a3a3',
  scrollbarHover: '#6e6e6e',
}

function hex(color: string): string {
  return color.slice(1)
}

function tokenRules(palette: MonacoPalette): Monaco.editor.ITokenThemeRule[] {
  return [
    { token: '', foreground: hex(palette.text), background: hex(palette.well) },
    { token: 'keyword', foreground: hex(palette.keyword) },
    { token: 'keyword.sql', foreground: hex(palette.keyword) },
    { token: 'operator', foreground: hex(palette.text) },
    { token: 'operator.keyword', foreground: hex(palette.keyword) },
    { token: 'operator.star', foreground: hex(palette.keyword) },
    { token: 'keyword.scope', foreground: hex(palette.keyword) },
    { token: 'type', foreground: hex(palette.keyword) },
    { token: 'string', foreground: hex(palette.string) },
    { token: 'string.sql', foreground: hex(palette.string) },
    { token: 'number', foreground: hex(palette.number) },
    { token: 'number.sql', foreground: hex(palette.number) },
    { token: 'comment', foreground: hex(palette.comment) },
    { token: 'comment.sql', foreground: hex(palette.comment) },
    { token: 'comment.block', foreground: hex(palette.comment) },
    { token: 'predefined', foreground: hex(palette.builtin) },
    { token: 'predefined.sql', foreground: hex(palette.builtin) },
    { token: 'identifier', foreground: hex(palette.text) },
    { token: 'identifier.quote', foreground: hex(palette.quotedIdentifier) },
    { token: 'identifier.quote.sql', foreground: hex(palette.quotedIdentifier) },
    { token: 'delimiter', foreground: hex(palette.text) },
    { token: 'database', foreground: hex(palette.table) },
    { token: 'table', foreground: hex(palette.table) },
    { token: 'tableAlias', foreground: hex(palette.table) },
    { token: 'column', foreground: hex(palette.column) },
    { token: 'columnAlias', foreground: hex(palette.column) },
    { token: 'function', foreground: hex(palette.builtin) },
  ]
}

function editorColors(palette: MonacoPalette): Monaco.editor.IColors {
  return {
    'editor.background': palette.well,
    'editor.foreground': palette.text,
    'editor.lineHighlightBackground': palette.currentLine,
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': palette.selection,
    'editor.inactiveSelectionBackground': palette.selection,
    'editor.selectionHighlightBackground': palette.neutralSelected,
    'editor.wordHighlightBackground': palette.neutralSelected,
    'editor.wordHighlightStrongBackground': palette.neutralSelected,
    'editorCursor.foreground': palette.accent,
    ...Object.fromEntries(
      BRACKET_HIGHLIGHT_LEVELS.map((level) => [
        `editorBracketHighlight.foreground${level}`,
        palette.text,
      ])
    ),
  }
}

function widgetColors(palette: MonacoPalette): Monaco.editor.IColors {
  return {
    'editorLineNumber.foreground': palette.lineNumber,
    'editorLineNumber.activeForeground': palette.lineNumber,
    'editorIndentGuide.background1': palette.controlStroke,
    'editorIndentGuide.activeBackground1': palette.lineNumber,
    'editorGutter.background': palette.well,
    'editorWidget.background': palette.card,
    'editorWidget.foreground': palette.cardText,
    'editorWidget.border': palette.flyoutStroke,
    'editorSuggestWidget.background': palette.card,
    'editorSuggestWidget.border': palette.flyoutStroke,
    'editorSuggestWidget.foreground': palette.cardText,
    'editorSuggestWidget.selectedForeground': palette.cardText,
    'editorSuggestWidget.selectedIconForeground': palette.accent,
    'editorSuggestWidget.selectedBackground': palette.neutralSelected,
    'editorSuggestWidget.highlightForeground': palette.accent,
    'editorSuggestWidget.focusHighlightForeground': palette.accent,
    'editorHoverWidget.background': palette.card,
    'editorHoverWidget.foreground': palette.cardText,
    'editorHoverWidget.border': palette.flyoutStroke,
    'editorHoverWidget.highlightForeground': palette.accent,
    'editorHoverWidget.statusBarBackground': palette.card,
    'list.hoverBackground': palette.subtleHover,
    'input.background': palette.controlFill,
    'input.foreground': palette.cardText,
    'input.border': palette.controlStroke,
    focusBorder: palette.accent,
    'scrollbarSlider.background': palette.scrollbar,
    'scrollbarSlider.hoverBackground': palette.scrollbarHover,
    'scrollbarSlider.activeBackground': palette.scrollbarHover,
  }
}

function buildMonacoTheme(palette: MonacoPalette): Monaco.editor.IStandaloneThemeData {
  return {
    base: palette.base,
    inherit: true,
    rules: tokenRules(palette),
    colors: { ...editorColors(palette), ...widgetColors(palette) },
  }
}

export const MONACO_THEMES: Record<MonacoThemeName, Monaco.editor.IStandaloneThemeData> = {
  'precision-studio-dark': buildMonacoTheme(DARK),
  'precision-studio-light': buildMonacoTheme(LIGHT),
}

export function registerMonacoThemes(monaco: typeof Monaco): void {
  if (registeredInstances.has(monaco)) return
  registeredInstances.add(monaco)

  for (const [name, data] of Object.entries(MONACO_THEMES)) {
    monaco.editor.defineTheme(name, data)
  }
}

export function getMonacoThemeName(
  theme: 'light' | 'dark' | 'system',
  systemIsDark: boolean
): MonacoThemeName {
  const isDark = theme === 'system' ? systemIsDark : theme === 'dark'
  return isDark ? 'precision-studio-dark' : 'precision-studio-light'
}
