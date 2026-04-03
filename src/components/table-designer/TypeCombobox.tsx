import { CaretDown } from '@phosphor-icons/react'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEventHandler,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from 'react'
import { useDismissOnOutsideClick } from '../connection-dialog/useDismissOnOutsideClick'
import { MYSQL_TYPE_GROUPS } from './table-designer-type-constants'
import styles from './TypeCombobox.module.css'

interface TypeComboboxProps {
  value: string
  onChange: (type: string) => void
  disabled?: boolean
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'disabled'> & {
    inputTestId?: string
    rowIndex?: number
    cellKey?: string
    onInputFocus?: FocusEventHandler<HTMLInputElement>
  }
}

export function TypeCombobox({ value, onChange, disabled = false, inputProps }: TypeComboboxProps) {
  const listboxId = useId()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const suppressNextFocusOpenRef = useRef(false)
  const [isOpen, setIsOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [hoveredIndex, setHoveredIndex] = useState(-1)

  const {
    inputTestId,
    rowIndex,
    cellKey,
    onInputFocus,
    onKeyDown: inputOnKeyDown,
    ...restInputProps
  } = inputProps ?? {}

  const visibleGroups = useMemo(() => {
    const normalizedFilter = filter.trim().toLowerCase()

    return MYSQL_TYPE_GROUPS.map((group) => ({
      ...group,
      types: normalizedFilter
        ? group.types.filter((type) => type.toLowerCase().includes(normalizedFilter))
        : [...group.types],
    })).filter((group) => group.types.length > 0)
  }, [filter])

  const visibleTypes = useMemo(
    () =>
      visibleGroups.flatMap((group) => group.types.map((type) => ({ group: group.label, type }))),
    [visibleGroups]
  )

  const activeDescendantId =
    isOpen && hoveredIndex >= 0 ? `${listboxId}-option-${hoveredIndex}` : undefined

  const openDropdown = useCallback(() => {
    if (disabled) {
      return
    }

    if (suppressNextFocusOpenRef.current) {
      suppressNextFocusOpenRef.current = false
      return
    }

    setFilter('')
    setIsOpen(true)
  }, [disabled])

  const closeDropdown = useCallback(() => {
    setIsOpen(false)
    setFilter('')
    setHoveredIndex(-1)
  }, [])

  useDismissOnOutsideClick(wrapperRef, isOpen, closeDropdown, { closeOnEscape: false })

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const selectedIndex = visibleTypes.findIndex((entry) => entry.type === value)
    if (visibleTypes.length === 0) {
      return
    }

    if (hoveredIndex < 0 || hoveredIndex >= visibleTypes.length) {
      queueMicrotask(() => {
        setHoveredIndex(selectedIndex >= 0 ? selectedIndex : 0)
      })
    }
  }, [hoveredIndex, isOpen, value, visibleTypes])

  const selectType = useCallback(
    (nextType: string) => {
      onChange(nextType)
      closeDropdown()
      suppressNextFocusOpenRef.current = true
      inputRef.current?.focus()
    },
    [closeDropdown, onChange]
  )

  const moveHoveredIndex = useCallback(
    (delta: number) => {
      if (visibleTypes.length === 0) {
        return
      }

      setHoveredIndex((current) => {
        if (current < 0) {
          return delta > 0 ? 0 : visibleTypes.length - 1
        }

        return (current + delta + visibleTypes.length) % visibleTypes.length
      })
    },
    [visibleTypes.length]
  )

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!isOpen) {
      setIsOpen(true)
    }

    setFilter(event.target.value)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    inputOnKeyDown?.(event)
    if (event.defaultPrevented) {
      return
    }

    if (disabled) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!isOpen) {
        openDropdown()
        return
      }
      moveHoveredIndex(1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!isOpen) {
        openDropdown()
        return
      }
      moveHoveredIndex(-1)
      return
    }

    if (event.key === 'Enter' && isOpen) {
      event.preventDefault()
      if (hoveredIndex >= 0) {
        selectType(visibleTypes[hoveredIndex]!.type)
      }
      return
    }

    if (event.key === 'Escape' && isOpen) {
      event.preventDefault()
      closeDropdown()
    }
  }

  return (
    <div className={styles.comboboxWrapper} ref={wrapperRef}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        className={`${styles.input} ${isOpen ? styles.inputOpen : ''}`.trim()}
        value={isOpen ? filter : value}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={activeDescendantId}
        aria-autocomplete="list"
        {...restInputProps}
        data-row-index={rowIndex}
        data-cell-key={cellKey}
        data-testid={inputTestId}
        onFocus={(event) => {
          onInputFocus?.(event)
          if (!event.defaultPrevented) {
            openDropdown()
          }
        }}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className={styles.chevronButton}
        aria-label="Toggle MySQL type list"
        disabled={disabled}
        onClick={() => {
          if (isOpen) {
            closeDropdown()
          } else {
            openDropdown()
            inputRef.current?.focus()
          }
        }}
      >
        <CaretDown size={16} weight="bold" aria-hidden />
      </button>

      {isOpen ? (
        <div className={styles.dropdown} role="listbox" id={listboxId}>
          {visibleGroups.map((group) => (
            <div className={styles.group} key={group.label}>
              <div className={styles.groupHeader}>{group.label}</div>
              {group.types.map((type) => {
                const flatIndex = visibleTypes.findIndex((entry) => entry.type === type)
                const isSelected = value === type
                const isHovered = hoveredIndex === flatIndex

                return (
                  <button
                    key={type}
                    id={`${listboxId}-option-${flatIndex}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={[
                      styles.option,
                      isSelected ? styles.optionSelected : '',
                      isHovered ? styles.optionHovered : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onMouseEnter={() => setHoveredIndex(flatIndex)}
                    onClick={() => selectType(type)}
                  >
                    {type}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
