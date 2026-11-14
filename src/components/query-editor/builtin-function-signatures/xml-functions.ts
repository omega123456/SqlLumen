import type { BuiltinSignatureEntry } from './signature-types'

export const XML_FUNCTION_SIGNATURES: readonly BuiltinSignatureEntry[] = [
  [
    'EXTRACTVALUE',
    {
      parameters: [{ label: 'xml_frag' }, { label: 'xpath_expr' }],
      returnType: 'VARCHAR',
      documentation: 'Returns the text of the first text node matching the XPath expression.',
    },
  ],
  [
    'UPDATEXML',
    {
      parameters: [{ label: 'xml_target' }, { label: 'xpath_expr' }, { label: 'new_xml' }],
      returnType: 'VARCHAR',
      documentation: 'Returns the changed XML fragment, or the original if XPath does not match.',
    },
  ],
]
