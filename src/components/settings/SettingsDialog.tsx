import { useCallback, useEffect, useState, type ComponentType } from 'react'
import { DialogShell } from '../dialogs/DialogShell'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { GearSix, X } from '@phosphor-icons/react'
import { Button } from '../common/Button'
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
import styles from './SettingsDialog.module.css'

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

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const activeSection = useSettingsStore((state) => state.activeSection)
  const setActiveSection = useSettingsStore((state) => state.setActiveSection)
  const isDirty = useSettingsStore((state) => state.isDirty)
  const hasValidationErrors = useSettingsStore(
    (state) => Object.keys(state.validationErrors).length > 0
  )
  const loadSettings = useSettingsStore((state) => state.loadSettings)
  const save = useSettingsStore((state) => state.save)
  const discard = useSettingsStore((state) => state.discard)
  const resetSection = useSettingsStore((state) => state.resetSection)
  const revertPreview = useThemeStore((state) => state.revertPreview)
  const dialogSection = useSettingsStore((state) => state.dialogSection)

  const [confirmOpen, setConfirmOpen] = useState(false)

  // Load settings when the dialog opens
  useEffect(() => {
    if (isOpen) {
      void loadSettings()
      // Load shortcuts from settings into shortcut store
      const settingsState = useSettingsStore.getState()
      const shortcutsSerialized = settingsState.getSetting('shortcuts')
      useShortcutStore.getState().loadShortcuts(shortcutsSerialized)

      // If the dialog was opened programmatically to a specific section, navigate there
      if (dialogSection) {
        setActiveSection(dialogSection as SettingsSection)
      }
    }
  }, [isOpen, loadSettings, dialogSection, setActiveSection])

  const handleSave = useCallback(async () => {
    const savedKeys = Object.keys(useSettingsStore.getState().pendingChanges)
    await save()
    // Invalid values block the save: keep the dialog open on the error.
    if (Object.keys(useSettingsStore.getState().validationErrors).length > 0) return
    const remainingPendingChanges = useSettingsStore.getState().pendingChanges
    const intervalSaveSucceeded =
      savedKeys.includes('updates.checkInterval') &&
      !('updates.checkInterval' in remainingPendingChanges)

    // After saving, reload shortcuts into the live shortcut store from the saved settings
    const savedShortcuts = useSettingsStore.getState().getSetting('shortcuts')
    useShortcutStore.getState().loadShortcuts(savedShortcuts)

    // Clear the zoom preview snapshot so a subsequent Cancel doesn't revert the saved zoom
    useZoomStore.setState({ previewSnapshot: null })

    if (intervalSaveSucceeded) {
      await useUpdateStore.getState().restartPeriodicCheck()
    }

    onClose()
  }, [save, onClose])

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
    // Reload shortcuts from saved settings to revert any local-only changes
    const savedShortcuts = useSettingsStore.getState().getSetting('shortcuts')
    useShortcutStore.getState().loadShortcuts(savedShortcuts)
    setConfirmOpen(false)
    onClose()
  }, [discard, revertPreview, onClose])

  const handleResetSection = useCallback(() => {
    resetSection(activeSection)
  }, [resetSection, activeSection])

  const handleSectionSelect = useCallback(
    (section: SettingsSection) => {
      setActiveSection(section)
    },
    [setActiveSection]
  )

  const ActiveSectionContent = SETTINGS_SECTION_CONTENT[activeSection]

  return (
    <>
      <DialogShell
        isOpen={isOpen}
        onClose={handleCancel}
        maxWidth={1400}
        testId="settings-dialog"
        ariaLabel="Settings"
        panelClassName={styles.panelNoPadding}
      >
        <div className={styles.layout}>
          <div className={styles.header}>
            <GearSix size={16} weight="regular" aria-hidden />
            <span className={styles.headerTitle}>Settings</span>
            <IconButton aria-label="Close settings" title="Close" onClick={handleCancel}>
              <X size={16} weight="regular" />
            </IconButton>
          </div>
          <SettingsSidebar activeSection={activeSection} onSelect={handleSectionSelect} />
          <div className={styles.scrollArea} data-testid="settings-content">
            <h2 className={styles.pageTitle}>
              {SETTINGS_SECTIONS.find((section) => section.id === activeSection)?.label}
            </h2>
            <ActiveSectionContent />
          </div>
          <div className={styles.footer}>
            <Button
              variant="subtle"
              onClick={handleResetSection}
              data-testid="settings-reset-section"
            >
              Reset section
            </Button>
            <div className={styles.footerRight}>
              <Button
                variant="accent"
                onClick={() => void handleSave()}
                disabled={!isDirty || hasValidationErrors}
                data-testid="settings-save"
              >
                Save
              </Button>
              <Button onClick={handleCancel} data-testid="settings-cancel">
                Cancel
              </Button>
            </div>
          </div>
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
