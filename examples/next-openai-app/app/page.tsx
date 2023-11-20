'use client'

import { chatAtoms } from 'jotai-ai'
import { useAtom, useAtomValue, useSetAtom } from 'jotai/react'

const {
  messagesAtom,
  inputAtom,
  submitAtom
} = chatAtoms()

export default function Chat () {
  const messages = useAtomValue(messagesAtom)
  const [input, handleInputChange] = useAtom(inputAtom)
  const handleSubmit = useSetAtom(submitAtom)

  return (
    <div className="flex flex-col w-full max-w-md py-24 mx-auto stretch">
      {messages.length > 0
        ? messages.map(m => (
          <div key={m.id} className="whitespace-pre-wrap">
            {m.role === 'user' ? 'User: ' : 'AI: '}
            {m.content}
          </div>
        ))
        : null}

      <form onSubmit={handleSubmit}>
        <input
          className="fixed bottom-0 w-full max-w-md p-2 mb-8 border border-gray-300 rounded shadow-xl"
          value={input}
          placeholder="Say something..."
          onChange={handleInputChange}
        />
      </form>
    </div>
  )
}
