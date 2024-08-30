"use client";
import { useAtom } from 'jotai'
import { aiAtom } from 'jotai-ai/rsc'

export default function Home() {
  const [state] = useAtom(aiAtom)
  console.log('state', state)
  return (
    <div>
      Hello, world!
    </div>
  )
}
