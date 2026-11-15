import { useCallback, useMemo } from 'react'
import type { GridColumnDescriptor } from '../../../types/shared-data-view'
import {
  releaseEditingRowIfClean,
  startEditingIfNeeded,
  type GridRowData,
  type RowEditSession,
} from './row-edit-session'

export interface FormEditHandlerInputs<RowIdentity> {
  session: RowEditSession<RowIdentity>
  currentRowData: GridRowData | null
  columns: GridColumnDescriptor[]
}

export interface FormEditHandlers {
  onEnsureEditing: () => void
  onUpdateCell: (columnKey: string, value: unknown) => void
  onSave: () => Promise<void>
  onDiscard: () => void
}

function escapeForAttributeSelector(value: string): string {
  const canUseCssEscape = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
  if (canUseCssEscape) return CSS.escape(value)
  return value.replace(/(["\\])/g, '\\$1')
}

function focusFormInput(displayName: string): void {
  const input = document.querySelector<HTMLElement>(
    `[data-testid="form-input-${escapeForAttributeSelector(displayName)}"]`
  )
  input?.focus()
}

function focusInvalidColumn(columns: GridColumnDescriptor[], columnKey: string | null): void {
  const column = columns.find((candidate) => candidate.key === columnKey)
  if (column) focusFormInput(column.displayName)
}

export function useFormEditHandlers<RowIdentity>(
  inputs: FormEditHandlerInputs<RowIdentity>
): FormEditHandlers {
  const { session, currentRowData, columns } = inputs
  const ensureEditing = useCallback(() => {
    if (!currentRowData) return
    startEditingIfNeeded(session, session.identityOf(currentRowData), currentRowData)
  }, [currentRowData, session])
  return useMemo(
    () => ({
      onEnsureEditing: ensureEditing,
      onUpdateCell: (columnKey: string, value: unknown) => {
        ensureEditing()
        session.updateCell(columnKey, value)
      },
      onSave: async () => {
        const outcome = await session.saveEditingRow()
        focusInvalidColumn(columns, outcome.invalidColumnKey)
      },
      onDiscard: () => session.discardEditingRow(),
    }),
    [columns, ensureEditing, session]
  )
}

export type FormNavigationDirection = 'prev' | 'next'

export interface FormRecordNavigation {
  onNavigatePrevious: () => void
  onNavigateNext: () => void
}

type FormNavigate = (direction: FormNavigationDirection) => void

async function navigateAfterSaving<RowIdentity>(
  session: RowEditSession<RowIdentity>,
  navigate: FormNavigate,
  direction: FormNavigationDirection
): Promise<void> {
  const outcome = await session.saveEditingRow()
  if (outcome.saved) navigate(direction)
}

function navigateFromEditingRow<RowIdentity>(
  session: RowEditSession<RowIdentity>,
  navigate: FormNavigate,
  direction: FormNavigationDirection
): void {
  if (releaseEditingRowIfClean(session)) {
    navigate(direction)
    return
  }
  void navigateAfterSaving(session, navigate, direction)
}

export function useFormRecordNavigation<RowIdentity>(
  session: RowEditSession<RowIdentity>,
  navigate: FormNavigate
): FormRecordNavigation {
  return useMemo(
    () => ({
      onNavigatePrevious: () => navigateFromEditingRow(session, navigate, 'prev'),
      onNavigateNext: () => navigateFromEditingRow(session, navigate, 'next'),
    }),
    [navigate, session]
  )
}
