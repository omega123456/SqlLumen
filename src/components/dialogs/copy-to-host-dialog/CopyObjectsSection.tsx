import { Button } from '../../common/Button'
import { Checkbox } from '../../common/Checkbox'
import type { CopyableObjects, CopyObjectCategory } from '../../../lib/copy-to-host-commands'
import { categoryNames } from '../copy-to-host-selection'
import { CATEGORY_LABELS, CATEGORY_ORDER } from './copy-to-host-model'
import { joinClassNames } from '../../../lib/class-names'
import {
  DIALOG_LOADING,
  DIALOG_INLINE_ERROR_BOX,
  DIALOG_OBJECT_CATEGORY_LABEL,
  DIALOG_OBJECT_COUNT,
  DIALOG_OBJECT_GROUP_HEADER,
  DIALOG_OBJECT_NAME,
  DIALOG_OBJECT_TREE,
} from '../../../lib/class-names-dialog'

export interface CopyObjectTreeProps {
  objects: CopyableObjects | null
  selected: Record<CopyObjectCategory, Set<string>>
  expandedCategories: Set<CopyObjectCategory>
  onToggleExpanded: (category: CopyObjectCategory) => void
  onToggleCategory: (category: CopyObjectCategory) => void
  onToggleObject: (category: CopyObjectCategory, name: string) => void
}

interface CopyObjectCategoryGroupProps {
  category: CopyObjectCategory
  names: string[]
  tree: CopyObjectTreeProps
}

type CaretState = 'collapsed' | 'expanded'

const CARET_STATE_CLASSES: Record<CaretState, string> = {
  collapsed: '',
  expanded: 'rotate-90',
}

function caretClassName(isExpanded: boolean): string {
  const state: CaretState = isExpanded ? 'expanded' : 'collapsed'
  return joinClassNames(['size-3.5 transition-rotate duration-200', CARET_STATE_CLASSES[state]])
}

function CopyObjectItems({ category, names, tree }: CopyObjectCategoryGroupProps) {
  const selectedSet = tree.selected[category]
  return (
    <div className="flex flex-col gap-0.5">
      {names.map((name) => (
        <div key={name} className="flex items-center gap-2 py-0.5 pl-8">
          <Checkbox
            checked={selectedSet.has(name)}
            onChange={() => tree.onToggleObject(category, name)}
            aria-label={name}
            data-testid={`copy-object-${category}-${name}`}
          />
          <span className={DIALOG_OBJECT_NAME}>{name}</span>
        </div>
      ))}
    </div>
  )
}

function CopyObjectCategoryGroup({ category, names, tree }: CopyObjectCategoryGroupProps) {
  const selectedSet = tree.selected[category]
  const isEmpty = names.length === 0
  const allSelected = !isEmpty && selectedSet.size === names.length
  const someSelected = selectedSet.size > 0 && !allSelected
  const isExpanded = tree.expandedCategories.has(category)
  const expandVerb = isExpanded ? 'Collapse' : 'Expand'

  return (
    <div className="mb-1">
      <div className={DIALOG_OBJECT_GROUP_HEADER}>
        <Button
          variant="subtleMuted"
          size="tiny"
          iconOnly
          onClick={() => tree.onToggleExpanded(category)}
          aria-expanded={isExpanded}
          aria-label={`${expandVerb} ${CATEGORY_LABELS[category]}`}
          data-testid={`copy-category-toggle-${category}`}
        >
          <svg
            className={caretClassName(isExpanded)}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Button>
        <Checkbox
          checked={allSelected}
          disabled={isEmpty}
          ref={(element) => {
            if (element) element.indeterminate = someSelected
          }}
          onChange={() => tree.onToggleCategory(category)}
          aria-label={`Select all ${CATEGORY_LABELS[category]}`}
          data-testid={`copy-category-${category}`}
        />
        <span className={DIALOG_OBJECT_CATEGORY_LABEL}>{CATEGORY_LABELS[category]}</span>
        <span className={DIALOG_OBJECT_COUNT}>({names.length})</span>
      </div>
      {isExpanded && !isEmpty && <CopyObjectItems category={category} names={names} tree={tree} />}
    </div>
  )
}

interface CopyObjectsBodyProps {
  loadingObjects: boolean
  loadError: string | null
  tree: CopyObjectTreeProps
}

export function CopyObjectsBody({ loadingObjects, loadError, tree }: CopyObjectsBodyProps) {
  const objects = tree.objects
  return (
    <>
      {loadingObjects && (
        <div className={DIALOG_LOADING} data-testid="copy-loading-objects">
          Loading objects…
        </div>
      )}
      {loadError && (
        <div className={DIALOG_INLINE_ERROR_BOX} data-testid="copy-load-error">
          {loadError}
        </div>
      )}
      {!loadingObjects && !loadError && objects && (
        <div
          className={joinClassNames([DIALOG_OBJECT_TREE, 'max-h-115'])}
          data-testid="copy-object-tree"
        >
          {CATEGORY_ORDER.map((category) => (
            <CopyObjectCategoryGroup
              key={category}
              category={category}
              names={categoryNames(objects, category)}
              tree={tree}
            />
          ))}
        </div>
      )}
    </>
  )
}
