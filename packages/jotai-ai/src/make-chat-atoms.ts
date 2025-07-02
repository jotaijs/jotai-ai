import type { LanguageModelV1FinishReason } from '@ai-sdk/provider';
import type { FetchFunction, ToolCall } from '@ai-sdk/provider-utils';
import {
  callChatApi,
  type ChatRequest,
  type ChatRequestOptions,
  type CreateMessage,
  type JSONValue,
  type Message,
} from '@ai-sdk/ui-utils';
import type { LanguageModelUsage, UIMessage } from 'ai';

import type { Getter, PrimitiveAtom, Setter } from 'jotai/vanilla';

import { atom } from 'jotai/vanilla';

import {
  countTrailingAssistantMessages,
  defaultGenerateId,
  isAssistantMessageWithCompletedToolCalls,
} from './utils';

type Body = Record<string, JSONValue>;

type ExtraMetadata = {
  /**
   * The credentials mode to be used for the fetch request.
   * Possible values are: 'omit', 'same-origin', 'include'.
   * Defaults to 'same-origin'.
   */
  credentials?: RequestCredentials;
  /**
   * HTTP headers to be sent with the API request.
   */
  headers?: HeadersInit;
  /**
   * Extra body object to be sent with the API request.
   * @example
   * Send a `sessionId` to the API along with the messages.
   * ```js
   * useChat({
   *   body: {
   *     sessionId: '123',
   *   }
   * })
   * ```
   */
  body?: Record<string, JSONValue>;
};

type AtomHandlers = {
  onResponse?: (get: Getter, set: Setter, response: Response) => void;
  onError?: (get: Getter, set: Setter, error: Error) => void;
  onFinish?: (
    get: Getter,
    set: Setter,
    message: Message,
    options: {
      usage: LanguageModelUsage;
      finishReason: LanguageModelV1FinishReason;
    },
  ) => void;
  onToolCall?: (
    get: Getter,
    set: Setter,
    { toolCall }: { toolCall: ToolCall<string, unknown> },
  ) => void;
};

export type Handlers = {
  /**
   * Optional callback function that is invoked when a tool call is received.
   * Intended for automatic client-side tool execution.
   *
   * You can optionally return a result for the tool call,
   * either synchronously or asynchronously.
   */
  onToolCall?: ({ toolCall }: { toolCall: ToolCall<string, unknown> }) => void;
  /**
   * Callback function to be called when the API response is received.
   */
  onResponse?: (response: Response) => void;
  /**
   * Optional callback function that is called when the assistant message is finished streaming.
   *
   * @param message The message that was streamed.
   * @param options.usage The token usage of the message.
   * @param options.finishReason The finish reason of the message.
   */
  onFinish?: (
    message: Message,
    options: {
      usage: LanguageModelUsage;
      finishReason: LanguageModelV1FinishReason;
    },
  ) => void;
  /**
   * Callback function to be called when an error is encountered.
   */
  onError?: (error: Error) => void;
};

export type MakeChatAtomsOptions = {
  // must be provided
  messagesAtom: PrimitiveAtom<Message[]>;

  /**
   * The API endpoint that accepts a `{ messages: Message[] }` object and returns
   * a stream of tokens of the AI chat response. Defaults to `/api/chat`.
   */
  api?: string;
  /**
   * A unique identifier for the chat. If not provided, a random one will be
   * generated. When provided, the `useChat` hook with the same `id` will
   * have shared states across components.
   */
  id?: string;

  /**
   * Custom fetch implementation. You can use it as a middleware to intercept requests,
   * or to provide a custom fetch implementation for e.g. testing.
   */
  fetch?: FetchFunction;
  /**
   *Streaming protocol that is used. Defaults to `data`.
   */
  streamProtocol?: 'data' | 'text';

  generateId?: () => string;
  /**
   * Experimental (React only). When a function is provided, it will be used
   * to prepare the request body for the chat API. This can be useful for
   * customizing the request body based on the messages and data in the chat.
   *
   * @param messages The current messages in the chat.
   * @param requestData The data object passed in the chat request.
   * @param requestBody The request body object passed in the chat request.
   */
  experimental_prepareRequestBody?: (options: {
    messages: Message[];
    requestData?: JSONValue;
    requestBody?: object;
  }) => Record<string, JSONValue>;
  /**
   * Whether to send extra message fields such as `message.id` and `message.createdAt` to the API.
   * Defaults to `false`. When set to `true`, the API endpoint might need to
   * handle the extra fields before forwarding the request to the AI service.
   */
  sendExtraMessageFields?: boolean;

  /**
   * Maximum number of sequential LLM calls (steps), e.g. when you use tool calls. Must be at least 1.
   *
   * A maximum number is required to prevent infinite loops in the case of misconfigured tools.
   *
   * By default, it's set to 1, which means that only a single LLM call is made.
   */
  maxSteps?: number;
} & ExtraMetadata &
  Handlers;

