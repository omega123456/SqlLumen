import { DialogShell } from '../dialogs/DialogShell'
import { FilterDialog } from '../dialogs/FilterDialog'
import styles from './FkLookupDialog.module.css'
import { isApplyEnabled } from './fk-lookup-dialog/fk-lookup-model'
import { LookupFooter, LookupHeader, LookupToolbar } from './fk-lookup-dialog/FkLookupChrome'
import { LookupBody } from './fk-lookup-dialog/LookupBody'
import { useFkLookupData } from './fk-lookup-dialog/use-fk-lookup-data'
import {
  useLookupGridProps,
  useLookupQueryHandlers,
  useLookupSelection,
} from './fk-lookup-dialog/use-fk-lookup-interactions'

export interface FkLookupDialogProps {
  isOpen: boolean
  onClose: () => void
  onApply: (value: unknown) => void
  connectionId: string
  database: string
  sourceTable: string
  sourceColumn: string
  currentValue: unknown
  referencedTable: string
  referencedColumn: string
  isReadOnly: boolean
}

export type { LookupPageRequest } from './fk-lookup-dialog/fk-lookup-model'

export function FkLookupDialog(props: FkLookupDialogProps) {
  const { isOpen, onClose, referencedColumn, isReadOnly } = props
  const data = useFkLookupData(props, props)
  const { columns } = data.page
  const queryHandlers = useLookupQueryHandlers(data)
  const { isFilterDialogOpen } = queryHandlers
  const selection = useLookupSelection(
    { ...props, data: data },
    { isOpen: isOpen, isFilterDialogOpen: isFilterDialogOpen }
  )
  const grid = useLookupGridProps({
    data: data,
    referencedColumn: referencedColumn,
    queryHandlers: queryHandlers,
    selection: selection,
  })
  const canApplySelection = isApplyEnabled({
    hasSelection: data.selectedRowKey !== null,
    isReadOnly: isReadOnly,
    isLoading: data.isLoading,
    error: data.error,
  })

  return (
    <>
      <DialogShell
        isOpen={isOpen}
        onClose={onClose}
        panelWidth="80vw"
        panelPadding={false}
        testId="fk-lookup-dialog"
        ariaLabel="Foreign key lookup"
        nonDismissible={isFilterDialogOpen}
      >
        <div className={styles.dialogContent} data-testid="fk-lookup-dialog-content">
          <LookupHeader {...props} />
          <LookupToolbar data={data} queryHandlers={queryHandlers} />
          <LookupBody
            isLoading={data.isLoading}
            error={data.error}
            onRetry={data.retry}
            grid={grid}
          />
          <LookupFooter
            canApply={canApplySelection}
            onApply={selection.handleApply}
            onCancel={onClose}
          />
        </div>
      </DialogShell>
      <FilterDialog
        isOpen={isFilterDialogOpen}
        initialConditions={data.query.filterModel}
        columns={columns.map((column) => column.name)}
        onApply={queryHandlers.handleFilterApply}
        onCancel={queryHandlers.closeFilterDialog}
      />
    </>
  )
}
