import type { FormEvent } from 'react';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import { generateId as generateIdImpl } from '@ai-sdk/provider-utils';
import {
  type ChatRequest,
  type ChatRequestOptions,
  type CreateMessage,
  type JSONValue,
  type Message,
  type UseChatOptions,
  callChatApi,
} from '@ai-sdk/ui-utils';
import { atom, type Getter, type Setter } from 'jotai/vanilla';
import {
  countTrailingAssistantMessages,
  isPromiseLike,
  isAssistantMessageWithCompletedToolCalls,
} from './utils';

export function chatAtoms(
  chatOptions: Omit<
    UseChatOptions,
    | 'onFinish'
    | 'onResponse'
    | 'onError'
    | 'experimental_onFunctionCall'
    | 'initialMessages'
  > & {
    onFinish?: (get: Getter, set: Setter, message: Message) => void;
    onResponse?: (
      get: Getter,
      set: Setter,
      response: Response,
    ) => void | Promise<void>;
    onError?: (get: Getter, set: Setter, error: Error) => void;
    maxToolRoundtrips?: number;

    /**
     * Experimental (React only). When a function is provided, it will be used
     * to prepare the request body for the chat API. This can be useful for
     * customizing the request body based on the messages and data in the chat.
     *
     * @param messages The current messages in the chat.
     * @param requestData The data object passed in the chat request.
     * @param requestBody The request body object passed in the chat request.
     */
    experimental_prepareRequestBody?: (
      get: Getter,
      set: Setter,
      options: {
        messages: Message[];
        requestData?: JSONValue;
        requestBody?: object;
      },
    ) => Record<string, any>;

    experimental_onFunctionCall?: (
      get: Getter,
      set: Setter,
      ...args: Parameters<Required<UseChatOptions>['onToolCall']>
    ) => ReturnType<Required<UseChatOptions>['onToolCall']>;
    // if you pass async function or promise, you will need a suspense boundary
    initialMessages?:
      | Message[]
      | Promise<Message[]>
      | (() => Message[] | Promise<Message[]>);
  } = {},
) {
  const api = chatOptions.api || '/api/chat';
  const sendExtraMessageFields = chatOptions.sendExtraMessageFields || false;
  const initialMessages = chatOptions.initialMessages || [];
  const maxToolRoundtrips = chatOptions.maxToolRoundtrips || 0;
  const generateId = chatOptions.generateId || generateIdImpl;

  const primitiveMessagesAtom = atom<Message[] | Promise<Message[]> | null>(
    typeof initialMessages === 'function' ? null : initialMessages,
  );
  const messagesAtom = atom<
    Message[] | Promise<Message[]>,
    [messages: Message[] | Promise<Message[]>],
    void
  >(
    get => {
      const messages = get(primitiveMessagesAtom);
      if (messages === null) {
        return (initialMessages as () => Message[] | Promise<Message[]>)();
      } else {
        return messages;
      }
    },
    (_get, set, messages) => {
      set(primitiveMessagesAtom, messages);
    },
  );
  const dataAtom = atom<JSONValue[] | undefined>(undefined);
  const inputBaseAtom = atom(chatOptions.initialInput || '');

  const abortControllerAtom = atom<AbortController>(new AbortController());
  const isLoadingAtom = atom(false);

  type Metadata = {
    fetch?: FetchFunction;
    streamProtocol?: 'data' | 'text' | undefined;
    credentials?: RequestCredentials;
    headers?: HeadersInit;
    body?: Record<string, any>;
  };

  const metadataAtom = atom<Metadata>({
    fetch: chatOptions.fetch,
    streamProtocol: chatOptions.streamProtocol,
    credentials: chatOptions.credentials,
    headers: chatOptions.headers,
    body: chatOptions.body,
  });

  async function getStreamedResponse(
    get: Getter,
    set: Setter,
    chatRequest: ChatRequest,
  ) {
    // Do an optimistic update to the chat state to show the updated messages immediately:
    set(messagesAtom, chatRequest.messages);

    // Reset data atom for this new request
    set(dataAtom, []);

    const lastMessage = chatRequest.messages[chatRequest.messages.length - 1];
    if (!lastMessage) {
      throw new Error('No last message found');
    }

    const constructedMessagesPayload = sendExtraMessageFields
      ? chatRequest.messages
      : chatRequest.messages.map(
          ({
            role,
            content,
            experimental_attachments,
            data,
            annotations,
            toolInvocations,
            id,
            createdAt,
            parts,
          }) => ({
            id,
            createdAt,
            parts,
            annotations,
            data,
            experimental_attachments,
            role,
            content,
            ...(experimental_attachments !== undefined && {
              experimental_attachments,
            }),
            ...(data !== undefined && { data }),
            ...(annotations !== undefined && { annotations }),
            ...(toolInvocations !== undefined && { toolInvocations }),
          }),
        );
    const metadata = get(metadataAtom);
    return callChatApi({
      api,
      abortController: () => get(abortControllerAtom),
      body: chatOptions.experimental_prepareRequestBody?.(get, set, {
        messages: chatRequest.messages,
        requestData: chatRequest.data,
        requestBody: chatRequest.body,
      }) ?? {
        messages: constructedMessagesPayload,
        data: chatRequest.data,
        ...metadata.body,
        ...chatRequest.body,
      },
      streamProtocol: metadata.streamProtocol,
      headers: {
        ...metadata.headers,
        ...chatRequest.headers,
      },
      credentials: metadata.credentials,
      onResponse: response => chatOptions.onResponse?.(get, set, response),
      restoreMessagesOnFailure: () => {},
      onFinish: message => chatOptions.onFinish?.(get, set, message),
      fetch: metadata.fetch,
      onToolCall: chatOptions.onToolCall,
      onUpdate: (options: {
        message: Message;
        data: JSONValue[] | undefined;
        replaceLastMessage: boolean;
      }): void => {
        const { message, data, replaceLastMessage } = options;
        if (replaceLastMessage) {
          // Replace the last message
          set(messagesAtom, [...chatRequest.messages.slice(0, -1), message]);
        } else {
          // Append the new message
          set(messagesAtom, [...chatRequest.messages, message]);
        }
        if (data !== undefined) {
          set(dataAtom, data);
        }
      },
      generateId,
      lastMessage: { ...lastMessage, parts: lastMessage?.parts || [] },
    });
  }

  async function triggerRequest(
    get: Getter,
    set: Setter,
    chatRequest: ChatRequest,
  ) {
    // ensure messages are loaded before sending the request
    await get(messagesAtom);

    const messageCount = chatRequest.messages.length;
    try {
      set(isLoadingAtom, true);
      const abortController = new AbortController();
      set(abortControllerAtom, abortController);

      // Just call getStreamedResponse directly instead of processChatStream
      await getStreamedResponse(get, set, chatRequest);
    } catch (err) {
      // Ignore abort errors as they are expected.
      if ((err as any).name === 'AbortError') {
        set(abortControllerAtom, new AbortController());
        return null;
      }

      if (chatOptions.onError && err instanceof Error) {
        chatOptions.onError(get, set, err);
      }
    } finally {
      set(isLoadingAtom, false);
    }

    // auto-submit when all tool calls in the last assistant message have results:
    const messages = await get(messagesAtom);
    const lastMessage = messages[messageCount - 1];
    if (
      // ensure we actually have new messages (to prevent infinite loops in case of errors):
      messages.length > messageCount &&
      // ensure there is a last message:
      lastMessage != null &&
      // check if the feature is enabled:
      maxToolRoundtrips > 0 &&
      // check that roundtrip is possible:
      isAssistantMessageWithCompletedToolCalls(lastMessage) &&
      // limit the number of automatic roundtrips:
      countTrailingAssistantMessages(messages) <= maxToolRoundtrips
    ) {
      await triggerRequest(get, set, {
        messages: messages,
      });
    }
  }

  async function append(
    get: Getter,
    set: Setter,
    message: Message | CreateMessage,
    { data, headers, body }: ChatRequestOptions = {},
  ) {
    if (!message.id) {
      message.id = generateId();
    }

    const requestOptions = {
      headers: headers,
      body: body,
    };

    const messages = await get(messagesAtom);

    const chatRequest: ChatRequest = {
      messages: messages.concat(message as Message),
      headers: requestOptions.headers,
      body: requestOptions.body,
      data,
    };

    return triggerRequest(get, set, chatRequest);
  }

  function onError(get: Getter, set: Setter, error: Error) {
    if (chatOptions.onError) {
      chatOptions.onError(get, set, error);
    } else {
      throw error;
    }
  }

  // user side atoms
  return {
    messagesAtom: atom(
      get => get(messagesAtom),
      async (get, set, messages: Message[]): Promise<void> => {
        const prevMessages = get(messagesAtom);
        if (isPromiseLike(prevMessages)) {
          set(
            messagesAtom,
            prevMessages.then(() => messages),
          );
        } else {
          set(messagesAtom, messages);
        }
      },
    ),
    dataAtom: atom(get => get(dataAtom)),
    isLoadingAtom: atom(get => get(isLoadingAtom)),
    isPendingAtom: atom(get => {
      const messages = get(messagesAtom);
      if (isPromiseLike(messages)) {
        return messages.then(messages => messages.at(-1)?.role !== 'assistant');
      }
      return messages.at(-1)?.role !== 'assistant';
    }),
    inputAtom: atom(
      get => get(inputBaseAtom),
      (
        _get,
        set,
        event: {
          target: {
            value: string;
          };
        },
      ) => {
        set(inputBaseAtom, event.target.value);
      },
    ),
    appendAtom: atom(
      get => get(isLoadingAtom),
      async (
        get,
        set,
        message: Message | CreateMessage,
        options: ChatRequestOptions = {},
        metadata?: Metadata,
      ) => {
        if (metadata) {
          set(metadataAtom, prevMetadata => ({
            ...prevMetadata,
            ...metadata,
          }));
        }
        return append(get, set, message, options).catch(err =>
          onError(get, set, err),
        );
      },
    ),
    submitAtom: atom(
      get => get(isLoadingAtom),
      (
        get,
        set,
        e: FormEvent<HTMLFormElement>,
        options: ChatRequestOptions = {},
        metadata?: Object,
      ) => {
        if (metadata) {
          set(metadataAtom, prevMetadata => ({
            ...prevMetadata,
            ...metadata,
          }));
        }
        e.preventDefault();
        const input = get(inputBaseAtom);
        if (!input) return;
        const promise = append(
          get,
          set,
          {
            content: input,
            role: 'user',
            createdAt: new Date(),
          },
          options,
        ).catch(err => onError(get, set, err));
        // clear input
        set(inputBaseAtom, '');
        return promise;
      },
    ),
    reloadAtom: atom(
      null,
      async (get, set, { data, headers, body }: ChatRequestOptions = {}) => {
        const messages = await get(messagesAtom);
        if (messages.length === 0) return null;

        const requestOptions = {
          headers: headers,
          body: body,
        };

        // Remove the last assistant message and retry the last user message.
        const lastMessage = messages[messages.length - 1];
        if (lastMessage!.role === 'assistant') {
          const chatRequest: ChatRequest = {
            messages: messages.slice(0, -1),
            headers: requestOptions.headers,
            body: requestOptions.body,
            data,
          };

          return triggerRequest(get, set, chatRequest);
        }

        const chatRequest: ChatRequest = {
          messages,
          headers: requestOptions.headers,
          body: requestOptions.body,
          data,
        };

        return triggerRequest(get, set, chatRequest);
      },
    ),
    stopAtom: atom(null, get => {
      get(abortControllerAtom).abort();
    }),
  };
}
