import type { DataViewPatch, DataViewState } from './data-view-types'

type MergedViewGroup = Exclude<keyof DataViewState, 'mode' | 'rowAction'>

function mergedGroup<Group extends MergedViewGroup>(
  view: DataViewState,
  patch: DataViewPatch,
  group: Group
): DataViewState[Group] {
  const groupPatch = patch[group]
  if (!groupPatch) return view[group]
  return { ...view[group], ...groupPatch }
}

function patchedRowAction(view: DataViewState, patch: DataViewPatch) {
  if (patch.rowAction === undefined) return view.rowAction
  return patch.rowAction
}

export function applyViewPatch(view: DataViewState, patch: DataViewPatch): DataViewState {
  return {
    mode: patch.mode ?? view.mode,
    slot: mergedGroup(view, patch, 'slot'),
    selection: mergedGroup(view, patch, 'selection'),
    checked: mergedGroup(view, patch, 'checked'),
    layout: mergedGroup(view, patch, 'layout'),
    spec: mergedGroup(view, patch, 'spec'),
    window: mergedGroup(view, patch, 'window'),
    edit: mergedGroup(view, patch, 'edit'),
    editTarget: mergedGroup(view, patch, 'editTarget'),
    residency: mergedGroup(view, patch, 'residency'),
    prompts: mergedGroup(view, patch, 'prompts'),
    rowAction: patchedRowAction(view, patch),
  }
}

function mergedGroupPatch<Group extends MergedViewGroup>(
  base: DataViewPatch,
  override: DataViewPatch,
  group: Group
): DataViewPatch[Group] {
  const baseGroup = base[group]
  const overrideGroup = override[group]
  if (!baseGroup) return overrideGroup
  if (!overrideGroup) return baseGroup
  return { ...baseGroup, ...overrideGroup }
}

export function mergeViewPatches(base: DataViewPatch, override: DataViewPatch): DataViewPatch {
  return {
    ...base,
    ...override,
    slot: mergedGroupPatch(base, override, 'slot'),
    selection: mergedGroupPatch(base, override, 'selection'),
    checked: mergedGroupPatch(base, override, 'checked'),
    layout: mergedGroupPatch(base, override, 'layout'),
    spec: mergedGroupPatch(base, override, 'spec'),
    window: mergedGroupPatch(base, override, 'window'),
    edit: mergedGroupPatch(base, override, 'edit'),
    editTarget: mergedGroupPatch(base, override, 'editTarget'),
    residency: mergedGroupPatch(base, override, 'residency'),
    prompts: mergedGroupPatch(base, override, 'prompts'),
  }
}
