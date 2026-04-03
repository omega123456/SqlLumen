import { CaretDown } from '@phosphor-icons/react'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEventHandler,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
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

type DropdownPlacement = 'top' | 'bottom'

type DropdownFixedLayout = {
  left: number
  width: number
  top: number | null
  bottom: number | null
}

const MAX_DROPDOWN_HEIGHT = 280

/** Viewport margin so the dropdown does not touch window edges. */
const VIEWPORT_MARGIN = 8

function getScrollParents(node: HTMLElement | null): (HTMLElement | Window)[] {
  const list: (HTMLElement | Window)[] = [window]
  let current = node?.parentElement ?? null

  while (current) {
    const style = window.getComputedStyle(current)
    const { overflow, overflowX, overflowY } = style
    if (/(auto|scroll|overlay)/.test(overflow + overflowX + overflowY)) {
      list.push(current)
    }
    current = current.parentElement
  }

  return list
}

export function TypeCombobox({ value, onChange, disabled = false, inputProps }: TypeComboboxProps) {
  const listboxId = useId()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const suppressNextFocusOpenRef = useRef(false)
  const [isOpen, setIsOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [hoveredIndex, setHoveredIndex] = useState(-1)
  const [placement, setPlacement] = useState<DropdownPlacement>('bottom')
  const [dropdownMaxHeight, setDropdownMaxHeight] = useState(MAX_DROPDOWN_HEIGHT)
  const [dropdownLayout, setDropdownLayout] = useState<DropdownFixedLayout>({
    left: 0,
    width: 0,
    top: null,
    bottom: null,
  })

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
    setPlacement('bottom')
    setDropdownMaxHeight(MAX_DROPDOWN_HEIGHT)
  }, [])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (wrapperRef.current?.contains(target)) {
        return
      }
      if (dropdownRef.current?.contains(target)) {
        return
      }
      closeDropdown()
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [isOpen, closeDropdown])

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

  useLayoutEffect(() => {
    if (!isOpen) {
      return
    }

    const wrapper = wrapperRef.current
    const dropdown = dropdownRef.current
    if (!wrapper || !dropdown) {
      return
    }

    const updatePlacement = () => {
      const wrapperRect = wrapper.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const m = VIEWPORT_MARGIN

      let left = wrapperRect.left
      let width = wrapperRect.width
      if (left < m) {
        width -= m - left
        left = m
      }
      if (left + width > vw - m) {
        width = Math.max(80, vw - m - left)
      }

      const desiredHeight = Math.min(
        dropdown.scrollHeight || MAX_DROPDOWN_HEIGHT,
        MAX_DROPDOWN_HEIGHT
      )
      const availableBelow = Math.max(0, vh - m - wrapperRect.bottom)
      const availableAbove = Math.max(0, wrapperRect.top - m)
      const nextPlacement: DropdownPlacement =
        availableBelow < desiredHeight && availableAbove > availableBelow ? 'top' : 'bottom'
      const availableSpace = nextPlacement === 'top' ? availableAbove : availableBelow

      setPlacement(nextPlacement)
      setDropdownMaxHeight(Math.max(0, Math.min(MAX_DROPDOWN_HEIGHT, Math.floor(availableSpace))))

      if (nextPlacement === 'bottom') {
        setDropdownLayout({
          left,
          width,
          top: wrapperRect.bottom - 1,
          bottom: null,
        })
      } else {
        setDropdownLayout({
          left,
          width,
          top: null,
          bottom: vh - wrapperRect.top + 1,
        })
      }
    }

    updatePlacement()

    const scrollParents = new Set<EventTarget>(getScrollParents(wrapper))

    scrollParents.forEach((target) => {
      target.addEventListener('scroll', updatePlacement, { passive: true })
    })
    window.addEventListener('resize', updatePlacement)

    return () => {
      scrollParents.forEach((target) => {
        target.removeEventListener('scroll', updatePlacement)
      })
      window.removeEventListener('resize', updatePlacement)
    }
  }, [isOpen, visibleGroups])

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
        className={`${styles.input} ${isOpen ? (placement === 'top' ? styles.inputOpenTop : styles.inputOpen) : ''}`.trim()}
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

      {isOpen
        ? createPortal(
            <div
              ref={dropdownRef}
              className={`${styles.dropdown} ${placement === 'top' ? styles.dropdownTop : ''}`.trim()}
              role="listbox"
              id={listboxId}
              data-placement={placement}
              style={{
                maxHeight: `${dropdownMaxHeight}px`,
                left: `${dropdownLayout.left}px`,
                width: `${dropdownLayout.width}px`,
                ...(placement === 'bottom'
                  ? { top: `${dropdownLayout.top}px`, bottom: 'auto' }
                  : { bottom: `${dropdownLayout.bottom}px`, top: 'auto' }),
              }}
            >
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
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
