import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  countCopySelection,
  createEmptyCopySelection,
  listCopyableObjects,
  type CopyableObjects,
  type CopyObjectCategory,
} from '../../../lib/copy-to-host-commands'
import { logFrontendError } from '../../../lib/app-log-commands'
import { toErrorMessage } from '../../../lib/error-message'
import { showErrorToast } from '../../../stores/toast-store'
import {
  categoryNames,
  expandedWithPopulatedCategories,
  initialExpandedCategories,
  selectionWithCategoryToggled,
  selectionWithObjectToggled,
  selectionWithPreselectedObject,
  toggledSetMember,
} from '../copy-to-host-selection'
import { preselectionKey, type CopyToHostDialogProps } from './copy-to-host-model'

type CopyObjectsSource = Pick<
  CopyToHostDialogProps,
  'sourceConnectionId' | 'sourceDatabase' | 'preSelectedObject'
>

function reportObjectsLoadFailure(error: unknown): string {
  const message = toErrorMessage(error)
  logFrontendError('[copy-to-host] Failed to load copyable objects:', message)
  showErrorToast('Failed to load copyable objects', message)
  return message
}

function useCopyObjectSelection(objects: CopyableObjects | null) {
  const [selected, setSelected] = useState(createEmptyCopySelection)

  const toggleObject = useCallback((category: CopyObjectCategory, name: string) => {
    setSelected((previous) =>
      selectionWithObjectToggled(previous, { category: category, name: name })
    )
  }, [])

  const toggleCategory = useCallback(
    (category: CopyObjectCategory) => {
      if (!objects) return
      const categoryToggle = { category: category, names: categoryNames(objects, category) }
      setSelected((previous) => selectionWithCategoryToggled(previous, categoryToggle))
    },
    [objects]
  )

  const selectedCount = useMemo(() => countCopySelection(selected), [selected])
  return { selected, setSelected, selectedCount, toggleObject, toggleCategory }
}

export function useCopyObjects(source: CopyObjectsSource) {
  const { sourceConnectionId, sourceDatabase, preSelectedObject } = source
  const [objects, setObjects] = useState<CopyableObjects | null>(null)
  const [loadingObjects, setLoadingObjects] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expandedCategories, setExpandedCategories] = useState<Set<CopyObjectCategory>>(() =>
    initialExpandedCategories(preSelectedObject?.category ?? null)
  )
  const selection = useCopyObjectSelection(objects)
  const { setSelected } = selection
  const { category: preSelectedCategory, name: preSelectedName } =
    preselectionKey(preSelectedObject)

  useEffect(() => {
    let cancelled = false
    const loadObjects = async () => {
      setLoadingObjects(true)
      setLoadError(null)
      try {
        const result = await listCopyableObjects(sourceConnectionId, sourceDatabase)
        if (cancelled) return
        setObjects(result)
        setExpandedCategories((previous) => expandedWithPopulatedCategories(previous, result))
        if (!preSelectedCategory) return
        if (!preSelectedName) return
        const preselection = { category: preSelectedCategory, name: preSelectedName }
        setSelected((previous) => selectionWithPreselectedObject(previous, result, preselection))
      } catch (error) {
        if (!cancelled) setLoadError(reportObjectsLoadFailure(error))
      } finally {
        if (!cancelled) setLoadingObjects(false)
      }
    }
    void loadObjects()
    return () => {
      cancelled = true
    }
  }, [sourceConnectionId, sourceDatabase, preSelectedCategory, preSelectedName, setSelected])

  const toggleCategoryExpanded = useCallback((category: CopyObjectCategory) => {
    setExpandedCategories((previous) => toggledSetMember(previous, category))
  }, [])

  return {
    objects,
    loadingObjects,
    loadError,
    expandedCategories,
    toggleCategoryExpanded,
    ...selection,
  }
}
