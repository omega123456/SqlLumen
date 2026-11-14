import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import type { BaseFormViewProps } from '../../../types/shared-data-view'
import type { RecordCounts } from './form-field-values'
import styles from '../BaseFormView.module.css'

export interface FormRecordNavProps {
  currentAbsoluteIndex: number
  isFirstRecord: boolean
  isLoading: boolean
  counts: RecordCounts
  onNavigatePrev: BaseFormViewProps['onNavigatePrev']
  onNavigateNext: BaseFormViewProps['onNavigateNext']
  editActions: {
    hasEditCapability: boolean
    hasModifications: boolean
    onDiscard: () => void
    onSave: () => void
  }
}

function FormEditButtons({ editActions }: Pick<FormRecordNavProps, 'editActions'>) {
  return (
    <div className={styles.formButtons}>
      <Button
        size="sm"
        disabled={!editActions.hasModifications}
        onClick={editActions.onDiscard}
        data-testid="btn-form-discard"
      >
        Discard
      </Button>
      <Button
        variant="accent"
        size="sm"
        disabled={!editActions.hasModifications}
        onClick={editActions.onSave}
        data-testid="btn-form-save"
      >
        Save changes
      </Button>
    </div>
  )
}

export function FormRecordNav({
  currentAbsoluteIndex,
  isFirstRecord,
  isLoading,
  counts,
  onNavigatePrev,
  onNavigateNext,
  editActions,
}: FormRecordNavProps) {
  return (
    <div className={styles.recordNav}>
      <Button
        variant="subtle"
        size="sm"
        iconOnly
        disabled={isFirstRecord}
        onClick={onNavigatePrev}
        aria-label="Previous record"
        title="Previous record"
        data-testid="btn-form-previous"
      >
        <CaretLeftIcon size={16} />
      </Button>
      <span className={styles.recordTitle} data-testid="form-record-label">
        Record <b>{(currentAbsoluteIndex + 1).toLocaleString()}</b>
        {counts.knownTotalRows !== null && ` of ${counts.knownTotalRows.toLocaleString()}`}
      </span>
      <Button
        variant="subtle"
        size="sm"
        iconOnly
        disabled={isLoading || counts.isLastRecord}
        onClick={onNavigateNext}
        aria-label="Next record"
        title="Next record"
        data-testid="btn-form-next"
      >
        <CaretRightIcon size={16} />
      </Button>

      {editActions.hasEditCapability && <FormEditButtons editActions={editActions} />}
    </div>
  )
}
