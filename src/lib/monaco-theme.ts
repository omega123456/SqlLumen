/**
 * Monaco Editor theme definitions.
 *
 * Monaco's theme API can't read CSS custom properties, so the values are hex copies of the
 * Fluent proposal (`.agent/plans/2026-10-19_fluent-redesign_proposal/index.html`):
 *
 * - Syntax: the prototype's `--sx-*` values, which are the VS Code Dark+ / Light+ palettes.
 *   Keywords, keyword operators (AND, OR, IN…), data types and `*` (its own `operator.star`
 *   token, see mysql-language-setup.ts) use `--sx-kw`; back-quoted identifiers `--sx-id`;
 *   plain identifiers, punctuation and other operator symbols `--sx-op`, as in the rendered
 *   prototype. Comments and
 *   built-in functions, which the prototype doesn't show, use the Dark+ / Light+ values.
 * - Surfaces: editor and gutter on the well (`--surface-container-lowest`), current line
 *   `--sx-cur`, line numbers `--sx-ln`, caret the accent (`--primary`), selection the accent
 *   tint (`--fill-accent-tint`).
 * - Widgets (suggest, hover): the card surface (`--surface-container-high`) with the flyout
 *   stroke, the neutral selected fill and accent highlights.
 *
 * Keep these in step with the `--token-*` values in `src/styles/tokens.css`.
 */

import type * as Monaco from 'monaco-editor'

export type MonacoThemeName = 'precision-studio-dark' | 'precision-studio-light'

// Re-defining the active theme makes Monaco rewrite its global stylesheet and
// repaint every editor, so each Monaco instance only gets its themes once.
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

// Dark: --surface-container-lowest #1c1c1c, --sx-op #d4d4d4, --sx-kw #569cd6, --sx-str #ce9178,
// --sx-num #b5cea8, --sx-id #9cdcfe, --sx-ln #6e7681, --sx-cur rgba(255,255,255,.04),
// --primary #4cc2ff, --fill-accent-tint rgba(76,194,255,.15), --surface-container-high #2c2c2c,
// --stroke-flyout rgba(0,0,0,.35), --fill-neutral-selected rgba(255,255,255,.07),
// --fill-subtle-hover rgba(255,255,255,.06), --fill-control rgba(255,255,255,.06),
// --stroke-control rgba(255,255,255,.07), --scrollbar-thumb #717171 / hover #9d9d9d.
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

// Light: --surface-container-lowest #ffffff, --sx-op #1b1b1b, --sx-kw #0000ff, --sx-str #a31515,
// --sx-num #098658, --sx-id #001080, --sx-ln #8c8c8c, --sx-cur rgba(0,0,0,.035),
// --primary #0067c0, --fill-accent-tint rgba(0,103,192,.11), --surface-container-high #ffffff,
// --stroke-flyout rgba(0,0,0,.1), --fill-neutral-selected rgba(0,0,0,.06),
// --fill-subtle-hover rgba(0,0,0,.04), --fill-control rgba(255,255,255,.7),
// --stroke-control rgba(0,0,0,.08), --scrollbar-thumb #a3a3a3 / hover #6e6e6e.
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

function buildMonacoTheme(palette: MonacoPalette): Monaco.editor.IStandaloneThemeData {
  return {
    base: palette.base,
    inherit: true,
    rules: [
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
    ],
    colors: {
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
      // Brackets stay plain code text (prototype `--sx-op`); matching still highlights the pair.
      ...Object.fromEntries(
        BRACKET_HIGHLIGHT_LEVELS.map((level) => [
          `editorBracketHighlight.foreground${level}`,
          palette.text,
        ])
      ),
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
    },
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
