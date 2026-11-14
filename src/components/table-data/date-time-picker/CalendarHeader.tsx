import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import styles from '../DateTimePicker.module.css'

const MONTH_YEAR_FORMAT: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' }

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
  const monthYear = date.toLocaleDateString('en-US', MONTH_YEAR_FORMAT)

  return (
    <div className={styles.calendarHeader} data-testid="calendar-header">
      <Button
        variant="bare"
        className={styles.navArrow}
        onClick={decreaseMonth}
        aria-label="Previous month"
        data-testid="btn-prev-month"
      >
        <CaretLeft size={16} weight="bold" />
      </Button>
      <span className={styles.monthYearLabel}>{monthYear}</span>
      <Button
        variant="bare"
        className={styles.navArrow}
        onClick={increaseMonth}
        aria-label="Next month"
        data-testid="btn-next-month"
      >
        <CaretRight size={16} weight="bold" />
      </Button>
      <Button
        variant="bare"
        className={styles.todayLink}
        onClick={onTodayClick}
        data-testid="btn-today"
      >
        TODAY
      </Button>
    </div>
  )
}
