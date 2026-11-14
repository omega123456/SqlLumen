import { useState } from 'react'
import { useSettingsStore } from '../../../stores/settings-store'
import { useUpdateStore } from '../../../stores/update-store'
import { buildPendingWorkSummary, type ConfirmAction } from './pending-work'

interface ConfirmState {
  isOpen: boolean
  action: ConfirmAction
}

const CLOSED_DOWNLOAD_CONFIRM: ConfirmState = { isOpen: false, action: 'download' }

function useConfirmState() {
  const [confirm, setConfirm] = useState<ConfirmState>(CLOSED_DOWNLOAD_CONFIRM)
  const [isConfirmingAction, setIsConfirmingAction] = useState(false)
  const openConfirm = (action: ConfirmAction) => setConfirm({ isOpen: true, action: action })
  const closeConfirm = () => setConfirm((current) => ({ ...current, isOpen: false }))
  return { confirm, isConfirmingAction, setIsConfirmingAction, openConfirm, closeConfirm }
}

export function useUpdateActions() {
  const closeSettingsDialog = useSettingsStore((state) => state.closeDialog)
  const checkForUpdate = useUpdateStore((state) => state.checkForUpdate)
  const downloadAndInstall = useUpdateStore((state) => state.downloadAndInstall)
  const restartApp = useUpdateStore((state) => state.restartApp)
  const readyToFinishAction = useUpdateStore((state) => state.readyToFinishAction)
  const confirmState = useConfirmState()
  const { confirm, setIsConfirmingAction, openConfirm, closeConfirm } = confirmState

  const runOrConfirm = (action: ConfirmAction, run: () => Promise<void>) => {
    if (buildPendingWorkSummary().hasWork) {
      openConfirm(action)
      return
    }
    void run()
  }

  const handleRestartAction = (): void => {
    if (readyToFinishAction === 'manual-quit') {
      closeSettingsDialog()
      return
    }
    runOrConfirm('restart', restartApp)
  }

  const handleConfirmAction = (): void => {
    setIsConfirmingAction(true)
    const action = confirm.action === 'download' ? downloadAndInstall : restartApp
    void action().finally(() => {
      setIsConfirmingAction(false)
      closeConfirm()
    })
  }

  return {
    ...confirmState,
    handleManualCheck: () => void checkForUpdate(true),
    handleDownloadUpdate: () => runOrConfirm('download', downloadAndInstall),
    handleRestartAction: handleRestartAction,
    handleConfirmAction: handleConfirmAction,
    closeSettingsDialog: closeSettingsDialog,
  }
}

export type UpdateActions = ReturnType<typeof useUpdateActions>
