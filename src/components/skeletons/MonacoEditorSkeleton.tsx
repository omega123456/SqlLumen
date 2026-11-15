import { joinClassNames } from '../../lib/class-names'
import { SHIMMER_BLOCK_CONTROL } from '../../lib/class-names-skeleton'

const LINE_WIDTHS = ['75%', '55%', '90%', '40%', '70%', '85%', '50%', '65%']

export default function MonacoEditorSkeleton() {
  return (
    <div className="flex size-full bg-light-surface dark:bg-dark-surface" aria-hidden="true">
      <div
        className={joinClassNames([
          SHIMMER_BLOCK_CONTROL,
          'w-10 shrink-0 border-r border-r-light-outline-variant dark:border-r-dark-outline-variant',
        ])}
      />
      <div className="flex flex-1 flex-col gap-2 py-2 pl-3">
        {LINE_WIDTHS.map((width, index) => (
          <div
            key={index}
            className={joinClassNames([SHIMMER_BLOCK_CONTROL, 'h-3.25 shrink-0'])}
            style={{ width }}
          />
        ))}
      </div>
    </div>
  )
}
