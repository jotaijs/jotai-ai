'use client'

import { chatAtoms } from 'jotai-ai'
import { useAtom, useAtomValue, useSetAtom } from 'jotai/react'

const {
  messagesAtom,
  inputAtom,
  submitAtom
} = chatAtoms({
  api: '/api/chat-with-vision'
})

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

      <form
        onSubmit={e => {
          handleSubmit(e, {
            data: {
              imageUrl:
                'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Field_sparrow_in_CP_%2841484%29_%28cropped%29.jpg/733px-Field_sparrow_in_CP_%2841484%29_%28cropped%29.jpg'
            }
          })
        }}
      >
        <input
          className="fixed bottom-0 w-full max-w-md p-2 mb-8 border border-gray-300 rounded shadow-xl"
          value={input}
          placeholder="What does the image show..."
          onChange={handleInputChange}
        />
      </form>
    </div>
  )
}
