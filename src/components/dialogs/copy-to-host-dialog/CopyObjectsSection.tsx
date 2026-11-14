import { Button } from '../../common/Button'
import { Checkbox } from '../../common/Checkbox'
import type { CopyableObjects, CopyObjectCategory } from '../../../lib/copy-to-host-commands'
import { categoryNames } from '../copy-to-host-selection'
import { CATEGORY_LABELS, CATEGORY_ORDER } from './copy-to-host-model'
import styles from '../CopyToHostDialog.module.css'

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

function CopyObjectItems({ category, names, tree }: CopyObjectCategoryGroupProps) {
  const selectedSet = tree.selected[category]
  return (
    <div className={styles.objectItems}>
      {names.map((name) => (
        <div key={name} className={styles.objectItem}>
          <Checkbox
            checked={selectedSet.has(name)}
            onChange={() => tree.onToggleObject(category, name)}
            aria-label={name}
            data-testid={`copy-object-${category}-${name}`}
          />
          <span className={styles.objectItemLabel}>{name}</span>
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
  const caretClassName = isExpanded ? `${styles.caret} ${styles.caretOpen}` : styles.caret

  return (
    <div className={styles.objectCategory}>
      <div className={styles.objectCategoryHeader}>
        <Button
          variant="subtle"
          size="sm"
          className={styles.caretButton}
          onClick={() => tree.onToggleExpanded(category)}
          aria-expanded={isExpanded}
          aria-label={`${expandVerb} ${CATEGORY_LABELS[category]}`}
          data-testid={`copy-category-toggle-${category}`}
        >
          <svg
            className={caretClassName}
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
        <span className={styles.objectCategoryLabel}>{CATEGORY_LABELS[category]}</span>
        <span className={styles.objectCategoryCount}>({names.length})</span>
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
        <div className={styles.loading} data-testid="copy-loading-objects">
          Loading objects…
        </div>
      )}
      {loadError && (
        <div className={styles.error} data-testid="copy-load-error">
          {loadError}
        </div>
      )}
      {!loadingObjects && !loadError && objects && (
        <div className={styles.objectTree} data-testid="copy-object-tree">
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
