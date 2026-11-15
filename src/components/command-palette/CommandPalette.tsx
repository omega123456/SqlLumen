import { useCallback, useEffect, useMemo, useRef } from 'react'
import { DialogShell } from '../dialogs/DialogShell'
import { useConnectionStore } from '../../stores/connection-store'
import { useCommandPaletteStore } from '../../stores/command-palette-store'
import { CommandPaletteFooter } from './CommandPaletteKeyHints'
import { CommandPaletteInput } from './CommandPaletteInput'
import { CommandPaletteResults } from './CommandPaletteResults'
import { SlashCommandDropdown } from './SlashCommandDropdown'
import { buildSlashOptions } from './slash-options'
import { usePaletteInput } from './use-palette-input'
import { clampedSlashIndex, usePaletteKeyboard } from './use-palette-keyboard'
import { usePaletteResults } from './use-palette-results'
import { usePaletteSchemaObjects } from './use-palette-schema-objects'
import { usePaletteSelect } from './use-palette-select'

export type {
  CommandPaletteFilterPillValue,
  CommandPaletteInputProps,
  CommandPaletteResultsProps,
} from './palette-types'

export function CommandPalette() {
  const isOpen = useCommandPaletteStore((state) => state.isOpen)
  const openInstance = useCommandPaletteStore((state) => state.openInstance)
  const scopeToTable = useCommandPaletteStore((state) => state.scopeToTable)
  const closePalette = useCommandPaletteStore((state) => state.close)
  const activeConnectionId = useConnectionStore((state) => state.activeTabId)
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    previouslyFocusedElementRef.current = document.activeElement as HTMLElement | null
  }, [isOpen])

  const restoreFocus = useCallback(() => {
    previouslyFocusedElementRef.current?.focus()
    previouslyFocusedElementRef.current = null
  }, [])

  const handleClose = useCallback(() => {
    closePalette()
    restoreFocus()
  }, [closePalette, restoreFocus])

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={handleClose}
      panelPadding={false}
      panelWidth="min(800px, 80vw)"
      panelClassName="mt-14 self-start overflow-hidden"
      backdropTone="palette"
      testId="command-palette"
      ariaLabel="Command palette"
      disableFocusManagement
    >
      <CommandPaletteSession
        key={`${activeConnectionId ?? 'no-connection'}-${openInstance}`}
        activeConnectionId={activeConnectionId}
        scopeToTable={scopeToTable}
        onClose={handleClose}
      />
    </DialogShell>
  )
}

interface CommandPaletteSessionProps {
  activeConnectionId: string | null
  scopeToTable: boolean
  onClose: () => void
}

function usePaletteSession({
  activeConnectionId,
  scopeToTable,
  onClose,
}: CommandPaletteSessionProps) {
  const schemaObjects = usePaletteSchemaObjects(activeConnectionId)
  const { databases } = schemaObjects
  const paletteInput = usePaletteInput({
    activeConnectionId: activeConnectionId,
    scopeToTable: scopeToTable,
    databases: databases,
  })
  const paletteResults = usePaletteResults({
    activeConnectionId: activeConnectionId,
    schemaObjects: schemaObjects,
    searchInput: paletteInput,
  })
  const slashOptions = useMemo(
    () => buildSlashOptions(paletteInput.slashQuery, databases),
    [databases, paletteInput.slashQuery]
  )
  const handleSelect = usePaletteSelect(activeConnectionId, onClose)
  const handleQueryKeyDown = usePaletteKeyboard({
    paletteInput: paletteInput,
    slashOptions: slashOptions,
    visibleResultCount: paletteResults.visibleResults.length,
    activeResult: paletteResults.activeResult,
    onSelect: handleSelect,
    onClose: onClose,
  })

  return { databases, paletteInput, paletteResults, slashOptions, handleSelect, handleQueryKeyDown }
}

function CommandPaletteSession(props: CommandPaletteSessionProps) {
  const {
    databases,
    paletteInput,
    paletteResults,
    slashOptions,
    handleSelect,
    handleQueryKeyDown,
  } = usePaletteSession(props)
  const { slashQuery, isSlashDropdownOpen, activeIndex } = paletteInput

  return (
    <div className="flex max-h-palette-height flex-col">
      <div className="border-b border-light-stroke-divider p-3 dark:border-dark-stroke-divider">
        <CommandPaletteInput
          query={paletteInput.query}
          pills={paletteInput.pills}
          isSlashDropdownOpen={isSlashDropdownOpen}
          onQueryChange={paletteInput.handleQueryChange}
          onQueryKeyDown={handleQueryKeyDown}
          onPillRemove={paletteInput.handlePillRemove}
          inputRef={paletteInput.inputRef}
          activeDescendantId={paletteResults.activeDescendantId}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {isSlashDropdownOpen ? (
          <SlashCommandDropdown
            slashQuery={slashQuery}
            databases={databases}
            activeIndex={clampedSlashIndex(activeIndex, slashOptions.length)}
            onSelect={paletteInput.handleSlashSelect}
          />
        ) : (
          <CommandPaletteResults
            results={paletteResults.visibleResults}
            activeIndex={paletteResults.clampedActiveIndex}
            state={paletteResults.searchState}
            isColumnScope={paletteResults.isColumnScope}
            onSelect={(result) => {
              void handleSelect(result)
            }}
          />
        )}
      </div>
      <CommandPaletteFooter showColumnsHint={!paletteResults.isColumnScope} />
    </div>
  )
}
