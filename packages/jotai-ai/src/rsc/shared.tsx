import { type ReactNode } from 'react'
import { AIProvider, ServerInitial } from './client'

export type AIOptions = {
  actions: Record<string, any>
}

async function internalAction (
  action: any,
  ...args: unknown[]
) {
  'use server'
  return async () => {
    return action(...args)
  }
}

function wrapAction (
  action: any
) {
  return internalAction.bind(null, { action })
}

export function createAI (
  { actions }: AIOptions
) {
  return async function AI (
    { children }: { children: ReactNode }
  ) {
    const wrappedActions: Record<string, any> = {}
    for (const name in actions) {
      wrappedActions[name] = wrapAction(actions[name])
    }
    return (
      <AIProvider value={{ actions: wrappedActions }}>
        <ServerInitial>
          {children}
        </ServerInitial>
      </AIProvider>
    )
  }
}