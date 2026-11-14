export interface BuiltinFunctionSignature {
  label?: string
  parameters: Array<{ label: string; documentation?: string }>
  returnType: string
  documentation: string
}

export type BuiltinSignatureEntry = [string, BuiltinFunctionSignature]
