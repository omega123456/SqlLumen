export interface SettingsSectionProps {
  title: string
  description: string
  children: React.ReactNode
}

export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <div className="flex flex-col" data-testid={`settings-section-${title.toLowerCase()}`}>
      <h3 className="mt-3.5 font-body text-body font-semibold text-light-on-surface dark:text-dark-on-surface">
        {title}
      </h3>
      <p className="mb-1.5 text-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
        {description}
      </p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  )
}
