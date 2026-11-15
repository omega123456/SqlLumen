import {
  useEffect,
  useRef,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from 'react'
import { dataFlag } from '../../lib/data-attributes'
import { isActivationKey, isMiddleMouseButton } from '../../lib/input-events'
import {
  barSuffixClassName,
  standaloneBarClassName,
  wrapperClassName,
  wrappedBarClassName,
} from './underline-tabs/tab-bar-classes'
import {
  labelButtonClassName,
  suffixSlotClassName,
  tabClassName,
  type TabDropIndicator,
  type TabShape,
} from './underline-tabs/tab-classes'
import type { UnderlineTabBarProps, UnderlineTabVariant } from './underline-tabs/tab-bar-variants'
import { ScrollableTabBar } from './underline-tabs/ScrollableTabBar'

export type {
  UnderlineTabBarProps,
  UnderlineTabRowHeight,
  UnderlineTabVariant,
} from './underline-tabs/tab-bar-variants'

export function UnderlineTabBar(props: UnderlineTabBarProps) {
  if (props.scrollable) {
    return <ScrollableTabBar {...props} />
  }
  const {
    children,
    className,
    'data-testid': testId,
    prefix,
    suffix,
    variant = 'default',
    rowHeight = 'default',
  } = props
  if (prefix || suffix) {
    return (
      <div
        className={wrapperClassName({ variant: variant, className: className })}
        data-variant={variant}
        data-testid={testId}
      >
        {prefix}
        <div
          className={wrappedBarClassName({ variant: variant, rowHeight: rowHeight })}
          data-variant={variant}
        >
          {children}
        </div>
        {suffix ? <div className={barSuffixClassName(rowHeight)}>{suffix}</div> : null}
      </div>
    )
  }
  return (
    <div
      className={standaloneBarClassName({
        variant: variant,
        rowHeight: rowHeight,
        className: className,
      })}
      data-variant={variant}
      data-testid={testId}
    >
      {children}
    </div>
  )
}

export interface UnderlineTabProps {
  active?: boolean
  children: ReactNode
  className?: string
  'data-testid'?: string
  'aria-label'?: string
  title?: string
  autoScrollOnActive?: boolean
  onClick?: () => void
  onSelect?: () => void
  onAuxClick?: (e: MouseEvent<HTMLElement>) => void
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void
  onDragStart?: (e: DragEvent<HTMLElement>) => void
  onDragOver?: (e: DragEvent<HTMLElement>) => void
  onDragEnd?: (e: DragEvent<HTMLElement>) => void
  onDrop?: (e: DragEvent<HTMLElement>) => void
  draggable?: boolean
  dragging?: boolean
  editing?: boolean
  dropIndicator?: TabDropIndicator
  prefix?: ReactNode
  suffix?: ReactNode
  variant?: UnderlineTabVariant
}

type ResolvedUnderlineTabProps = UnderlineTabProps &
  Required<Pick<UnderlineTabProps, 'active' | 'dragging' | 'editing' | 'variant'>>

interface ResolvedTabViewProps {
  props: ResolvedUnderlineTabProps
  elementRef: RefObject<HTMLDivElement | HTMLButtonElement | null>
}

function activeDataAttribute(active: boolean): true | undefined {
  if (!active) return undefined
  return true
}

function preventMiddleMouseDown(event: MouseEvent<HTMLElement>): void {
  if (isMiddleMouseButton(event)) event.preventDefault()
}

function middleMouseDownHandler(
  onAuxClick: UnderlineTabProps['onAuxClick']
): ((event: MouseEvent<HTMLElement>) => void) | undefined {
  if (!onAuxClick) return undefined
  return preventMiddleMouseDown
}

function onlyFromContainer<Event extends SyntheticEvent<HTMLElement>>(
  handler: ((event: Event) => void) | undefined
): (event: Event) => void {
  return (event) => {
    if (event.target !== event.currentTarget) {
      return
    }
    handler?.(event)
  }
}

function selectHandler(props: UnderlineTabProps): (() => void) | undefined {
  return props.onSelect ?? props.onClick
}

function resolvedTabClassName(shape: TabShape, props: ResolvedUnderlineTabProps): string {
  return tabClassName({
    shape: shape,
    variant: props.variant,
    active: props.active,
    dragging: props.dragging,
    dropIndicator: props.dropIndicator,
    editing: props.editing,
    className: props.className,
  })
}

function TabSuffixSlot({ props }: { props: ResolvedUnderlineTabProps }) {
  if (props.suffix == null) return null
  return (
    <div
      className={suffixSlotClassName(props.variant)}
      onPointerDown={props.onPointerDown}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDragEnd={props.onDragEnd}
      onDrop={props.onDrop}
      draggable={props.draggable}
    >
      {props.suffix}
    </div>
  )
}

function SplitUnderlineTab({ props, elementRef }: ResolvedTabViewProps) {
  const handleSelect = selectHandler(props)
  const cellClass = resolvedTabClassName('cell', props)

  const onLabelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    props.onKeyDown?.(event)
    if (!isActivationKey(event.key)) {
      return
    }
    event.preventDefault()
    handleSelect?.()
  }

  return (
    <div
      ref={elementRef as React.RefObject<HTMLDivElement>}
      className={cellClass}
      data-variant={props.variant}
      data-dragging={dataFlag(props.dragging)}
      data-editing={dataFlag(props.editing)}
      data-drop-indicator={props.dropIndicator}
      data-active={activeDataAttribute(props.active)}
      data-testid={props['data-testid']}
      title={props.title}
      onAuxClick={props.onAuxClick}
      onContextMenu={props.onContextMenu}
      onPointerDown={onlyFromContainer(props.onPointerDown)}
      onDragStart={onlyFromContainer(props.onDragStart)}
      onDragOver={onlyFromContainer(props.onDragOver)}
      onDragEnd={onlyFromContainer(props.onDragEnd)}
      onDrop={onlyFromContainer(props.onDrop)}
      draggable={props.draggable}
      onMouseDown={middleMouseDownHandler(props.onAuxClick)}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={props['aria-label']}
        aria-selected={props.active}
        className={labelButtonClassName(props.variant)}
        onClick={handleSelect}
        onKeyDown={onLabelKeyDown}
        onPointerDown={props.onPointerDown}
        onDragStart={props.onDragStart}
        onDragOver={props.onDragOver}
        onDragEnd={props.onDragEnd}
        onDrop={props.onDrop}
        draggable={props.draggable}
      >
        {props.prefix}
        {props.children}
      </div>
      <TabSuffixSlot props={props} />
    </div>
  )
}

