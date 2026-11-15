import { joinClassNames } from '../../lib/class-names'
import { SHIMMER_BLOCK_CONTROL } from '../../lib/class-names-skeleton'

const TAB_WIDTHS = ['70px', '65px', '100px', '120px', '85px']
const CELL_INNER_WIDTHS = [
  ['80%', '70%', '60%', '75%'],
  ['65%', '85%', '50%', '90%'],
  ['75%', '60%', '70%', '65%'],
  ['90%', '75%', '55%', '80%'],
]
const CELL_WIDTH_CLASSES = ['w-7/20', 'w-1/4', 'w-3/20', 'w-3/20']

export default function TableDesignerSkeleton() {
  return (
    <div className="flex size-full flex-col gap-4 px-6 py-4" aria-hidden="true">
      <div className="flex items-center gap-2">
        <div className={joinClassNames([SHIMMER_BLOCK_CONTROL, 'size-6 shrink-0'])} />
        <div className={joinClassNames([SHIMMER_BLOCK_CONTROL, 'h-6 w-50'])} />
        <div className="flex-1" />
        <div className={joinClassNames([SHIMMER_BLOCK_CONTROL, 'h-8 w-20 shrink-0'])} />
        <div className={joinClassNames([SHIMMER_BLOCK_CONTROL, 'h-8 w-20 shrink-0'])} />
      </div>
      <div className="flex gap-2 overflow-hidden">
        {TAB_WIDTHS.map((width, index) => (
          <div
            key={index}
            className={joinClassNames([SHIMMER_BLOCK_CONTROL, 'h-8 shrink-0'])}
            style={{ width: width }}
          />
        ))}
      </div>
      <div className="flex flex-1 flex-col">
        <div className={joinClassNames([SHIMMER_BLOCK_CONTROL, 'h-8 w-full'])} />
        {CELL_INNER_WIDTHS.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className="flex h-8 border-b border-b-light-outline-variant dark:border-b-dark-outline-variant"
          >
            {row.map((cellWidth, cellIndex) => (
              <div
                key={cellIndex}
                className={joinClassNames([
                  'flex items-center px-2',
                  CELL_WIDTH_CLASSES[cellIndex],
                ])}
              >
                <div
                  className={joinClassNames([SHIMMER_BLOCK_CONTROL, 'h-3.5'])}
                  style={{ width: cellWidth }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
