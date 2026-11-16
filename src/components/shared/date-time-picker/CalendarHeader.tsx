import type { ReactNode } from 'react'
import { format } from 'date-fns'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { FOCUS_RING } from '../../../lib/focus-ring'
import { joinClassNames } from '../../../lib/class-names'

const MONTH_YEAR_FORMAT = 'MMMM yyyy'

interface NavArrowButtonProps {
  label: string
  testId: string
  onClick: () => void
  children: ReactNode
}

function NavArrowButton({ label, testId, onClick, children }: NavArrowButtonProps) {
  return (
    <Button
      variant="bare"
      className={joinClassNames([
        'flex size-7 cursor-pointer items-center justify-center rounded-control bg-transparent text-light-on-surface-variant transition-background-and-color duration-120 hover:bg-light-surface-container-high hover:text-light-on-surface dark:text-dark-on-surface-variant dark:hover:bg-dark-surface-container-high dark:hover:text-dark-on-surface',
        FOCUS_RING,
      ])}
      onClick={onClick}
      aria-label={label}
      data-testid={testId}
    >
      {children}
    </Button>
  )
}

interface CalendarHeaderProps {
  date: Date
  decreaseMonth: () => void
  increaseMonth: () => void
  onTodayClick: () => void
}

export function CalendarHeader({
  date,
  decreaseMonth,
  increaseMonth,
  onTodayClick,
}: CalendarHeaderProps) {
  const monthYear = format(date, MONTH_YEAR_FORMAT)

  return (
    <div className="flex items-center gap-1 pb-2" data-testid="calendar-header">
      <NavArrowButton label="Previous month" testId="btn-prev-month" onClick={decreaseMonth}>
        <CaretLeft size={16} weight="bold" />
      </NavArrowButton>
      <span className="min-w-0 flex-1 text-center font-body text-size-caption font-semibold whitespace-nowrap text-light-on-surface dark:text-dark-on-surface">
        {monthYear}
      </span>
      <NavArrowButton label="Next month" testId="btn-next-month" onClick={increaseMonth}>
        <CaretRight size={16} weight="bold" />
      </NavArrowButton>
      <Button
        variant="bare"
        className={joinClassNames([
          'shrink-0 cursor-pointer rounded-control bg-transparent px-1.5 py-0.5 font-body text-size-caption font-semibold whitespace-nowrap text-light-primary transition-background duration-120 hover:bg-light-fill-subtle-hover dark:text-dark-primary dark:hover:bg-dark-fill-subtle-hover',
          FOCUS_RING,
        ])}
        onClick={onTodayClick}
        data-testid="btn-today"
      >
        TODAY
      </Button>
    </div>
  )
}
