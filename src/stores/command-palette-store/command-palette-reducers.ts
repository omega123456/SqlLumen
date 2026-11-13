import type { CommandPaletteState } from '../command-palette-store'

type PaletteVisibility = Pick<CommandPaletteState, 'isOpen' | 'openInstance' | 'scopeToTable'>

export function openPalette(
  state: Pick<CommandPaletteState, 'openInstance'>,
  scopeToTable: boolean
): PaletteVisibility {
  return { isOpen: true, openInstance: state.openInstance + 1, scopeToTable: scopeToTable }
}

export function togglePalette(
  state: Pick<CommandPaletteState, 'isOpen' | 'openInstance'>,
  scopeToTable: boolean
): PaletteVisibility | Pick<CommandPaletteState, 'isOpen'> {
  if (state.isOpen) return { isOpen: false }
  return openPalette(state, scopeToTable)
}
