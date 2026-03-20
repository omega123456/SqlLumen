import { Sun, Moon, GearSix, Plus } from '@phosphor-icons/react'
import { useThemeStore } from '../../stores/theme-store'
import type { Theme } from '../../stores/theme-store'
import styles from './ConnectionTabBar.module.css'

export function ConnectionTabBar() {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const setTheme = useThemeStore((state) => state.setTheme)

  const handleThemeToggle = () => {
    const nextTheme: Theme = resolvedTheme === 'light' ? 'dark' : 'light'
    void setTheme(nextTheme)
  }

  return (
    <div className={styles.tabBar}>
      <div className={styles.leftSection}>
        <button
          className={styles.iconButton}
          type="button"
          aria-label="New Connection"
          title="New Connection"
        >
          <Plus size={20} weight="regular" />
        </button>
      </div>
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
        <button
          className={styles.iconButton}
          type="button"
          aria-label="Settings"
          title="Settings"
        >
          <GearSix size={20} weight="regular" />
        </button>
      </div>
    </div>
  )
}
