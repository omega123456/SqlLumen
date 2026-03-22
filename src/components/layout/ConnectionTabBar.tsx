import { Sun, Moon, GearSix, Plus, X } from '@phosphor-icons/react'
import { useThemeStore } from '../../stores/theme-store'
import { useConnectionStore } from '../../stores/connection-store'
import type { Theme } from '../../stores/theme-store'
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator'
import { UnderlineTabBar, UnderlineTab } from '../common/UnderlineTabs'
import styles from './ConnectionTabBar.module.css'

export function ConnectionTabBar() {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const setTheme = useThemeStore((state) => state.setTheme)

  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const activeTabId = useConnectionStore((state) => state.activeTabId)
  const switchTab = useConnectionStore((state) => state.switchTab)
  const closeConnection = useConnectionStore((state) => state.closeConnection)
  const openDialog = useConnectionStore((state) => state.openDialog)

  const handleThemeToggle = () => {
    const nextTheme: Theme = resolvedTheme === 'light' ? 'dark' : 'light'
    void setTheme(nextTheme)
  }

  const tabs = Object.values(activeConnections)
  const tabsByProfileId = new Map<string, typeof tabs>()
  for (const c of tabs) {
    const pid = c.profile.id
    const list = tabsByProfileId.get(pid) ?? []
    list.push(c)
    tabsByProfileId.set(pid, list)
  }
  const tabDisplayName = (c: (typeof tabs)[0]) => {
    const list = tabsByProfileId.get(c.profile.id) ?? []
    if (list.length <= 1) {
      return c.profile.name
    }
    const idx = list.findIndex((x) => x.id === c.id) + 1
    if (idx === 1) {
      return c.profile.name
    }
    return `${c.profile.name} (${idx})`
  }

  return (
    <div className={styles.tabBar} data-testid="connection-tab-bar">
      <div className={styles.leftSection}>
        <button
          className={styles.iconButton}
          type="button"
          aria-label="New Connection"
          title="New Connection"
          onClick={openDialog}
        >
          <Plus size={20} weight="regular" />
        </button>
      </div>
      {tabs.length > 0 && (
        <div className={styles.tabsSection}>
          <UnderlineTabBar className={styles.connectionTabRail}>
            {tabs.map((conn) => {
              const isActive = conn.id === activeTabId
              const displayName =
                conn.profile.name.trim() !== '' ? conn.profile.name.trim() : 'Unnamed connection'
              return (
                <UnderlineTab
                  key={conn.id}
                  active={isActive}
                  onSelect={() => switchTab(conn.id)}
                  title={`${displayName} (${conn.profile.host}:${conn.profile.port})`}
                  prefix={
                    <>
                      {conn.profile.color ? (
                        <span
                          className={styles.colorDot}
                          style={{ backgroundColor: conn.profile.color }}
                        />
                      ) : null}
                      <ConnectionStatusIndicator status={conn.status} size={8} />
                    </>
                  }
                  suffix={
                    <button
                      type="button"
                      className={styles.closeButton}
                      aria-label={`Close ${displayName}`}
                      onClick={() => {
                        void closeConnection(conn.id)
                      }}
                    >
                      <X size={14} weight="regular" />
                    </button>
                  }
                >
                  <span className={styles.tabName}>{displayName}</span>
                </UnderlineTab>
              )
            })}
          </UnderlineTabBar>
        </div>
      )}
      <div className={styles.rightSection}>
        <button
          className={styles.iconButton}
          type="button"
          aria-label={resolvedTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          title={resolvedTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          onClick={handleThemeToggle}
          data-testid="theme-toggle"
        >
          {resolvedTheme === 'light' ? (
            <Sun size={20} weight="regular" />
          ) : (
            <Moon size={20} weight="regular" />
          )}
        </button>
        <button className={styles.iconButton} type="button" aria-label="Settings" title="Settings">
          <GearSix size={20} weight="regular" />
        </button>
      </div>
    </div>
  )
}
