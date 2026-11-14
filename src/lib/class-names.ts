const CLASS_NAME_SEPARATOR = ' '

export function joinClassNames(classNames: ReadonlyArray<string | undefined>): string {
  return classNames.filter(Boolean).join(CLASS_NAME_SEPARATOR)
}
