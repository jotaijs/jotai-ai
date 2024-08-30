'use client'
import { atom, useAtom } from 'jotai'
import { createContext, type ReactNode } from 'react'
import { use, createElement } from 'react'

export const AIContext = createContext<any>(null)

export function AIProvider(props: { children: ReactNode, value: any }) {
  return (
    createElement(AIContext.Provider, { value: props.value }, props.children)
  )
}

const kInitialValue = Symbol('initial-value')
// fixme: type
const aiInternalAtom = atom<any>(kInitialValue!)
let resolveInitialPromise: (value: any) => void
let rejectInitialPromise: (reason: any) => void

const initialPromise = new Promise<void>((resolve, reject) => {
  resolveInitialPromise = resolve
  rejectInitialPromise = reject
})

export const aiAtom = atom(async get => {
  const ai = get(aiInternalAtom)
  console.log('aiAtom', ai)
  if (ai === kInitialValue) {
    return initialPromise
  }
  return ai
})

/**
 * @internal
 */
export function ServerInitial (
  { children }: { children: ReactNode }
) {
  // const [ai, setAI] = useAtom(aiInternalAtom)
  // if (typeof window === 'undefined') {
  //   return children
  // }
  // if (ai === kInitialValue) {
  //   const context = use(AIContext)
  //   console.log('ServerInitial', ai, context)
  //   setAI(context.actions)
  //   resolveInitialPromise(context.actions)
  // }
  return children
}