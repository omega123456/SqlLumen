import { useCallback, useEffect, useState, type ComponentType } from 'react'
import { DialogShell } from '../dialogs/DialogShell'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { GearSix, X } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { SCROLLBAR, joinClassNames } from '../../lib/class-names'
import { IconButton } from '../common/IconButton'
import { SettingsSidebar } from './SettingsSidebar'
import { SETTINGS_SECTIONS } from './settings-sections'
import { GeneralSettings } from './GeneralSettings'
import { EditorSettings } from './EditorSettings'
import { ResultsSettings } from './ResultsSettings'
import { LoggingSettings } from './LoggingSettings'
import { ShortcutsSettings } from './ShortcutsSettings'
import { AiSettings } from './AiSettings'
import { UpdatesSettings } from './UpdatesSettings'
import { useSettingsStore } from '../../stores/settings-store'
import { useShortcutStore } from '../../stores/shortcut-store'
import { useThemeStore } from '../../stores/theme-store'
import { useZoomStore } from '../../stores/zoom-store'
import { useUpdateStore } from '../../stores/update-store'
import type { SettingsSection } from '../../types/schema'

const SETTINGS_SECTION_CONTENT: Record<SettingsSection, ComponentType> = {
  general: GeneralSettings,
  editor: EditorSettings,
  results: ResultsSettings,
  logging: LoggingSettings,
  shortcuts: ShortcutsSettings,
  ai: AiSettings,
  updates: UpdatesSettings,
}

export interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

function useLoadSettingsOnOpen(isOpen: boolean): void {
  const loadSettings = useSettingsStore((state) => state.loadSettings)
  const setActiveSection = useSettingsStore((state) => state.setActiveSection)
  const dialogSection = useSettingsStore((state) => state.dialogSection)

  useEffect(() => {
    if (isOpen) {
      void loadSettings()
      const settingsState = useSettingsStore.getState()
      const shortcutsSerialized = settingsState.getSetting('shortcuts')
      useShortcutStore.getState().loadShortcuts(shortcutsSerialized)
      if (dialogSection) {
        setActiveSection(dialogSection as SettingsSection)
      }
    }
  }, [isOpen, loadSettings, dialogSection, setActiveSection])
}

function useSaveSettings(onClose: () => void) {
  const save = useSettingsStore((state) => state.save)

  const handleSave = useCallback(async () => {
    const savedKeys = Object.keys(useSettingsStore.getState().pendingChanges)
    await save()
    if (Object.keys(useSettingsStore.getState().validationErrors).length > 0) return
    const remainingPendingChanges = useSettingsStore.getState().pendingChanges
    const intervalSaveSucceeded =
      savedKeys.includes('updates.checkInterval') &&
      !('updates.checkInterval' in remainingPendingChanges)
    const savedShortcuts = useSettingsStore.getState().getSetting('shortcuts')
    useShortcutStore.getState().loadShortcuts(savedShortcuts)
    useZoomStore.setState({ previewSnapshot: null })

    if (intervalSaveSucceeded) {
      await useUpdateStore.getState().restartPeriodicCheck()
    }

    onClose()
  }, [save, onClose])

  return handleSave
}

function useCancelSettings(onClose: () => void) {
  const isDirty = useSettingsStore((state) => state.isDirty)
  const discard = useSettingsStore((state) => state.discard)
  const revertPreview = useThemeStore((state) => state.revertPreview)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleCancel = useCallback(() => {
    if (isDirty) {
      setConfirmOpen(true)
      return
    }
    revertPreview()
    useZoomStore.getState().revertPreview()
    onClose()
  }, [isDirty, onClose, revertPreview])

  const handleConfirmDiscard = useCallback(() => {
    discard()
    revertPreview()
    useZoomStore.getState().revertPreview()
    const savedShortcuts = useSettingsStore.getState().getSetting('shortcuts')
    useShortcutStore.getState().loadShortcuts(savedShortcuts)
    setConfirmOpen(false)
    onClose()
  }, [discard, revertPreview, onClose])

  return { confirmOpen, setConfirmOpen, handleCancel, handleConfirmDiscard }
}

interface SettingsFooterProps {
  onSave: () => Promise<void>
  onCancel: () => void
}

function SettingsFooter({ onSave, onCancel }: SettingsFooterProps) {
  const activeSection = useSettingsStore((state) => state.activeSection)
  const isDirty = useSettingsStore((state) => state.isDirty)
  const hasValidationErrors = useSettingsStore(
    (state) => Object.keys(state.validationErrors).length > 0
  )
  const resetSection = useSettingsStore((state) => state.resetSection)
  return (
    <div className="col-span-full flex items-center justify-between gap-2 border-t border-light-stroke-divider bg-light-surface px-6 py-4 dark:border-dark-stroke-divider dark:bg-dark-surface">
      <Button
        variant="subtle"
        onClick={() => resetSection(activeSection)}
        data-testid="settings-reset-section"
      >
        Reset section
      </Button>
      <div className="flex items-center gap-2">
        <Button
          variant="accent"
          onClick={() => void onSave()}
          disabled={!isDirty || hasValidationErrors}
          data-testid="settings-save"
        >
          Save
        </Button>
        <Button onClick={onCancel} data-testid="settings-cancel">
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const activeSection = useSettingsStore((state) => state.activeSection)
  const setActiveSection = useSettingsStore((state) => state.setActiveSection)
  useLoadSettingsOnOpen(isOpen)
  const handleSave = useSaveSettings(onClose)
  const { confirmOpen, setConfirmOpen, handleCancel, handleConfirmDiscard } =
    useCancelSettings(onClose)
  const ActiveSectionContent = SETTINGS_SECTION_CONTENT[activeSection]

  return (
    <>
      <DialogShell
        isOpen={isOpen}
        onClose={handleCancel}
        maxWidth={1400}
        testId="settings-dialog"
        ariaLabel="Settings"
        panelPadding={false}
      >
        <div className="grid h-settings-dialog-height w-settings-dialog-width max-w-full grid-cols-settings grid-rows-settings overflow-hidden">
          <div className="col-span-full flex items-center gap-2.5 pr-2 pl-4 text-size-caption text-light-on-surface dark:text-dark-on-surface">
            <GearSix size={16} weight="regular" aria-hidden />
            <span className="flex-1">Settings</span>
            <IconButton aria-label="Close settings" title="Close" onClick={handleCancel}>
              <X size={16} weight="regular" />
            </IconButton>
          </div>
          <SettingsSidebar activeSection={activeSection} onSelect={setActiveSection} />
          <div
            className={joinClassNames([
              'flex min-h-0 flex-col overflow-y-auto pt-1 pr-8 pb-6 pl-5',
              SCROLLBAR,
            ])}
            data-testid="settings-content"
          >
            <h2 className="mb-3 font-headline text-title font-semibold text-light-on-surface dark:text-dark-on-surface">
              {SETTINGS_SECTIONS.find((section) => section.id === activeSection)?.label}
            </h2>
            <ActiveSectionContent />
          </div>
          <SettingsFooter onSave={handleSave} onCancel={handleCancel} />
        </div>
      </DialogShell>

      <ConfirmDialog
        isOpen={confirmOpen}
        title="Discard changes"
        message="You have unsaved settings changes. Are you sure you want to discard them?"
        confirmLabel="Discard"
        isDestructive
        warningText={null}
        onConfirm={handleConfirmDiscard}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}
