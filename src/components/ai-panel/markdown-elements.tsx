import { createElement, type ComponentPropsWithoutRef, type ReactElement } from 'react'
import type { Components, ExtraProps } from 'react-markdown'
import { joinClassNames, SCROLLBAR } from '../../lib/class-names'

type MarkdownTag =
  'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'ul' | 'ol' | 'pre' | 'table' | 'th' | 'td'

function markdownElement<Tag extends MarkdownTag>(tag: Tag, classNames: string) {
  return function MarkdownElement({
    node: _node,
    className,
    ...props
  }: ComponentPropsWithoutRef<Tag> & ExtraProps): ReactElement {
    return createElement(tag, { ...props, className: joinClassNames([classNames, className]) })
  }
}

const HEADING_BASE = 'font-bold wrap-break-word'
const TABLE_CELL =
  'border border-light-stroke-divider px-2 py-1 text-left dark:border-dark-stroke-divider'

export const INLINE_CODE_CLASSES =
  'font-mono outside-pre:rounded-control outside-pre:bg-light-surface-container-lowest outside-pre:px-1.5 outside-pre:py-0.5 outside-pre:text-size-inline-code dark:outside-pre:bg-dark-surface-container-lowest'

export const MARKDOWN_ELEMENTS: Components = {
  p: markdownElement('p', 'mb-2.5 wrap-break-word'),
  h1: markdownElement('h1', joinClassNames(['text-size-heading-1', HEADING_BASE])),
  h2: markdownElement('h2', joinClassNames(['text-size-heading-2', HEADING_BASE])),
  h3: markdownElement('h3', joinClassNames(['text-size-heading-3', HEADING_BASE])),
  h4: markdownElement('h4', joinClassNames(['text-size-heading-4', HEADING_BASE])),
  h5: markdownElement('h5', joinClassNames(['text-size-heading-5', HEADING_BASE])),
  h6: markdownElement('h6', joinClassNames(['text-size-heading-6', HEADING_BASE])),
  ul: markdownElement(
    'ul',
    'my-2 pl-6 top-level-list:list-disc second-level-list:list-circle deep-list:list-square'
  ),
  ol: markdownElement('ol', 'my-2 list-decimal pl-6'),
  pre: markdownElement(
    'pre',
    joinClassNames(['my-2.5 overflow-x-auto font-generic-mono', SCROLLBAR])
  ),
  table: markdownElement('table', 'my-2 w-full border-collapse'),
  th: markdownElement(
    'th',
    joinClassNames([
      TABLE_CELL,
      'bg-light-surface-container-lowest font-semibold dark:bg-dark-surface-container-lowest',
    ])
  ),
  td: markdownElement('td', TABLE_CELL),
}
