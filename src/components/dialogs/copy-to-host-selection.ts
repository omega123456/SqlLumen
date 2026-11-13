import {
  COPY_OBJECT_CATEGORY_ORDER,
  type CopyableObjects,
  type CopyObjectCategory,
  type CopyObjectSelection,
  type CopySelectionState,
} from '../../lib/copy-to-host-commands'

export type ExpandedCategories = Set<CopyObjectCategory>

export interface CategoryToggle {
  category: CopyObjectCategory
  names: string[]
}

export function categoryNames(objects: CopyableObjects, category: CopyObjectCategory): string[] {
  if (category === 'tables') {
    return objects.tables.map((table) => table.name)
  }
  return objects[category]
}

export function toggledSetMember<Member>(members: Set<Member>, member: Member): Set<Member> {
  const next = new Set(members)
  if (next.has(member)) {
    next.delete(member)
    return next
  }
  next.add(member)
  return next
}

export function initialExpandedCategories(
  preSelectedCategory: CopyObjectCategory | null
): ExpandedCategories {
  if (!preSelectedCategory) return new Set()
  return new Set([preSelectedCategory])
}

export function expandedWithPopulatedCategories(
  expanded: ExpandedCategories,
  objects: CopyableObjects
): ExpandedCategories {
  const populatedCategories = COPY_OBJECT_CATEGORY_ORDER.filter(
    (category) => categoryNames(objects, category).length > 0
  )
  return new Set([...expanded, ...populatedCategories])
}

export function selectionWithPreselectedObject(
  selected: CopySelectionState,
  objects: CopyableObjects,
  preselection: CopyObjectSelection
): CopySelectionState {
  const isCopyable = categoryNames(objects, preselection.category).includes(preselection.name)
  if (!isCopyable) return selected
  return { ...selected, [preselection.category]: new Set([preselection.name]) }
}

export function selectionWithObjectToggled(
  selected: CopySelectionState,
  { category, name }: CopyObjectSelection
): CopySelectionState {
  return { ...selected, [category]: toggledSetMember(selected[category], name) }
}

export function selectionWithCategoryToggled(
  selected: CopySelectionState,
  { category, names }: CategoryToggle
): CopySelectionState {
  const isWholeCategorySelected = selected[category].size === names.length
  const categorySelection = isWholeCategorySelected ? new Set<string>() : new Set(names)
  return { ...selected, [category]: categorySelection }
}
