# AI

[jotai-ai](https://github.com/himself65/jotai-ai) is a utility package compatible
with [Vercel AI SDK](https://sdk.vercel.ai/docs).

## install

```
yarn add jotai-ai
```

## chatAtoms

`chatAtoms` is a collection of atoms for a chatbot like [`useChat`](https://sdk.vercel.ai/docs/api-reference/use-chat).

```js
import { useAtomValue, useAtom, useSetAtom } from 'jotai'
import { chatAtoms } from 'jotai-ai'

const {
  messagesAtom,
  inputAtom,
  submitAtom,
  isLoadingAtom,
} = chatAtoms()

function Messages () {
  const messages = useAtomValue(messagesAtom)
  return (
    <>
      {messages.length > 0
        ? messages.map(m => (
          <div key={m.id} className='whitespace-pre-wrap'>
            {m.role === 'user' ? 'User: ' : 'AI: '}
            {m.content}
          </div>
        ))
        : null}
    </>
  )
}

function ChatInput () {
  const [input, handleInputChange] = useAtom(inputAtom)
  const handleSubmit = useSetAtom(submitAtom)
  return (
    <form onSubmit={handleSubmit}>
      <input
        value={input}
        placeholder='Say something...'
        onChange={handleInputChange}
      />
    </form>
  )
}

function App () {
  const isLoading = useAtomValue(isLoadingAtom)
  return (
    <main>
      <Messages/>
      <ChatInput/>
      {isLoading ? <div>Loading...</div> : null}
    </main>
  )
}
```

### Comparison with `useChat`

#### Less headache

`useChat` is a hook provided by Vercel AI SDK, which is a wrapper of `swr` in React, `swrv` in Vue, and `sswr` in
Svelte.
They actually have the different behaviors in the different frameworks.

`chatAtoms` provider a more flexible way to create the chatbot, which is based on `jotai` atoms, so you can use it in
framework-agnostic way.

Also, `chatAtoms` is created out of the Component lifecycle,
so you can share the state between different components easily.

#### Load messages on demand

`chatAtoms` also allows you to pass async fetch function to `initialMessage` option, which is not supported by `useChat`.

```js
const {
  messagesAtom,
  inputAtom,
  submitAtom
} = chatAtoms({
  initialMessages: async () => {
    // fetch messages from anywhere
    const messages = await fetchMessages()
    return messages
  }
})
```

With the combination with `jotai-effect`, you can create a chatbot with local storage support.

```js
import { Suspense } from 'react'
import { useAtomValue } from 'jotai'
import { chatAtoms } from 'jotai-ai'
import { atomEffect } from 'jotai-effect'

const {
  messagesAtom
} = chatAtoms({
  initialMessages: async () => {
    /**
     * call `noSSR` function if you are using next.js.
     * @link https://foxact.skk.moe/no-ssr
     */
      // noSSR()
    const idb = await import('idb-keyval')
    return (await idb.get('messages')) ?? []
  }
})

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
  return (
    <>
      {messages.length > 0
        ? messages.map(m => (
          <div key={m.id} className="whitespace-pre-wrap">
            {m.role === 'user' ? 'User: ' : 'AI: '}
            {m.content}
          </div>
        ))
        : null}
    </>
  )
}

const App = () => {
  useAtomValue(saveMessagesEffectAtom)
  return (
    <main>
      <Suspense fallback="loading messages...">
        <Messages/>
      </Suspense>
    </main>
  )
}
```

## LICENSE

[MIT](LICENSE)

[Vercel AI SDK]: https://sdk.vercel.ai/docs
