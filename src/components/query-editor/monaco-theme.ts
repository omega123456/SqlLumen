/**
 * Monaco Editor theme definitions.
 * These use hex color values because Monaco's theme API does not accept CSS custom properties.
 * Values are derived from design system tokens documented in src/styles/tokens.css:
 *
 * Dark theme ("precision-studio-dark"):
 *   --surface (#0b1326) → editor background
 *   --primary (#7bd0ff) → keywords
 *   --tertiary (#4ae176) → strings
 *   --secondary (#b9c8de) → identifiers
 *   --on-surface-variant (#c0c7d3) → comments
 *   --surface-container-high (#222a3d) → line highlight
 *   --surface-container-highest (#2d3449) → selection
 *
 * Light theme ("precision-studio-light"):
 *   --surface-container-lowest (#ffffff) → editor background
 *   --primary (#0066CC) → keywords (bold weight)
 *   strings → #2E7D32 (green)
 *   table refs/identifiers → #793000 (dark brown)
 *   --on-surface (#191c1e) → text
 *   --surface-container-low (#f2f4f6) → line highlight
 *   --surface-container (#f2f4f6) → selection
 */

import type * as Monaco from 'monaco-editor'

export type MonacoThemeName = 'precision-studio-dark' | 'precision-studio-light'

export function registerMonacoThemes(monaco: typeof Monaco): void {
  // Dark theme
  monaco.editor.defineTheme('precision-studio-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'b9c8de', background: '0b1326' },
      { token: 'keyword', foreground: '7bd0ff', fontStyle: 'bold' },
      { token: 'keyword.sql', foreground: '7bd0ff', fontStyle: 'bold' },
      { token: 'string', foreground: '4ae176' },
      { token: 'string.sql', foreground: '4ae176' },
      { token: 'number', foreground: 'fcd34d' },
      { token: 'comment', foreground: '8a919d', fontStyle: 'italic' },
      { token: 'comment.block', foreground: '8a919d', fontStyle: 'italic' },
      { token: 'identifier', foreground: 'b9c8de' },
      { token: 'type', foreground: 'b9c8de' },
      { token: 'operator', foreground: '7bd0ff' },
      { token: 'delimiter', foreground: 'c0c7d3' },
    ],
    colors: {
      'editor.background': '#0b1326',
      'editor.foreground': '#b9c8de',
      'editor.lineHighlightBackground': '#222a3d',
      'editor.selectionBackground': '#2d344980',
      'editor.inactiveSelectionBackground': '#2d344950',
      'editorCursor.foreground': '#7bd0ff',
      'editorLineNumber.foreground': '#404751',
      'editorLineNumber.activeForeground': '#7bd0ff',
      'editorIndentGuide.background': '#404751',
      'editorIndentGuide.activeBackground': '#7bd0ff',
      'editorGutter.background': '#0b1326',
      'editor.selectionHighlightBackground': '#2d344940',
      'editorWidget.background': '#1c2438',
      'editorSuggestWidget.background': '#2d3449',
      'editorSuggestWidget.border': '#4a5363',
      'editorSuggestWidget.foreground': '#cbd5e1',
      'editorSuggestWidget.selectedForeground': '#ffffff',
      'editorSuggestWidget.selectedIconForeground': '#7bd0ff',
      'editorSuggestWidget.selectedBackground': '#334b66',
      'editorSuggestWidget.highlightForeground': '#7bd0ff',
      'editorSuggestWidget.focusHighlightForeground': '#ffffff',
      'editorHoverWidget.background': '#2d3449',
      'editorHoverWidget.foreground': '#cbd5e1',
      'editorHoverWidget.border': '#4a5363',
      'editorHoverWidget.highlightForeground': '#7bd0ff',
      'editorHoverWidget.statusBarBackground': '#222a3d',
      'input.background': '#222a3d',
      'input.foreground': '#dae2fd',
      'input.border': '#404751',
      'scrollbarSlider.background': '#40475150',
      'scrollbarSlider.hoverBackground': '#40475180',
      'scrollbarSlider.activeBackground': '#404751cc',
    },
  })

  // Light theme
  monaco.editor.defineTheme('precision-studio-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: '191c1e', background: 'ffffff' },
      { token: 'keyword', foreground: '0066CC', fontStyle: 'bold' },
      { token: 'keyword.sql', foreground: '0066CC', fontStyle: 'bold' },
      { token: 'string', foreground: '2E7D32' },
      { token: 'string.sql', foreground: '2E7D32' },
      { token: 'number', foreground: 'c65d00' },
      { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
      { token: 'comment.block', foreground: '6a737d', fontStyle: 'italic' },
      { token: 'identifier', foreground: '793000' },
      { token: 'type', foreground: '793000' },
      { token: 'operator', foreground: '0066CC' },
      { token: 'delimiter', foreground: '414753' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#191c1e',
      'editor.lineHighlightBackground': '#f2f4f6',
      'editor.selectionBackground': '#d7e3ff80',
      'editor.inactiveSelectionBackground': '#d7e3ff50',
      'editorCursor.foreground': '#0066cc',
      'editorLineNumber.foreground': '#c1c6d5',
      'editorLineNumber.activeForeground': '#0066cc',
      'editorIndentGuide.background': '#c1c6d5',
      'editorIndentGuide.activeBackground': '#0066cc',
      'editorGutter.background': '#f9fafb',
      'editor.selectionHighlightBackground': '#d7e3ff40',
      'editorWidget.background': '#ffffff',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.border': '#d8dce8',
      'editorSuggestWidget.foreground': '#191c1e',
      'editorSuggestWidget.selectedForeground': '#ffffff',
      'editorSuggestWidget.selectedIconForeground': '#dfe8ff',
      'editorSuggestWidget.selectedBackground': '#0066cc',
      'editorSuggestWidget.highlightForeground': '#0066cc',
      'editorSuggestWidget.focusHighlightForeground': '#ffffff',
      'editorHoverWidget.background': '#ffffff',
      'editorHoverWidget.foreground': '#191c1e',
      'editorHoverWidget.border': '#d8dce8',
      'editorHoverWidget.highlightForeground': '#0066cc',
      'editorHoverWidget.statusBarBackground': '#f2f4f6',
      'input.background': '#f2f4f6',
      'input.foreground': '#191c1e',
      'input.border': '#c1c6d5',
      'scrollbarSlider.background': '#c1c6d550',
      'scrollbarSlider.hoverBackground': '#c1c6d580',
      'scrollbarSlider.activeBackground': '#c1c6d5cc',
    },
  })
}

export function getMonacoThemeName(
  theme: 'light' | 'dark' | 'system',
  systemIsDark: boolean
): MonacoThemeName {
  const resolved = theme === 'system' ? (systemIsDark ? 'dark' : 'light') : theme
  return resolved === 'dark' ? 'precision-studio-dark' : 'precision-studio-light'
}
