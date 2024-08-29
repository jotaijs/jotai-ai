'use client'
import { atom, useAtom } from 'jotai'
import type { ReactNode } from 'react'
import { use } from 'react'
import { AIContext } from './shared'

const kInitialValue = Symbol('initial-value')
// fixme: type
const aiInternalAtom = atom<any>(kInitialValue!)
let resolveInitialPromise: (value: void) => void
let rejectInitialPromise: (reason: any) => void

new Promise<void>((resolve, reject) => {
  resolveInitialPromise = resolve
  rejectInitialPromise = reject
}).catch(err => {
  console.error('Failed to initialize AI', err)
})

export const aiAtom = atom(get => {
  const ai = get(aiInternalAtom)
  if (ai === kInitialValue) {
    return resolveInitialPromise
  }
  return ai
})

export function ServerInitial (
  { children }: { children: ReactNode }
) {
  const [ai, setAI] = useAtom(aiInternalAtom)
  if (ai === kInitialValue) {
    try {
      const context = use(AIContext)
      setAI(context)
      resolveInitialPromise()
    } catch (err) {
      rejectInitialPromise(err)
      throw err
    }
  }
  return children
}