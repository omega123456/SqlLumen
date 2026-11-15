import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import type { BaseFormViewProps } from '../../../types/shared-data-view'
import type { RecordCounts } from './form-field-values'

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
    <div className="ml-auto flex items-center gap-2">
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
    <div className="flex shrink-0 items-center gap-2 text-row text-light-on-surface-variant dark:text-dark-on-surface-variant">
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
      <span data-testid="form-record-label">
        Record{' '}
        <b className="font-semibold text-light-on-surface dark:text-dark-on-surface">
          {(currentAbsoluteIndex + 1).toLocaleString()}
        </b>
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
