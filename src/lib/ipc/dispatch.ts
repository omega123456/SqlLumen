import { invoke } from '@tauri-apps/api/core'
import type {
  ArgumentCommandMap,
  ArgumentCommandName,
  NoArguments,
  PayloadCommandMap,
  PayloadCommandName,
} from './command-map'

export const NO_ARGUMENTS: NoArguments = {}

export interface PayloadCommandCall<TCommand extends PayloadCommandName> {
  command: TCommand
  payload: PayloadCommandMap[TCommand]['request']
}

export interface ArgumentCommandCall<TCommand extends ArgumentCommandName> {
  command: TCommand
  argument: ArgumentCommandMap[TCommand]['request']
}

export function invokeCommand<TCommand extends PayloadCommandName>({
  command,
  payload,
}: PayloadCommandCall<TCommand>): Promise<PayloadCommandMap[TCommand]['response']> {
  return invoke<PayloadCommandMap[TCommand]['response']>(command, { payload })
}

export function invokeArgumentCommand<TCommand extends ArgumentCommandName>({
  command,
  argument,
}: ArgumentCommandCall<TCommand>): Promise<ArgumentCommandMap[TCommand]['response']> {
  return invoke<ArgumentCommandMap[TCommand]['response']>(command, argument)
}
