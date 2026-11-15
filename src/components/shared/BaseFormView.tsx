import { useMemo, useRef, type ReactNode } from 'react'
import type { BaseFormViewProps } from '../../types/shared-data-view'
import { FormField } from './base-form-view/FormField'
import { FormRecordNav } from './base-form-view/FormRecordNav'
import { collectModifiedKeys, resolveRecordCounts } from './base-form-view/form-field-values'
import { useBaseFormHandlers } from './base-form-view/use-base-form-handlers'
import { joinClassNames, SCROLLBAR } from '../../lib/class-names'

function FormViewFrame({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div
      className={joinClassNames([
        'flex h-full flex-col gap-3 overflow-auto border-t border-light-stroke-divider bg-light-surface-container-lowest px-5 py-4 font-body dark:border-dark-stroke-divider dark:bg-dark-surface-container-lowest',
        SCROLLBAR,
      ])}
      data-testid={testId}
    >
      {children}
    </div>
  )
}

function EmptyFormView({ testId }: { testId: string }) {
  return (
    <FormViewFrame testId={testId}>
      <div className="flex h-full items-center justify-center text-size-row text-light-on-surface-variant dark:text-dark-on-surface-variant">
        No rows to display
      </div>
    </FormViewFrame>
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
    <div className="grid grid-cols-form-rows items-center justify-start gap-x-4 gap-y-2">
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
    <FormViewFrame testId={testId}>
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
    </FormViewFrame>
  )
}
