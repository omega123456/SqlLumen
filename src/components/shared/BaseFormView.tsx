/**
 * BaseFormView — shared editable single-record form component.
 *
 * Displays one row at a time with editable inputs for each column.
 * Supports NULL toggle, modified-field indicators, copy-to-clipboard,
 * record navigation, and save/discard actions.
 *
 * This component is store-free — all state comes through props.
 * Consumers adapt their rich edit state into the shared RowEditState shape.
 *
 * Based on the TableDataFormView design.
 */

import { useMemo, useRef } from 'react'
import type { BaseFormViewProps } from '../../types/shared-data-view'
import { FormField } from './base-form-view/FormField'
import { FormRecordNav } from './base-form-view/FormRecordNav'
import { collectModifiedKeys, resolveRecordCounts } from './base-form-view/form-field-values'
import { useBaseFormHandlers } from './base-form-view/use-base-form-handlers'
import styles from './BaseFormView.module.css'

function EmptyFormView({ testId }: { testId: string }) {
  return (
    <div className={styles.formView} data-testid={testId}>
      <div className={styles.emptyState}>No rows to display</div>
    </div>
  )
}

type FormFieldHandlers = ReturnType<typeof useBaseFormHandlers>

interface FormFieldListProps {
  props: BaseFormViewProps
  currentRow: unknown[]
  modifiedKeys: Set<string>
  hasEditCapability: boolean
  handlers: FormFieldHandlers
  inputFocusedRef: React.RefObject<Record<string, boolean>>
}

function FormFieldList(list: FormFieldListProps) {
  const { props, handlers } = list
  return (
    <div className={styles.formRows}>
      {props.columns.map((column, columnIndex) => (
        <FormField
          key={column.key}
          col={column}
          colIdx={columnIndex}
          currentRow={list.currentRow}
          currentRowData={props.currentRowData ?? null}
          editState={props.editState}
          isModified={list.modifiedKeys.has(column.key)}
          hasEditCapability={list.hasEditCapability}
          openPickerState={handlers.openPickerState}
          inputFocusedRef={list.inputFocusedRef}
          onSetOpenPickerState={handlers.setOpenPickerState}
          onEnsureEditing={handlers.ensureEditing}
          onInputFocus={handlers.handleInputFocus}
          onInputChange={handlers.handleInputChange}
          onNullToggle={handlers.handleNullToggle}
          onCopy={handlers.handleCopy}
          workspaceTabId={props.workspaceTabId}
          onBlobView={props.onBlobView}
          blobViewDisabled={props.blobViewDisabled ?? false}
          blobViewDisabledReason={props.blobViewDisabledReason}
        />
      ))}
    </div>
  )
}

export function BaseFormView(props: BaseFormViewProps) {
  const { currentRow, editState, onSave, readOnly, testId = 'base-form-view' } = props
  const hasEditCapability = onSave != null && !readOnly
  const counts = resolveRecordCounts(props)
  const inputFocusedRef = useRef<Record<string, boolean>>({})
  const modifiedKeys = useMemo(() => collectModifiedKeys(editState), [editState])
  const handlers = useBaseFormHandlers(props)

  const hasNoRow = currentRow === null || counts.totalRows === 0
  if (hasNoRow) return <EmptyFormView testId={testId} />

  return (
    <div className={styles.formView} data-testid={testId}>
      <FormRecordNav
        currentAbsoluteIndex={props.currentAbsoluteIndex}
        isFirstRecord={props.isFirstRecord}
        isLoading={props.isLoading ?? false}
        counts={counts}
        onNavigatePrev={props.onNavigatePrev}
        onNavigateNext={props.onNavigateNext}
        editActions={{
          hasEditCapability: hasEditCapability,
          hasModifications: modifiedKeys.size > 0,
          onDiscard: handlers.handleDiscard,
          onSave: handlers.handleSave,
        }}
      />
      <FormFieldList
        props={props}
        currentRow={currentRow}
        modifiedKeys={modifiedKeys}
        hasEditCapability={hasEditCapability}
        handlers={handlers}
        inputFocusedRef={inputFocusedRef}
      />
    </div>
  )
}
