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
import { isActivationKey, isMiddleMouseButton } from '../../lib/input-events'
import styles from './UnderlineTabs.module.css'
import {
  BAR_VARIANT_CLASS,
  type UnderlineTabBarProps,
  type UnderlineTabVariant,
} from './underline-tabs/tab-bar-variants'
import { ScrollableTabBar } from './underline-tabs/ScrollableTabBar'

export type { UnderlineTabBarProps, UnderlineTabVariant } from './underline-tabs/tab-bar-variants'

const TAB_VARIANT_CLASS: Record<UnderlineTabVariant, string> = {
  default: '',
  selector: styles.tabSelector,
  document: styles.tabDocument,
}

export function UnderlineTabBar(props: UnderlineTabBarProps) {
  if (props.scrollable) {
    return <ScrollableTabBar {...props} />
  }
  const { children, className, 'data-testid': testId, prefix, suffix, variant = 'default' } = props
  const barClass = [styles.bar, BAR_VARIANT_CLASS[variant]].filter(Boolean).join(' ')
  if (prefix || suffix) {
    const wrapperClass = [styles.barWrapper, BAR_VARIANT_CLASS[variant], className]
      .filter(Boolean)
      .join(' ')
    return (
      <div className={wrapperClass} data-testid={testId}>
        {prefix}
        <div className={barClass}>{children}</div>
        {suffix ? <div className={styles.barSuffix}>{suffix}</div> : null}
      </div>
    )
  }
  const finalBarClass = className ? `${barClass} ${className}` : barClass
  return (
    <div className={finalBarClass} data-testid={testId}>
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
  dropIndicator?: 'before' | 'after'
  prefix?: ReactNode
  suffix?: ReactNode
  variant?: UnderlineTabVariant
}

const DROP_INDICATOR_CLASS: Record<NonNullable<UnderlineTabProps['dropIndicator']>, string> = {
  before: styles.dropBefore,
  after: styles.dropAfter,
}

type ResolvedUnderlineTabProps = UnderlineTabProps &
  Required<Pick<UnderlineTabProps, 'active' | 'dragging' | 'variant'>>

interface ResolvedTabViewProps {
  props: ResolvedUnderlineTabProps
  elementRef: RefObject<HTMLDivElement | HTMLButtonElement | null>
}

function joinClassNames(classNames: string[]): string {
  return classNames.filter(Boolean).join(' ')
}

function dropIndicatorClassName(dropIndicator: UnderlineTabProps['dropIndicator']): string {
  if (!dropIndicator) return ''
  return DROP_INDICATOR_CLASS[dropIndicator]
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

function tabStateClassNames(props: ResolvedUnderlineTabProps, activeClassName: string): string[] {
  return [
    TAB_VARIANT_CLASS[props.variant],
    props.active ? activeClassName : '',
    props.dragging ? styles.dragging : '',
    dropIndicatorClassName(props.dropIndicator),
  ]
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

function TabSuffixSlot({ props }: { props: ResolvedUnderlineTabProps }) {
  if (props.suffix == null) return null
  return (
    <div
      className={styles.suffixSlot}
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
  const cellClass = joinClassNames([
    styles.cell,
    ...tabStateClassNames(props, styles.cellActive),
    props.className ?? '',
  ])

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
        className={styles.labelButton}
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
  const simpleClass = joinClassNames([
    styles.simple,
    ...tabStateClassNames(props, styles.simpleActive),
    props.className ?? '',
  ])

  return (
    <button
      ref={elementRef as React.RefObject<HTMLButtonElement>}
      type="button"
      className={simpleClass}
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
    variant: variant,
  }
  const isSplit = props.prefix != null || props.suffix != null
  if (isSplit) return <SplitUnderlineTab props={resolvedProps} elementRef={elementRef} />
  return <SimpleUnderlineTab props={resolvedProps} elementRef={elementRef} />
}
