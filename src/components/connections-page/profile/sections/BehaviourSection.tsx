import { Checkbox } from '../../../common/Checkbox'
import { Dropdown, type DropdownOption } from '../../../common/Dropdown'
import { joinClassNames } from '../../../../lib/class-names'
import { useConnectionStore } from '../../../../stores/connection-store'
import { connectionGroupOf } from '../../../../lib/connection-colour'
import type { ConnectionFormData, ConnectionGroup } from '../../../../types/connection'
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

interface ColourSource {
  effective: string | null
  description: string | null
  group: ConnectionGroup | null
}

function colourSourceOf(data: ConnectionFormData, groups: ConnectionGroup[]): ColourSource {
  const group = connectionGroupOf(data, groups)
  if (data.color) return { effective: data.color, description: 'Own colour', group: group }
  if (group?.color) {
    return { effective: group.color, description: `From group ${group.name}`, group: group }
  }
  return { effective: null, description: null, group: group }
}

function ColourText({ source }: { source: ColourSource }) {
  return (
    <>
      <MonoOrMuted value={source.effective} fallback="None" />
      {source.description && <Muted>· {source.description}</Muted>}
    </>
  )
}

function ColourValue({ source }: { source: ColourSource }) {
  return (
    <>
      <ColorDot color={source.effective} />
      <ColourText source={source} />
    </>
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
      <Fact label="Colour">
        <ColourValue source={colourSourceOf(data, groups)} />
      </Fact>
      <Fact label="Access">{accessSummary(data.readOnly)}</Fact>
    </>
  )
}

interface UseGroupColourProps {
  profile: SectionProps['profile']
  group: ConnectionGroup | null
}

function UseGroupColour({ profile, group }: UseGroupColourProps) {
  if (!group) return null
  const groupColour = group.color
  if (!groupColour) return null
  const isInheriting = profile.form.editor.formData.color === null
  return (
    <Fact label="">
      <label className="flex items-center gap-2">
        <Checkbox
          id="conn-use-group-colour"
          checked={isInheriting}
          onChange={(event) =>
            profile.form.updateField('color', event.target.checked ? null : groupColour)
          }
        />
        Use group colour ({group.name})
      </label>
    </Fact>
  )
}

function ColourFields({ profile }: SectionProps) {
  const { formData } = profile.form.editor
  const groups = useConnectionStore((state) => state.connectionGroups)
  const source = colourSourceOf(formData, groups)
  const groupColour = source.group?.color ?? null
  const isInheriting = groupColour !== null && formData.color === null
  return (
    <>
      <Fact label="Colour">
        <ColorPickerPopover
          color={source.effective}
          disabled={isInheriting}
          onChange={(color) => profile.form.updateField('color', color)}
        />
        <ColourText source={source} />
      </Fact>
      <UseGroupColour profile={profile} group={source.group} />
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
      <ColourFields profile={profile} />
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
