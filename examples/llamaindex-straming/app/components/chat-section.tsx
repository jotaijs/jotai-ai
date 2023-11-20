'use client'

import { chatAtoms } from 'jotai-ai'
import { ChatInput, ChatMessages } from './ui/chat'
import { useAtom, useAtomValue, useSetAtom } from 'jotai/react'

const {
  messagesAtom,
  inputAtom,
  submitAtom,
  isLoadingAtom,
  reloadAtom,
  stopAtom
} = chatAtoms()

export default function ChatSection () {
  const messages = useAtomValue(messagesAtom)
  const [input, handleInputChange] = useAtom(inputAtom)
  const handleSubmit = useSetAtom(submitAtom)
  const isLoading = useAtomValue(isLoadingAtom)
  const reload = useSetAtom(reloadAtom)
  const stop = useSetAtom(stopAtom)

  return (
    <div className="space-y-4 max-w-5xl w-full">
      <ChatMessages
        messages={messages}
        isLoading={isLoading}
        reload={reload}
        stop={stop}
      />
      <ChatInput
        input={input}
        handleSubmit={handleSubmit}
        handleInputChange={handleInputChange}
        isLoading={isLoading}
      />
    </div>
  )
}
