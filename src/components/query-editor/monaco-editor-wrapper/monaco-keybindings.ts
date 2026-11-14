import type * as MonacoType from 'monaco-editor'
import { useShortcutStore } from '../../../stores/shortcut-store'
import type { ShortcutBinding } from '../../../types/schema'

export const MONACO_SHORTCUT_ACTIONS = ['execute-query', 'format-query', 'new-query-tab'] as const
const COMMA_KEY_NAMES: ReadonlySet<string> = new Set([',', 'COMMA'])

export type MonacoShortcutActionId = (typeof MONACO_SHORTCUT_ACTIONS)[number]
export type MonacoShortcutBindings = Record<MonacoShortcutActionId, ShortcutBinding>
type StandaloneEditor = MonacoType.editor.IStandaloneCodeEditor

function getMonacoKeyCode(key: string, monacoInstance: typeof MonacoType): number | null {
  const normalizedKey = key.trim().toUpperCase()
  if (normalizedKey === '') {
    return null
  }

  if (/^[A-Z]$/.test(normalizedKey)) {
    const letterCode =
      monacoInstance.KeyCode[`Key${normalizedKey}` as keyof typeof monacoInstance.KeyCode]
    return typeof letterCode === 'number' ? letterCode : null
  }

  if (/^F([1-9]|1[0-2])$/.test(normalizedKey)) {
    const functionKeyCode =
      monacoInstance.KeyCode[normalizedKey as keyof typeof monacoInstance.KeyCode]
    return typeof functionKeyCode === 'number' ? functionKeyCode : null
  }

  if (normalizedKey === 'ENTER') {
    return monacoInstance.KeyCode.Enter
  }

  if (normalizedKey === 'TAB') {
    return monacoInstance.KeyCode.Tab
  }

  if (COMMA_KEY_NAMES.has(normalizedKey)) {
    return monacoInstance.KeyCode.Comma
  }

  return null
}

const MONACO_KEY_MOD_BY_MODIFIER: Partial<Record<string, 'CtrlCmd' | 'Shift' | 'Alt'>> = {
  ctrl: 'CtrlCmd',
  shift: 'Shift',
  alt: 'Alt',
}

function getMonacoModifierMask(
  modifiers: ShortcutBinding['modifiers'],
  monacoInstance: typeof MonacoType
): number {
  return modifiers.reduce((mask, modifier) => {
    const keyModName = MONACO_KEY_MOD_BY_MODIFIER[modifier]
    if (!keyModName) return mask
    return mask | monacoInstance.KeyMod[keyModName]
  }, 0)
}

function getMonacoKeybinding(
  binding: ShortcutBinding,
  monacoInstance: typeof MonacoType
): number | null {
  const keyCode = getMonacoKeyCode(binding.key, monacoInstance)
  if (keyCode === null) {
    return null
  }

  return getMonacoModifierMask(binding.modifiers, monacoInstance) | keyCode
}

export function registerShortcutCommands(
  editor: StandaloneEditor,
  monacoInstance: typeof MonacoType,
  bindings: MonacoShortcutBindings
): void {
  for (const actionId of MONACO_SHORTCUT_ACTIONS) {
    const keybinding = getMonacoKeybinding(bindings[actionId], monacoInstance)
    if (keybinding === null) continue
    editor.addCommand(keybinding, () => {
      useShortcutStore.getState().dispatchAction(actionId)
    })
  }
}

export function shortcutSignatureOf(bindings: MonacoShortcutBindings): string {
  return MONACO_SHORTCUT_ACTIONS.map((actionId) => {
    const binding = bindings[actionId]
    return `${actionId}:${binding.key}:${binding.modifiers.slice().sort().join('+')}`
  }).join('|')
}

export function addFindReplaceAction(
  editor: StandaloneEditor,
  monacoInstance: typeof MonacoType
): MonacoType.IDisposable {
  const { KeyMod, KeyCode } = monacoInstance
  return editor.addAction({
    id: 'sqllumen.find-replace',
    label: 'Find and replace',
    keybindings: [KeyMod.CtrlCmd, KeyMod.WinCtrl].flatMap((modifier) => [
      modifier | KeyCode.KeyH,
      modifier | KeyMod.Shift | KeyCode.KeyR,
    ]),
    run: (codeEditor) => codeEditor.getAction('editor.action.startFindReplaceAction')?.run(),
  })
}
