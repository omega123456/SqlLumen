import { FloppyDisk, FolderOpen, MagicWand, UploadSimple } from '@phosphor-icons/react'
import { IconButton } from '../../common/IconButton'
import type { useEditorToolbarActions } from './use-editor-toolbar-actions'

interface EditorFileActionsProps {
  actions: ReturnType<typeof useEditorToolbarActions>
  isDisabled: boolean
  isReadOnly: boolean
}

export function EditorFileActions({ actions, isDisabled, isReadOnly }: EditorFileActionsProps) {
  return (
    <div className="flex items-center gap-0.5">
      <IconButton
        size="lg"
        title="Save (Ctrl+S)"
        onClick={actions.handleSave}
        disabled={actions.isSaving || isDisabled}
        data-testid="toolbar-save"
      >
        <FloppyDisk size={16} weight="regular" />
      </IconButton>
      <IconButton
        size="lg"
        title="Open SQL file"
        onClick={actions.handleOpen}
        disabled={actions.isOpening || isDisabled}
        data-testid="toolbar-open"
      >
        <FolderOpen size={16} weight="regular" />
      </IconButton>
      <IconButton
        size="lg"
        title="Format SQL"
        onClick={actions.handleFormat}
        disabled={isDisabled}
        data-testid="toolbar-format"
      >
        <MagicWand size={16} weight="regular" />
      </IconButton>
      <IconButton
        size="lg"
        title={isReadOnly ? 'Import SQL (disabled for read-only connections)' : 'Import SQL'}
        onClick={actions.handleImportSql}
        disabled={isDisabled || isReadOnly}
        data-testid="toolbar-import-sql"
      >
        <UploadSimple size={16} weight="regular" />
      </IconButton>
    </div>
  )
}
