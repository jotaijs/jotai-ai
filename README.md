# AI

[![Bundle size](https://img.shields.io/bundlephobia/minzip/jotai-ai?label=bundle%20size&style=flat&colorA=000000&colorB=000000)](https://bundlephobia.com/result?p=jotai-ai)
[![Version](https://img.shields.io/npm/v/jotai-ai?style=flat&colorA=000000&colorB=000000)](https://www.npmjs.com/package/jotai-ai)

[jotai-ai](https://github.com/himself65/jotai-ai) is a utility package compatible
with [Vercel AI SDK](https://sdk.vercel.ai/docs).

## install

```
yarn add ai jotai-ai
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
While swr is a powerful tool with a rich set of features tailored for data fetching and caching, such as automatic
revalidation, request deduplication, and interval polling.

The `useChat` hook simplifies the interaction model to post messages once click,
interpreting the response, keep update of messages without leveraging `swr` functionalities.

However, `chatAtoms` provider a more flexible way to create a chatbot.
Built on the foundation of `jotai` atoms, 
it provides an atomic global state management system that is both powerful and flexible.

For example, you can customize the `messagesAtom` to add more functionality like `clearMessagesAtom`:

```js
const { messagesAtom } = chatAtoms()

const clearMessagesAtom = atom(
  null,
  async (get, set) => set(messagesAtom, [])
)

const Actions = () => {
  const clear = useSetAtom(clearMessagesAtom)
  return (
    <button onClick={clear}>Clear Messages</button>
  )
}
```

Also, `chatAtoms` is created out of the Component lifecycle,
so you can share the state between different components easily.

```js
const { messagesAtom } = chatAtoms()

const Messages = () => {
  const messages = useAtomValue(messagesAtom)
  return (
    <div>
      {messages.map(m => (
        <div key={m.id} className='whitespace-pre-wrap'>
          {m.role === 'user' ? 'User: ' : 'AI: '}
          {m.content}
        </div>
      ))}
    </div>
  )
}

const UserMessages = () => {
  const messages = useAtomValue(messagesAtom)
  return (
    <div>
      {messages.filter(m => m.role === 'user').map(m => (
        <div key={m.id} className='whitespace-pre-wrap'>
          User: {m.content}
        </div>
      ))}
    </div>
  )
}
```

#### Load messages on demand with React Suspense

`chatAtoms` also allows you to pass async fetch function to `initialMessage` option, which is not supported
by `useChat`.

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

With the combination with [`jotai-effect`](https://github.com/jotaijs/jotai-effect),
you can create a chatbot with local storage support.

```js
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

import { atomEffect } from 'jotai-effect'

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
