import { useCallback } from 'react'
import { activateColumnFromPalette, activateObjectFromPalette } from '../../lib/object-activation'
import type { PaletteSearchResult } from '../../lib/command-palette-search'
import { useConnectionStore } from '../../stores/connection-store'
import { useCommandPaletteRecentsStore } from '../../stores/command-palette-recents-store'

function activateColumnResult(connectionId: string, result: PaletteSearchResult): void {
  if (!result.table) return
  activateColumnFromPalette({
    connectionId: connectionId,
    database: result.database,
    table: result.table,
    columnName: result.name,
  })
}

export function usePaletteSelect(activeConnectionId: string | null, onClose: () => void) {
  const recordSelection = useCommandPaletteRecentsStore((state) => state.recordSelection)
  const profileId = useConnectionStore((state) =>
    activeConnectionId ? (state.activeConnections[activeConnectionId]?.profile.id ?? null) : null
  )

  return useCallback(
    async (result: PaletteSearchResult) => {
      const isConnectionMissing = !activeConnectionId || !profileId
      if (isConnectionMissing) {
        onClose()
        return
      }

      if (result.objectType === 'column') {
        activateColumnResult(activeConnectionId, result)
        onClose()
        return
      }

      recordSelection(profileId, {
        database: result.database,
        objectType: result.objectType,
        name: result.name,
      })
      await activateObjectFromPalette({
        connectionId: activeConnectionId,
        database: result.database,
        objectType: result.objectType,
        name: result.name,
      })
      onClose()
    },
    [activeConnectionId, onClose, profileId, recordSelection]
  )
}
