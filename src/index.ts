import { atom, Getter, Setter } from 'jotai/vanilla'
import type {
  ChatRequest,
  ChatRequestOptions,
  FunctionCall,
  JSONValue,
  Message
} from 'ai'
import type { CreateMessage, UseChatOptions } from 'ai/react'
import type React from 'react'
import { customAlphabet } from 'nanoid/non-secure'
import { parseComplexResponse } from './parse-complex-response'
import { createChunkDecoder } from 'ai'

export const COMPLEX_HEADER = 'X-Experimental-Stream-Data'

export const nanoid = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  7
)

export function chatAtoms (
  chatOptions: Omit<
    UseChatOptions,
    'onFinish' | 'onResponse' | 'onError' | 'experimental_onFunctionCall'
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
  } = {}
) {
  const api = chatOptions.api || '/api/chat'
  const sendExtraMessageFields = chatOptions.sendExtraMessageFields || false

  // todo: support suspense
  const messagesAtom = atom<Message[]>(
    chatOptions.initialMessages || [])
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
        messages: chatRequest.messages,
        ...metadata.body
      }),
      headers: { ...metadata.headers },
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
          reader.cancel()
          break
        }
      }

      if (streamedResponse.startsWith('{"function_call":')) {
        // Once the stream is complete, the function call is parsed into an object.
        const parsedFunctionCall: FunctionCall =
          JSON.parse(streamedResponse).function_call

        responseMessage['function_call'] = parsedFunctionCall

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
      get(messagesAtom),
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
                  get(messagesAtom),
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
              await onFunctionCall(get, set, get(messagesAtom), functionCall)

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

    const messages = get(messagesAtom)

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
    messagesAtom,
    isLoadingAtom: atom(get => get(isLoadingAtom)),
    inputAtom: atom(
      get => get(inputBaseAtom),
      (get, set, event: React.ChangeEvent<HTMLInputElement>) => {
        set(inputBaseAtom, event.target.value)
      }
    ),
    submitAtom: atom(null, (
      get,
      set,
      e: React.FormEvent<HTMLFormElement>,
      options: ChatRequestOptions = {},
      metadata?: Object
    ) => {
      if (metadata) {
        set(metadataAtom, prevMetadata => ({ ...prevMetadata, ...metadata }))
      }
      e.preventDefault()
      const input = get(inputBaseAtom)
      if (!input) return
      append(get, set, {
        content: input,
        role: 'user',
        createdAt: new Date()
      }, options).catch(err => onError(get, set, err))
      // clear input
      set(inputBaseAtom, '')
    })
  }
}
