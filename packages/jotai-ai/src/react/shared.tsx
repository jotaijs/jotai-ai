import { createContext, type ReactNode } from 'react'
import { ServerInitial } from './client'

export const AIContext = createContext({})

export function createAI () {
  return function AI (
    { children }: { children: ReactNode }
  ) {
    return (
      <AIContext.Provider value={{}}>
        <ServerInitial>
          {children}
        </ServerInitial>
      </AIContext.Provider>
    )
  }
}