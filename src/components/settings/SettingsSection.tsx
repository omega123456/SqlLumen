import styles from './SettingsSection.module.css'

export interface SettingsSectionProps {
  title: string
  description: string
  children: React.ReactNode
}

export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <div className={styles.section} data-testid={`settings-section-${title.toLowerCase()}`}>
      <h3 className={styles.heading}>{title}</h3>
      <p className={styles.description}>{description}</p>
      <div className={styles.content}>{children}</div>
    </div>
  )
}
