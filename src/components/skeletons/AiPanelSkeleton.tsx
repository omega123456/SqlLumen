import { joinClassNames } from '../../lib/class-names'
import { SHIMMER_BLOCK, SHIMMER_BLOCK_CONTROL } from '../../lib/class-names-skeleton'

const ASSISTANT_MESSAGE_BORDER =
  'border-l-2 border-l-light-primary-a35 dark:border-l-dark-primary-a35 pl-2'

export default function AiPanelSkeleton() {
  return (
    <div
      className="flex h-full flex-col border-l border-l-light-stroke-divider bg-light-surface-container dark:border-l-dark-stroke-divider dark:bg-dark-surface-container"
      aria-hidden="true"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 bg-light-surface-container px-2 dark:bg-dark-surface-container">
        <div className={joinClassNames([SHIMMER_BLOCK_CONTROL, 'h-4 w-25'])} />
        <div className="flex-1" />
        <div className={joinClassNames([SHIMMER_BLOCK_CONTROL, 'size-7 shrink-0'])} />
        <div className={joinClassNames([SHIMMER_BLOCK_CONTROL, 'size-7 shrink-0'])} />
      </div>
      <div className="flex flex-1 flex-col gap-4 px-2 py-4">
        <div
          className={joinClassNames([
            SHIMMER_BLOCK_CONTROL,
            ASSISTANT_MESSAGE_BORDER,
            'h-8 w-9/10',
          ])}
        />
        <div
          className={joinClassNames([
            SHIMMER_BLOCK_CONTROL,
            ASSISTANT_MESSAGE_BORDER,
            'h-5 w-7/10',
          ])}
        />
        <div
          className={joinClassNames([
            SHIMMER_BLOCK,
            'h-8 w-3/4 max-w-17/20 self-end rounded-t-overlay rounded-bl-overlay rounded-br-track',
          ])}
        />
        <div
          className={joinClassNames([SHIMMER_BLOCK_CONTROL, ASSISTANT_MESSAGE_BORDER, 'h-7 w-4/5'])}
        />
      </div>
      <div className="flex h-14 shrink-0 items-center gap-2 border-t border-t-light-stroke-divider px-2 dark:border-t-dark-stroke-divider">
        <div className={joinClassNames([SHIMMER_BLOCK, 'h-9 flex-1 rounded-card'])} />
        <div className={joinClassNames([SHIMMER_BLOCK_CONTROL, 'size-9 shrink-0'])} />
      </div>
    </div>
  )
}
