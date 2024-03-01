export type AIBase<AIState = any, UIState = any, Actions = any> = {}
export type InferAIState<AI extends AIBase, Fallback = any> = AI extends AIBase<infer AIState, any, any>
  ? AIState
  : Fallback
export type InferUIState<AI extends AIBase, Fallback = any> = AI extends AIBase<any, infer UIState, any>
  ? UIState
  : Fallback
export type InferActions<AI extends AIBase, Fallback = any> = AI extends AIBase<any, any, infer Actions>
  ? Actions
  : Fallback
export type AIAction<T extends any[] = any[], R = any> = (...args: T[]) => Promise<R>;
export type AIActions<T extends any[] = any[], R = any> = Record<string, AIAction<T, R>>;

export type ServerWrappedAction<T = unknown> = (
  aiState: T,
  ...args: unknown[]
) => Promise<[Promise<T>, unknown]>;
export type ServerWrappedActions<T = unknown> = Record<
  string,
  ServerWrappedAction<T>
>;
