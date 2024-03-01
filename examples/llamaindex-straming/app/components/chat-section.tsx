'use client'

import { noSSR } from 'foxact/no-ssr'
import { chatAtoms } from 'jotai-ai'
import { atomEffect } from 'jotai-effect'
import { ChatInput, ChatMessages } from './ui/chat'
import { useAtom, useAtomValue, useSetAtom } from 'jotai/react'
import { Suspense } from 'react'
import { atom } from 'jotai/vanilla'

const {
  messagesAtom,
  inputAtom,
  submitAtom,
  isLoadingAtom,
  reloadAtom,
  stopAtom
} = chatAtoms({
  initialMessages: async () => {
    noSSR()
    const idb = await import('idb-keyval')
    return (await idb.get('messages')) ?? []
  }
})

const clearMessagesAtom = atom(
  null,
  async (get, set) => set(messagesAtom, [])
)

const saveMessagesEffectAtom = atomEffect((get, set) => {
  const messages = get(messagesAtom)
  const idbPromise = import('idb-keyval')
  const abortController = new AbortController()
  idbPromise.then(async idb => {
    if (abortController.signal.aborted) {
      return
    }
    await idb.set('messages', await messages)
  })
  return () => {
    abortController.abort()
  }
})

const Messages = () => {
  const messages = useAtomValue(messagesAtom)
  const isLoading = useAtomValue(isLoadingAtom)
  const clear = useSetAtom(clearMessagesAtom)
  const reload = useSetAtom(reloadAtom)
  const stop = useSetAtom(stopAtom)
  return (
    <ChatMessages
      messages={messages}
      isLoading={isLoading}
      clear={clear}
      reload={reload}
      stop={stop}
    />
  )
}

export default function ChatSection () {
  useAtomValue(saveMessagesEffectAtom)
  const [input, handleInputChange] = useAtom(inputAtom)
  const handleSubmit = useSetAtom(submitAtom)
  const isLoading = useAtomValue(isLoadingAtom)
  console.log('isLoading', isLoading)

  return (
    <div className="space-y-4 max-w-5xl w-full">
      <Suspense fallback={
        <div className="w-full rounded-xl bg-white p-4 shadow-xl pb-0">
          <div
            className="flex h-[50vh] flex-col gap-5 divide-y overflow-y-auto pb-4">
            <div className="animate-pulse flex space-x-4">
              <div className="flex-1 space-y-4 py-1">
                <div className="space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                  <div className="h-4 bg-gray-200 rounded w-4/6"></div>
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      }>
        <Messages/>
      </Suspense>
      <ChatInput
        input={input}
        handleSubmit={handleSubmit}
        handleInputChange={handleInputChange}
        isLoading={isLoading}
      />
    </div>
  )
}
