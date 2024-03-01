import type { AIAction, AIActions, ServerWrappedActions } from './type'

type CreateAIProps<
  AIState = any,
  UIState = any,
  Actions extends AIActions = {},
> = {
  initialAIState: AIState
  initialUIState: UIState
  actions: Actions
}

type InnerActionProps = {
  action: AIAction
  options: unknown // todo
}

function innerAction (
  {
    action,
    options
  }: InnerActionProps
) {
  'use server'
  return async () => {
    // todo
    return 'hello world!'
  }
}

function wrapAction<T = unknown> (
  action: AIAction,
  options: unknown
) {
  return innerAction.bind(null, { action, options }) as AIAction<T>
}

export function createAI<
  AIState = any,
  UIState = any,
  Actions extends AIActions = {},
> ({
  actions
}: CreateAIProps) {
}