function SimpleUnderlineTab({ props, elementRef }: ResolvedTabViewProps) {
  const simpleClass = resolvedTabClassName('simple', props)

  return (
    <button
      ref={elementRef as React.RefObject<HTMLButtonElement>}
      type="button"
      className={simpleClass}
      data-variant={props.variant}
      data-dragging={dataFlag(props.dragging)}
      data-editing={dataFlag(props.editing)}
      data-drop-indicator={props.dropIndicator}
      data-active={activeDataAttribute(props.active)}
      data-testid={props['data-testid']}
      aria-label={props['aria-label']}
      aria-selected={props.active}
      title={props.title}
      onClick={selectHandler(props)}
      onAuxClick={props.onAuxClick}
      onContextMenu={props.onContextMenu}
      onKeyDown={props.onKeyDown}
      onPointerDown={props.onPointerDown}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDragEnd={props.onDragEnd}
      onDrop={props.onDrop}
      draggable={props.draggable}
      onMouseDown={middleMouseDownHandler(props.onAuxClick)}
    >
      {props.children}
    </button>
  )
}

export function UnderlineTab({
  active = false,
  autoScrollOnActive = true,
  dragging = false,
  editing = false,
  variant = 'default',
  ...props
}: UnderlineTabProps) {
  const elementRef = useRef<HTMLDivElement | HTMLButtonElement>(null)

  useEffect(() => {
    const shouldScrollIntoView = autoScrollOnActive && active
    if (!shouldScrollIntoView) return
    elementRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, autoScrollOnActive])

  const resolvedProps: ResolvedUnderlineTabProps = {
    ...props,
    active: active,
    dragging: dragging,
    editing: editing,
    variant: variant,
  }
  const isSplit = props.prefix != null || props.suffix != null
  if (isSplit) return <SplitUnderlineTab props={resolvedProps} elementRef={elementRef} />
  return <SimpleUnderlineTab props={resolvedProps} elementRef={elementRef} />
}
