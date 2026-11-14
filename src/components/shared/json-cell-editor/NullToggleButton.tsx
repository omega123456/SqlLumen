import type { MouseEvent as ReactMouseEvent } from 'react'
import { Button } from '../../common/Button'

interface NullToggleButtonProps {
  isNull: boolean
  onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void
  onToggle: () => void
}

export function NullToggleButton({ isNull, onMouseDown, onToggle }: NullToggleButtonProps) {
  const activeClassName = isNull ? 'td-null-active' : ''
  return (
    <Button
      variant="bare"
      className={`td-null-toggle click-outside-ignore ${activeClassName}`}
      onMouseDown={onMouseDown}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onToggle()
      }}
      tabIndex={-1}
    >
      NULL
    </Button>
  )
}
