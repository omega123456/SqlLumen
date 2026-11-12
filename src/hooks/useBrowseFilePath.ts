import { useCallback, useState } from 'react'
import { logFrontend } from '../lib/app-log-commands'

export interface SaveFileRequest {
  defaultPath: string
  filterName: string
  extension: string
}

export interface BrowseFilePath {
  filePath: string
  setFilePath: (filePath: string) => void
  browseForFilePath: (request: SaveFileRequest) => Promise<void>
}

export function useBrowseFilePath(logSource: string): BrowseFilePath {
  const [filePath, setFilePath] = useState('')

  const browseForFilePath = useCallback(
    async (request: SaveFileRequest) => {
      try {
        const { save } = await import('@tauri-apps/plugin-dialog')
        const selectedPath = await save({
          defaultPath: request.defaultPath,
          filters: [{ name: request.filterName, extensions: [request.extension] }],
        })
        if (selectedPath) setFilePath(selectedPath)
      } catch (error) {
        logFrontend('info', `[${logSource}] Save dialog unavailable: ${String(error)}`)
      }
    },
    [logSource]
  )

  return { filePath: filePath, setFilePath: setFilePath, browseForFilePath: browseForFilePath }
}
