import { useCallback, useEffect, useState } from 'react'
import { DialogShell } from '../dialogs/DialogShell'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { Button } from '../common/Button'
import { SettingsSidebar } from './SettingsSidebar'
import { GeneralSettings } from './GeneralSettings'
import { EditorSettings } from './EditorSettings'
import { ResultsSettings } from './ResultsSettings'
import { LoggingSettings } from './LoggingSettings'
import { ShortcutsSettings } from './ShortcutsSettings'
import { AiSettings } from './AiSettings'
import { useSettingsStore } from '../../stores/settings-store'
import { useShortcutStore } from '../../stores/shortcut-store'
import { useThemeStore } from '../../stores/theme-store'
import type { SettingsSection } from '../../types/schema'
import styles from './SettingsDialog.module.css'

export interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const activeSection = useSettingsStore((s) => s.activeSection)
  const setActiveSection = useSettingsStore((s) => s.setActiveSection)
  const isDirty = useSettingsStore((s) => s.isDirty)
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const save = useSettingsStore((s) => s.save)
  const discard = useSettingsStore((s) => s.discard)
  const resetSection = useSettingsStore((s) => s.resetSection)
  const revertPreview = useThemeStore((s) => s.revertPreview)
  const dialogSection = useSettingsStore((s) => s.dialogSection)

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
    await save()

    // After saving, reload shortcuts into the live shortcut store from the saved settings
    const savedShortcuts = useSettingsStore.getState().getSetting('shortcuts')
    useShortcutStore.getState().loadShortcuts(savedShortcuts)

    onClose()
  }, [save, onClose])

  const handleCancel = useCallback(() => {
    if (isDirty) {
      setConfirmOpen(true)
    } else {
      revertPreview()
      onClose()
    }
  }, [isDirty, onClose, revertPreview])

  const handleConfirmDiscard = useCallback(() => {
    discard()
    revertPreview()
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

  const renderContent = () => {
    switch (activeSection) {
      case 'general':
        return <GeneralSettings />
      case 'editor':
        return <EditorSettings />
      case 'results':
        return <ResultsSettings />
      case 'logging':
        return <LoggingSettings />
      case 'shortcuts':
        return <ShortcutsSettings />
      case 'ai':
        return <AiSettings />
    }
  }

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
          <SettingsSidebar activeSection={activeSection} onSelect={handleSectionSelect} />
          <div className={styles.content}>
            <div className={styles.scrollArea} data-testid="settings-content">
              {renderContent()}
            </div>
            <div className={styles.footer}>
              <Button
                variant="secondary"
                onClick={handleResetSection}
                data-testid="settings-reset-section"
              >
                Reset Section
              </Button>
              <div className={styles.footerRight}>
                <Button variant="secondary" onClick={handleCancel} data-testid="settings-cancel">
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void handleSave()}
                  disabled={!isDirty}
                  data-testid="settings-save"
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogShell>

      <ConfirmDialog
        isOpen={confirmOpen}
        title="Discard Changes"
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
