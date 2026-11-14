import { useEffect, useEffectEvent, useState } from 'react'
import { getAppInfo } from '../../../lib/app-info-commands'
import { logFrontend } from '../../../lib/app-log-commands'
import { useUpdateStore } from '../../../stores/update-store'

export function useAppVersion(): string {
  const status = useUpdateStore((state) => state.status)
  const checkForUpdate = useUpdateStore((state) => state.checkForUpdate)
  const [appVersion, setAppVersion] = useState('Loading…')

  const recheckAnnouncedUpdate = useEffectEvent(() => {
    if (status === 'available') {
      void checkForUpdate(false)
    }
  })

  useEffect(() => {
    let cancelled = false
    void getAppInfo()
      .then((info) => {
        if (!cancelled) setAppVersion(info.appVersion)
      })
      .catch((error: unknown) => {
        logFrontend('error', `[updates-settings] Failed to load app version: ${String(error)}`)
        if (!cancelled) setAppVersion('Unavailable')
      })
    recheckAnnouncedUpdate()
    return () => {
      cancelled = true
    }
  }, [])

  return appVersion
}
