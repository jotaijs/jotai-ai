import type { CreateMessage, UseChatOptions } from 'ai/react'
import {
  atom,
  type Getter,
  type Setter
} from 'jotai/vanilla'
import {
  type ChatRequest,
  type ChatRequestOptions,
  COMPLEX_HEADER,
  createChunkDecoder,
  type FunctionCall,
  type JSONValue,
  type Message,
  nanoid
} from 'ai'
import { parseComplexResponse } from './utils/parse-complex-response'
import { isPromiseLike } from './utils'
import type { FormEvent } from 'react'

export function chatAtoms (
  chatOptions: Omit<
    UseChatOptions,
    'onFinish' | 'onResponse' | 'onError' | 'experimental_onFunctionCall' | 'initialMessages'
  > & {
    onFinish?: (get: Getter, set: Setter, message: Message) => void;
    onResponse?: (
      get: Getter,
      set: Setter,
      response: Response
    ) => void | Promise<void>;
    onError?: (get: Getter, set: Setter, error: Error) => void;
    experimental_onFunctionCall?: (
      get: Getter,
      set: Setter,
      chatMessages: Message[],
      functionCall: FunctionCall
    ) => Promise<void | ChatRequest>;
    // if you pass async function or promise, you will need a suspense boundary
    initialMessages?: Message[] | Promise<Message[]> | (() => Message[] | Promise<Message[]>);
  } = {}
) {
  const api = chatOptions.api || '/api/chat'
  const sendExtraMessageFields = chatOptions.sendExtraMessageFields || false
  const initialMessages = chatOptions.initialMessages || []

  const primitiveMessagesAtom = atom<Message[] | Promise<Message[]> | null>(
    typeof initialMessages === 'function' ? null : initialMessages
  )
  const messagesAtom = atom<
    Message[] | Promise<Message[]>,
    [messages: ((Message[]) | Promise<Message[]>)],
    void
  >(
    get => {
      const messages = get(primitiveMessagesAtom)
      if (messages === null) {
        return (initialMessages as () => (Message[] | Promise<Message[]>))()
      } else {
        return messages
      }
    },
    (
      get,
      set,
      messages
    ) => {
      set(primitiveMessagesAtom, messages)
    }
  )
  const dataAtom = atom<JSONValue[] | undefined>(undefined)
  const inputBaseAtom = atom(chatOptions.initialInput || '')

  const abortControllerAtom = atom<AbortController>(new AbortController())
  const isLoadingAtom = atom(false)

  type Metadata = {
    credentials?: RequestCredentials;
    headers?: HeadersInit;
    body?: Record<string, any>;
  }

  const metadataAtom = atom<Metadata>({
    credentials: chatOptions.credentials,
    headers: chatOptions.headers,
    body: chatOptions.body
  })

  const appendMessage = (
    set: Setter, prevMessages: Message[], message: Message) => {
    set(messagesAtom, [...prevMessages, message])
  }

  async function callApi (
    get: Getter,
    set: Setter,
    abortController: AbortController,
    metadata: Metadata,
    prevMessages: Message[],
    chatRequest: Omit<ChatRequest, 'messages'> & {
      messages: Omit<Message, 'id'>[];
    }
  ) {
    const response = await fetch(api, {
      method: 'POST',
      signal: abortController?.signal,
      body: JSON.stringify({
        data: chatRequest.data,
        messages: chatRequest.messages,
        ...metadata.body,
        ...chatRequest.options?.body,
        ...(chatRequest.functions !== undefined && {
          functions: chatRequest.functions
        }),
        ...(chatRequest.function_call !== undefined && {
          function_call: chatRequest.function_call
        })
      }),
      headers: {
        ...metadata.headers,
        ...chatRequest.options?.headers
      },
      credentials: metadata.credentials
    })

    if (chatOptions.onResponse) {
      try {
        await chatOptions.onResponse(
          get,
          set,
          response
        )
      } catch (err) {
        throw err
      }
    }
    if (!response.ok) {
      throw new Error(
        (await response.text()) || 'Failed to fetch the chat response.'
      )
    }

    if (!response.body) {
      throw new Error('The response body is empty.')
    }

    const reader = response.body.getReader()
    const isComplexMode = response.headers.get(COMPLEX_HEADER) === 'true'
    if (isComplexMode) {
      return parseComplexResponse({
        reader,
        abortController,
        update: (merged, data) => {
          set(messagesAtom, merged)
          set(dataAtom, data)
        }
      })
    } else {
      const createdAt = new Date()
      const decode = createChunkDecoder(false)

      // TODO-STREAMDATA: Remove this once Stream Data is not experimental
      let streamedResponse = ''
      const replyId = nanoid()
      let responseMessage: Message = {
        id: replyId,
        createdAt,
        content: '',
        role: 'assistant'
      }

      // TODO-STREAMDATA: Remove this once Stream Data is not experimental
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        // Update the chat state with the new message tokens.
        streamedResponse += decode(value)

        if (streamedResponse.startsWith('{"function_call":')) {
          // While the function call is streaming, it will be a string.
          responseMessage['function_call'] = streamedResponse
        } else {
          responseMessage['content'] = streamedResponse
        }

        appendMessage(set, prevMessages, { ...responseMessage })

        // The request has been aborted, stop reading the stream.
        if (abortController.signal.aborted) {
          await reader.cancel()
          break
        }
      }

      if (streamedResponse.startsWith('{"function_call":')) {
        // Once the stream is complete, the function call is parsed into an object.
        responseMessage['function_call'] = JSON.parse(
          streamedResponse).function_call

        appendMessage(set, prevMessages, { ...responseMessage })
      }

      if (chatOptions.onFinish) {
        chatOptions.onFinish(get, set, responseMessage)
      }

      return responseMessage
    }
  }

  async function getStreamedResponse (
    get: Getter,
    set: Setter,
    chatRequest: ChatRequest
  ) {
    set(messagesAtom, chatRequest.messages)

    const constructedMessagesPayload = sendExtraMessageFields
      ? chatRequest.messages
      : chatRequest.messages.map(({ role, content, name, function_call }) => ({
        role,
        content,
        ...(name !== undefined && { name }),
        ...(function_call !== undefined && {
          function_call: function_call
        })
      }))

    return callApi(
      get,
      set,
      get(abortControllerAtom),
      get(metadataAtom),
      await get(messagesAtom),
      {
        ...chatRequest,
        messages: constructedMessagesPayload
      }
    )
  }

  async function triggerRequest (
    get: Getter,
    set: Setter,
    chatRequest: ChatRequest
  ) {
    const onFunctionCall = chatOptions.experimental_onFunctionCall
    try {
      set(isLoadingAtom, true)
      const abortController = new AbortController()
      set(abortControllerAtom, abortController)

      // processChatStream()
      while (true) {
        const messagesAndDataOrJustMessage = await getStreamedResponse(
          get,
          set,
          chatRequest
        )
        if ('messages' in messagesAndDataOrJustMessage) {
          let hasFollowingResponse = false
          for (const message of messagesAndDataOrJustMessage.messages) {
            if (
              message.function_call === undefined ||
              typeof message.function_call === 'string'
            ) {
              continue
            }
            hasFollowingResponse = true
            // Streamed response is a function call, invoke the function call handler if it exists.
            if (onFunctionCall) {
              const functionCall = message.function_call

              // User handles the function call in their own functionCallHandler.
              // The "arguments" key of the function call object will still be a string which will have to be parsed in the function handler.
              // If the "arguments" JSON is malformed due to model error the user will have to handle that themselves.

              const functionCallResponse: ChatRequest | void =
                await onFunctionCall(
                  get,
                  set,
                  await get(messagesAtom),
                  functionCall
                )

              // If the user does not return anything as a result of the function call, the loop will break.
              if (functionCallResponse === undefined) {
                hasFollowingResponse = false
                break
              }

              // A function call response was returned.
              // The updated chat with function call response will be sent to the API in the next iteration of the loop.
              chatRequest = functionCallResponse
            }
          }
          if (!hasFollowingResponse) {
            break
          }
        } else {
          const streamedResponseMessage = messagesAndDataOrJustMessage
          if (
            streamedResponseMessage.function_call === undefined ||
            typeof streamedResponseMessage.function_call === 'string'
          ) {
            break
          }

          // Streamed response is a function call, invoke the function call handler if it exists.
          if (onFunctionCall) {
            const functionCall = streamedResponseMessage.function_call
            const functionCallResponse: ChatRequest | void =
              await onFunctionCall(get, set, await get(messagesAtom),
                functionCall)

            // If the user does not return anything as a result of the function call, the loop will break.
            if (functionCallResponse === undefined) break
            // A function call response was returned.
            // The updated chat with function call response will be sent to the API in the next iteration of the loop.
            chatRequest = functionCallResponse
          }
        }
      }
    } finally {
      set(isLoadingAtom, false)
    }
  }

  async function append (
    get: Getter,
    set: Setter,
    message: Message | CreateMessage,
    { options, functions, function_call, data }: ChatRequestOptions = {}
  ) {
    if (!message.id) {
      message.id = nanoid()
    }

    const messages = await get(messagesAtom)

    const chatRequest: ChatRequest = {
      messages: messages.concat(message as Message),
      options,
      data,
      ...(functions !== undefined && { functions }),
      ...(function_call !== undefined && { function_call })
    }

    return triggerRequest(get, set, chatRequest)
  }

  function onError (
    get: Getter,
    set: Setter,
    error: Error
  ) {
    if (chatOptions.onError) {
      chatOptions.onError(get, set, error)
    } else {
      throw error
    }
  }

  // user side atoms
  return {
    messagesAtom: atom(
      get => get(messagesAtom),
      async (
        get,
        set,
        messages: Message[]
      ): Promise<void> => {
        const prevMessages = get(messagesAtom)
        if (isPromiseLike(prevMessages)) {
          set(messagesAtom, prevMessages.then(() => messages))
        } else {
          set(messagesAtom, messages)
        }
      }),
    dataAtom: atom(get => get(dataAtom)),
    isLoadingAtom: atom(get => get(isLoadingAtom)),
    isPendingAtom: atom(get => {
      const messages = get(messagesAtom)
      if (isPromiseLike(messages)) {
        return messages.then((messages)=> messages.at(-1)?.role !== 'assistant')
      }
      return messages.at(-1)?.role !== 'assistant'
    }),
    inputAtom: atom(
      get => get(inputBaseAtom),
      (get, set, event: {
        target: {
          value: string
        }
      }) => {
        set(inputBaseAtom, event.target.value)
      }
    ),
    submitAtom: atom(get => get(isLoadingAtom), (
      get,
      set,
      e: FormEvent<HTMLFormElement>,
      options: ChatRequestOptions = {},
      metadata?: Object
    ) => {
      if (metadata) {
        set(metadataAtom, prevMetadata => ({ ...prevMetadata, ...metadata }))
      }
      e.preventDefault()
      const input = get(inputBaseAtom)
      if (!input) return
      const promise = append(get, set, {
        content: input,
        role: 'user',
        createdAt: new Date()
      }, options).catch(err => onError(get, set, err))
      // clear input
      set(inputBaseAtom, '')
      return promise
    }),
    reloadAtom: atom(null, async (
      get,
      set,
      { options, functions, function_call }: ChatRequestOptions = {}
    ) => {
      const messages = await get(messagesAtom)
      if (messages.length === 0) return null

      // Remove the last assistant message and retry the last user message.
      const lastMessage = messages[messages.length - 1]
      if (lastMessage.role === 'assistant') {
        const chatRequest: ChatRequest = {
          messages: messages.slice(0, -1),
          options,
          ...(functions !== undefined && { functions }),
          ...(function_call !== undefined && { function_call })
        }

        return triggerRequest(get, set, chatRequest)
      }

      const chatRequest: ChatRequest = {
        messages,
        options,
        ...(functions !== undefined && { functions }),
        ...(function_call !== undefined && { function_call })
      }

      return triggerRequest(get, set, chatRequest)
    }),
    stopAtom: atom(null, (
      get
    ) => {
      get(abortControllerAtom).abort()
    })
  }
}