export function makeChatAtoms(opts: MakeChatAtomsOptions) {
  const api = opts.api ?? '/api/chat';
  const generateId = opts.generateId ?? defaultGenerateId;
  const maxSteps = opts.maxSteps ?? 1;
  const streamProtocol = opts.streamProtocol ?? 'data';

  const prepareRequestBodyAtom = atom<
    MakeChatAtomsOptions['experimental_prepareRequestBody']
  >(opts.experimental_prepareRequestBody);

  const { messagesAtom } = opts;
  const dataAtom = atom<JSONValue[] | undefined>(undefined);

  const isLoadingAtom = atom(false);
  const errorAtom = atom<Error | undefined>(undefined);
  const abortControllerAtom = atom<AbortController | null>(null);

  // const readySubmitAtom = atom(true)
  // const isPendingAtom = atom(false)

  const onFinishAtom = atom<Handlers['onFinish']>(opts.onFinish);
  const onResponseAtom = atom<Handlers['onResponse']>(opts.onResponse);
  const onToolCallAtom = atom<Handlers['onToolCall']>(opts.onToolCall);
  const onErrorAtom = atom<Handlers['onError']>(opts.onError);

  // fetch: opts.fetch,
  // streamProtocol: opts.streamProtocol,

  const metadataAtom = atom<ExtraMetadata>({
    credentials: opts.credentials,
    headers: opts.headers,
    body: opts.body,
  });

  const processResponseStream = async (
    get: Getter,
    set: Setter,
    chatRequest: ChatRequest,
  ): Promise<
    | Message
    | {
        messages: Message[];
        data: JSONValue[];
      }
  > => {
    // Do an optimistic update to the chat state to show the updated messages immediately:
    set(messagesAtom, chatRequest.messages);

    const constructedMessagesPayload = opts.sendExtraMessageFields
      ? chatRequest.messages
      : chatRequest.messages.map(
          ({
            id,
            role,
            content,
            createdAt,
            parts,
            annotations,
            experimental_attachments,
          }) => ({
            id,
            role,
            content,
            createdAt,
            parts,
            annotations,
            experimental_attachments,
          }),
        );

    const metadata = get(metadataAtom);
    const lastMessage = chatRequest.messages[chatRequest.messages.length - 1];
    await callChatApi({
      api,
      abortController: () => get(abortControllerAtom),
      generateId,
      streamProtocol,
      fetch: opts.fetch,
      // req metadata
      body: get(prepareRequestBodyAtom)?.({
        messages: chatRequest.messages,
        requestData: chatRequest.data,
        requestBody: chatRequest.body,
      }) ?? {
        messages: constructedMessagesPayload,
        data: chatRequest.data,
        ...metadata.body,
        ...chatRequest.body,
      },
      headers: {
        ...metadata.headers,
        ...chatRequest.headers,
      },
      credentials: metadata.credentials,
      // handler
      restoreMessagesOnFailure: () => undefined,
      onResponse: response => get(onResponseAtom)?.(response),
      onFinish: (message, options) => {
        const onFinish = get(onFinishAtom);
        if (onFinish) {
          onFinish(message, options);
        }
      },
      onToolCall: ({ toolCall }) => get(onToolCallAtom)?.({ toolCall }),
      onUpdate: (options: {
        message: UIMessage;
        data: JSONValue[] | undefined;
      }) => {
        set(messagesAtom, [...chatRequest.messages, options.message]);
        set(dataAtom, existingData => [
          ...(existingData ?? []),
          ...(options.data ?? []),
        ]);
      },
      requestType: 'generate',
      lastMessage: lastMessage && {
        ...lastMessage,
        parts: lastMessage.parts || [],
      },
    });

    return {
      messages: chatRequest.messages,
      data: get(dataAtom) ?? [],
    };
  };

  const triggerRequest = async (
    get: Getter,
    set: Setter,
    chatRequest: ChatRequest,
  ) => {
    try {
      set(isLoadingAtom, true);
      set(errorAtom, undefined);

      const abortController = new AbortController();
      set(abortControllerAtom, abortController);

      await processResponseStream(get, set, chatRequest);

      set(abortControllerAtom, null);
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        set(abortControllerAtom, new AbortController());
        return null;
      }

      if (error instanceof Error) {
        set(errorAtom, error);
        get(onErrorAtom)?.(error);
      }
    } finally {
      set(isLoadingAtom, false);
    }

    // auto-submit when all tool calls in the last assistant message have results:
    const messages = get(messagesAtom);
    const lastMessage = messages[messages.length - 1];
    const messageCount = chatRequest.messages.length;
    if (
      // ensure we actually have new messages (to prevent infinite loops in case of errors):
      messages.length > messageCount &&
      // ensure there is a last message:
      lastMessage != null &&
      // check if the feature is enabled:
      maxSteps > 1 &&
      // check that next step is possible:
      isAssistantMessageWithCompletedToolCalls(lastMessage) &&
      // limit the number of automatic steps:
      countTrailingAssistantMessages(messages) < maxSteps
    ) {
      await triggerRequest(get, set, { messages });
    }
  };

  const append = async (
    get: Getter,
    set: Setter,
    message: Message | CreateMessage,
    { headers, body, data, experimental_attachments }: ChatRequestOptions = {},
  ) => {
    if (!message.id) {
      message.id = generateId();
    }

    // const attachmentsForRequest = await prepareAttachmentsForRequest(
    //   experimental_attachments,
    // )

    const messages = get(messagesAtom);
    const chatRequest = {
      headers: headers,
      body: body,
      messages: [...messages, message as Message],
      data,
      // experimental_attachments:
      //   attachmentsForRequest.length > 0 ? attachmentsForRequest : undefined,
    };
    return triggerRequest(get, set, chatRequest);
  };

  const reload = async (
    get: Getter,
    set: Setter,
    options?: ChatRequestOptions,
  ) => {
    if (get(errorAtom)) set(errorAtom, undefined);

    const messages = get(messagesAtom);
    if (messages.length === 0) return null;

    const { headers, body, data, experimental_attachments, allowEmptySubmit } =
      options ?? {};

    // Remove the last assistant message and retry the last user message.
    const lastMessage = messages[messages.length - 1];
    if (lastMessage!.role === 'assistant') {
      const chatRequest = {
        messages: messages.slice(0, -1),
        headers,
        body,
        data,
        experimental_attachments,
        allowEmptySubmit,
      };
      return triggerRequest(get, set, chatRequest);
    } else {
      const chatRequest = {
        messages,
        headers,
        body,
        data,
        experimental_attachments,
        allowEmptySubmit,
      };
      return triggerRequest(get, set, chatRequest);
    }
  };

  const maybeThrowOnError = (get: Getter, set: Setter, error: Error) => {
    set(errorAtom, error);
    const onError = get(onErrorAtom);
    if (onError) onError(error);
    else throw error;
  };

  // Implement user side handler
  const appendAtom = atom(
    null,
    async (
      get,
      set,
      message: Message | CreateMessage,
      options?: ChatRequestOptions,
    ) => {
      return append(get, set, message, options).catch((error: Error) =>
        maybeThrowOnError(get, set, error),
      );
    },
  );
  const reloadAtom = atom(
    null,
    async (get, set, options?: ChatRequestOptions) => {
      return reload(get, set, options).catch((error: Error) =>
        maybeThrowOnError(get, set, error),
      );
    },
  );
  const stopAtom = atom(null, (get, set) => {
    const abortController = get(abortControllerAtom);
    if (abortController) {
      abortController.abort();
      set(abortControllerAtom, null);
    }
  });

  return {
    stopAtom,
    appendAtom,
    reloadAtom,

    dataAtom,
    isLoadingAtom: atom(get => get(isLoadingAtom)),
    errorAtom: atom(get => get(errorAtom)),

    // handlers
    onResponseAtom,
    onFinishAtom,
    onToolCallAtom,
    onErrorAtom,
  };
}
