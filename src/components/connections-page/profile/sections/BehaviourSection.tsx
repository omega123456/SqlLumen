import { Checkbox } from '../../../common/Checkbox'
import { Dropdown, type DropdownOption } from '../../../common/Dropdown'
import { joinClassNames } from '../../../../lib/class-names'
import { useConnectionStore } from '../../../../stores/connection-store'
import type { ConnectionGroup } from '../../../../types/connection'
import { connectionEdgeFill } from '../../../layout/connection-tab-bar/connection-tab-model'
import { ColorPickerPopover } from '../ColorPickerPopover'
import { Fact, MonoOrMuted, Muted } from '../FactsList'
import { ProfileSection } from '../ProfileSection'
import { TextFieldInput } from './section-fields'
import { isEditing, type SectionProps } from './section-props'

const UNGROUPED_VALUE = ''
const UNGROUPED_LABEL = 'Ungrouped'
const GROUP_LABEL_ID = 'conn-group-label'

function groupOptions(groups: ConnectionGroup[]): DropdownOption[] {
  return [
    { value: UNGROUPED_VALUE, label: UNGROUPED_LABEL },
    ...groups.map((group) => ({ value: group.id, label: group.name })),
  ]
}

function ColorDot({ color }: { color: string | null }) {
  const fill = connectionEdgeFill(color)
  return (
    <span
      className={joinClassNames(['size-3 shrink-0 rounded-round', fill.className])}
      style={fill.style}
      aria-hidden
    />
  )
}

function accessSummary(readOnly: boolean): string {
  return readOnly ? 'Read-only, writes are blocked' : 'Read and write'
}

function BehaviourFacts({ profile }: SectionProps) {
  const data = profile.form.editor.formData
  const groups = useConnectionStore((state) => state.connectionGroups)
  const groupName = groups.find((group) => group.id === data.groupId)?.name
  return (
    <>
      <Fact label="Name">{data.name}</Fact>
      <Fact label="Group">{groupName ?? <Muted>{UNGROUPED_LABEL}</Muted>}</Fact>
      <Fact label="Tab colour">
        <ColorDot color={data.color} />
        <MonoOrMuted value={data.color} fallback="None" />
      </Fact>
      <Fact label="Access">{accessSummary(data.readOnly)}</Fact>
    </>
  )
}

function BehaviourFields({ profile }: SectionProps) {
  const { formData, errors } = profile.form.editor
  const groups = useConnectionStore((state) => state.connectionGroups)
  return (
    <>
      <Fact label="Name" htmlFor="conn-name" error={errors.name}>
        <TextFieldInput
          id="conn-name"
          profile={profile}
          field="name"
          input={{ placeholder: 'Orders primary' }}
        />
      </Fact>
      <Fact label="Group" labelId={GROUP_LABEL_ID}>
        <div className="w-60">
          <Dropdown
            id="conn-group"
            labelledBy={GROUP_LABEL_ID}
            options={groupOptions(groups)}
            value={formData.groupId ?? UNGROUPED_VALUE}
            onChange={(groupId) => profile.form.updateField('groupId', groupId || null)}
            data-testid="group-dropdown"
          />
        </div>
      </Fact>
      <Fact label="Tab colour">
        <ColorPickerPopover
          color={formData.color}
          onChange={(color) => profile.form.updateField('color', color)}
        />
        <MonoOrMuted value={formData.color} fallback="None" />
      </Fact>
      <Fact label="Access">
        <label className="flex items-center gap-2">
          <Checkbox
            id="conn-read-only"
            checked={formData.readOnly}
            onChange={(event) => profile.form.updateField('readOnly', event.target.checked)}
          />
          Read-only, block writes
        </label>
      </Fact>
    </>
  )
}

export function BehaviourSection({ profile }: SectionProps) {
  const editing = isEditing(profile, 'behaviour')
  return (
    <ProfileSection
      section="behaviour"
      isEditing={editing}
      onEdit={() => profile.editSection('behaviour')}
    >
      {editing ? <BehaviourFields profile={profile} /> : <BehaviourFacts profile={profile} />}
    </ProfileSection>
  )
}
