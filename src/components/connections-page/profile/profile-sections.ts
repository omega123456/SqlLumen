import type { ConnectionFormData } from '../../../types/connection'
import type { FormErrors } from './connection-editor-state'

export type ProfileSection = 'server' | 'signIn' | 'security' | 'behaviour'

export const PROFILE_SECTION_ORDER: ProfileSection[] = ['server', 'signIn', 'security', 'behaviour']

export const PROFILE_SECTION_TITLE: Record<ProfileSection, string> = {
  server: 'Server',
  signIn: 'Sign-in',
  security: 'Security',
  behaviour: 'Name and behaviour',
}

const SECTION_FIELDS: Record<ProfileSection, (keyof ConnectionFormData)[]> = {
  server: ['host', 'port', 'defaultDatabase', 'connectTimeoutSecs', 'keepaliveIntervalSecs'],
  signIn: ['username', 'password'],
  security: ['sslMode', 'sslCaPath', 'sslCertPath', 'sslKeyPath'],
  behaviour: ['name', 'groupId', 'color', 'readOnly'],
}

export const FIELD_SECTION: Record<keyof ConnectionFormData, ProfileSection> = {
  host: 'server',
  port: 'server',
  defaultDatabase: 'server',
  connectTimeoutSecs: 'server',
  keepaliveIntervalSecs: 'server',
  username: 'signIn',
  password: 'signIn',
  sslMode: 'security',
  sslCaPath: 'security',
  sslCertPath: 'security',
  sslKeyPath: 'security',
  name: 'behaviour',
  groupId: 'behaviour',
  color: 'behaviour',
  readOnly: 'behaviour',
}

const NEW_PROFILE_OPEN_SECTIONS: ProfileSection[] = ['server', 'signIn', 'behaviour']

export function initialOpenSections(isNew: boolean): ProfileSection[] {
  return isNew ? NEW_PROFILE_OPEN_SECTIONS : []
}

function isFormField(field: string): field is keyof ConnectionFormData {
  return field in FIELD_SECTION
}

export function sectionsWithErrors(errors: FormErrors): ProfileSection[] {
  const erroredSections = new Set(
    Object.keys(errors)
      .filter(isFormField)
      .map((field) => FIELD_SECTION[field])
  )
  return PROFILE_SECTION_ORDER.filter((section) => erroredSections.has(section))
}

export interface SectionComparison {
  section: ProfileSection
  current: ConnectionFormData
  baseline: ConnectionFormData
}

export function isSectionDirty({ section, current, baseline }: SectionComparison): boolean {
  return SECTION_FIELDS[section].some((field) => current[field] !== baseline[field])
}

export function restoreSection({
  section,
  current,
  baseline,
}: SectionComparison): ConnectionFormData {
  const restoredFields = Object.fromEntries(
    SECTION_FIELDS[section].map((field) => [field, baseline[field]])
  )
  return { ...current, ...restoredFields }
}
