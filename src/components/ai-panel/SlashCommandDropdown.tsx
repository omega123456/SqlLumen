import type { SlashCommand } from '../../lib/slash-commands'
import styles from './SlashCommandDropdown.module.css'

export interface SlashCommandDropdownProps {
  commands: SlashCommand[]
  highlightedIndex: number
  onSelect: (command: SlashCommand) => void
  onHighlightChange: (index: number) => void
}

export function SlashCommandDropdown({
  commands,
  highlightedIndex,
  onSelect,
  onHighlightChange,
}: SlashCommandDropdownProps) {
  if (commands.length === 0) return null

  return (
    <div
      role="listbox"
      id="slash-command-listbox"
      className={styles.dropdown}
      data-testid="slash-command-dropdown"
    >
      {commands.map((command, index) => (
        <div
          key={command.name}
          role="option"
          id={`slash-cmd-${command.name}`}
          aria-selected={index === highlightedIndex}
          className={`${styles.item} ${index === highlightedIndex ? styles.itemHighlighted : ''}`}
          data-testid={`slash-command-item-${command.name}`}
          onClick={() => onSelect(command)}
          onMouseEnter={() => onHighlightChange(index)}
        >
          <span className={styles.commandName}>/{command.name}</span>
          <span className={styles.commandDescription}>{command.description}</span>
        </div>
      ))}
    </div>
  )
}
