'use client'

import { chatAtoms } from 'jotai-ai'
import { useAtom, useAtomValue, useSetAtom } from 'jotai/react'

const {
  messagesAtom,
  inputAtom,
  submitAtom
} = chatAtoms()

export function Chat ({ handler }: { handler: any }) {
  const messages = useAtomValue(messagesAtom)
  const [input, handleInputChange] = useAtom(inputAtom)
  const handleSubmit = useSetAtom(submitAtom)

  return (
    <div className="flex flex-col w-full max-w-md py-24 mx-auto stretch">
      <ul>
        {messages.map((m, index) => (
          <li key={index}>
            {m.role === 'user' ? 'User: ' : 'AI: '}
            {m.role === 'user' ? m.content : m.ui}
          </li>
        ))}
      </ul>

      <form onSubmit={handleSubmit}>
        <input
          className="fixed bottom-0 w-full max-w-md p-2 mb-8 border border-gray-300 rounded shadow-xl"
          placeholder="What is the weather in New York?"
          value={input}
          onChange={handleInputChange}
          autoFocus
        />
      </form>
    </div>
  )
}
