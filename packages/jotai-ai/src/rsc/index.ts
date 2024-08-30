'use client'
import { aiAtom } from './client'
import type * as RSC from './index.react-server'

type CreateAI = typeof RSC.createAI

export const createAI: CreateAI = () => {
  throw new Error('`createAI` is only available on the server')
}

export {
  aiAtom
}