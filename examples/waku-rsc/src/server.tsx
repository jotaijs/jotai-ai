import { atom } from 'jotai'

const serverAtom = atom(async get => {
  'use server'
  return 'hello world!'
})
