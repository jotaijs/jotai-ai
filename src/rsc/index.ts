import { atom } from 'jotai/vanilla'
import type { AIBase, InferAIState, InferUIState } from './type'

export function uiStateAtom<AI extends AIBase> (
  initialUIState: InferUIState<AI>
) {
  // todo
  return atom<InferUIState<AI>>(initialUIState)
}

export function aiStateAtom<AI extends AIBase> (
  initialAIState: InferAIState<AI>
) {
  // todo
  return atom<InferAIState<AI>>(initialAIState)
}

export function stateAtom<AI extends AIBase> () {
  return atom(null, (get, set) => {
    // todo
  })
}
