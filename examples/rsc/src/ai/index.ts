import { createAI } from 'jotai-ai/rsc'

export const AI = createAI({
  actions: {
    ping: async () => {
      'use server'
      return 'pong'
    }
  }
})
