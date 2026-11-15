import { joinClassNames, SCROLLBAR } from './class-names'
import { FOCUS_RING } from './focus-ring'

export const DIALOG_HEADER_TITLE =
  'font-headline text-subtitle font-semibold wrap-break-word text-light-on-surface dark:text-dark-on-surface'

export const DIALOG_TITLE = joinClassNames(['mb-3', DIALOG_HEADER_TITLE])

export const DIALOG_HEADER = 'flex items-center justify-between px-6 pt-6'

export const DIALOG_CLOSE_BUTTON = joinClassNames([
  'flex size-8 cursor-pointer items-center justify-center rounded-control text-light-on-surface transition-bg-and-color hover:bg-light-fill-subtle-hover dark:text-dark-on-surface dark:hover:bg-dark-fill-subtle-hover',
  FOCUS_RING,
])

export const DIALOG_FIELD_LABEL =
  'mb-1.5 block font-body text-size-caption font-regular text-light-on-surface-variant dark:text-dark-on-surface-variant'

export const DIALOG_FIELD_GROUP = 'mb-4'

export const DIALOG_ERROR_BOX =
  'mt-3 rounded-card border border-light-error-a20 bg-light-error-container px-3 py-2 font-body text-size-caption text-light-error dark:border-dark-error-a20 dark:bg-dark-error-container dark:text-dark-error'

export const DIALOG_FOOTER_SURFACE =
  'border-t border-light-stroke-divider bg-light-surface p-6 dark:border-dark-stroke-divider dark:bg-dark-surface'

export const DIALOG_FOOTER_BLEED = joinClassNames([DIALOG_FOOTER_SURFACE, '-mx-6 -mb-6'])

export const DIALOG_FOOTER_ACTIONS = joinClassNames([
  DIALOG_FOOTER_BLEED,
  'mt-6 flex justify-end gap-2',
])

export const DIALOG_FOOTER_GRID = joinClassNames([DIALOG_FOOTER_BLEED, 'grid grid-cols-2 gap-2'])

export const DIALOG_JOB_FOOTER_GRID = joinClassNames([DIALOG_FOOTER_GRID, 'mt-2'])

export const DIALOG_PANEL_FOOTER = joinClassNames([
  DIALOG_FOOTER_SURFACE,
  'flex shrink-0 items-center justify-end gap-2',
])

export const DIALOG_INLINE_ERROR_BOX =
  'rounded-card border border-light-stroke-card bg-light-error-container px-3 py-2 font-body text-size-body text-light-error dark:border-dark-stroke-card dark:bg-dark-error-container dark:text-dark-error'

export const DIALOG_LOADING =
  'flex items-center justify-center p-6 font-body text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant'

export const DIALOG_OBJECT_TREE = joinClassNames([
  'overflow-y-auto rounded-card border border-light-stroke-card bg-light-fill-control p-2 dark:border-dark-stroke-card dark:bg-dark-fill-control',
  SCROLLBAR,
])

export const DIALOG_CHECKBOX_LABEL =
  'cursor-pointer select-none font-body text-size-body text-light-on-surface dark:text-dark-on-surface'

export const DIALOG_OBJECT_CATEGORY_LABEL =
  'font-body text-size-caption font-semibold text-light-on-surface dark:text-dark-on-surface'

export const DIALOG_OBJECT_COUNT =
  'font-body text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant'

export const DIALOG_OBJECT_NAME =
  'font-mono text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant'

export const DIALOG_OBJECT_GROUP_HEADER = 'flex select-none items-center gap-2 py-1'

export const DIALOG_EDGE_TO_EDGE_ROOT = '-m-6 flex flex-col overflow-hidden rounded-overlay'

const DIALOG_BODY = 'flex flex-col px-6 pt-3 pb-6'

export const DIALOG_JOB_BODY = joinClassNames([DIALOG_BODY, 'gap-4'])

export const DIALOG_CHECKBOX_ROW = 'flex cursor-pointer items-center gap-2'

export const EXPORT_DIALOG_BODY = joinClassNames([DIALOG_BODY, 'gap-3.5'])

export const DIALOG_FORM_FIELD = 'flex flex-col gap-2'

export const DIALOG_FORM_LABEL =
  'font-body text-size-body font-regular text-light-on-surface dark:text-dark-on-surface'

export const DIALOG_PROGRESS_PANEL =
  'flex flex-col gap-2.5 rounded-card border border-light-stroke-card bg-light-fill-control px-3.5 py-3 dark:border-dark-stroke-card dark:bg-dark-fill-control'

export const DIALOG_PROGRESS_LABEL =
  'shrink-0 font-mono text-size-caption whitespace-nowrap text-light-on-surface-variant dark:text-dark-on-surface-variant'

export const DIALOG_PROGRESS_TRACK =
  'h-1 overflow-hidden rounded-track bg-light-fill-neutral-selected dark:bg-dark-fill-neutral-selected'

export const DIALOG_PROGRESS_COUNT =
  'font-mono text-size-caption whitespace-nowrap text-light-on-surface dark:text-dark-on-surface'

export const DIALOG_DESTINATION_GROUP =
  'flex items-stretch overflow-hidden rounded-control border border-light-stroke-control bg-light-fill-control transition-shadow focus-within:border-light-primary focus-within:shadow-light-field-focus dark:border-dark-stroke-control dark:bg-dark-fill-control dark:focus-within:border-dark-primary dark:focus-within:shadow-dark-field-focus'

export const DIALOG_DESTINATION_PREFIX =
  'flex items-center border-r border-light-stroke-divider bg-light-surface-container-highest px-2.5 font-mono text-size-caption whitespace-nowrap text-light-on-surface-variant select-none dark:border-dark-stroke-divider dark:bg-dark-surface-container-highest dark:text-dark-on-surface-variant'

export const DIALOG_DESTINATION_INPUT = joinClassNames([
  'min-w-0 flex-1 border-none bg-transparent px-2.5 py-1.25 font-body text-size-body leading-5 text-light-on-surface placeholder:text-light-outline dark:text-dark-on-surface dark:placeholder:text-dark-outline',
  FOCUS_RING,
])

export const DIALOG_BROWSE_BUTTON = joinClassNames([
  'flex cursor-pointer items-center justify-center px-4 text-light-on-surface-variant transition-color hover:bg-light-fill-subtle-hover hover:text-light-on-surface dark:text-dark-on-surface-variant dark:hover:bg-dark-fill-subtle-hover dark:hover:text-dark-on-surface svg:size-5',
  FOCUS_RING,
])

export const DIALOG_SECTION_FIELD_GROUP = 'mb-2.5 flex flex-col gap-1.5 last:mb-0'

export const DIALOG_SECTION_FIELD_LABEL =
  'font-body text-size-caption font-semibold text-light-on-surface-variant dark:text-dark-on-surface-variant'
