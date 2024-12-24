import type { LanguageModelV1FinishReason } from '@ai-sdk/provider';
import type { FetchFunction, ToolCall } from '@ai-sdk/provider-utils';
import type {
  ChatRequest,
  ChatRequestOptions,
  CreateMessage,
  JSONValue,
  Message,
} from '@ai-sdk/ui-utils';
import type { LanguageModelUsage } from 'ai';

import type { Getter, PrimitiveAtom, Setter } from 'jotai/vanilla';

import { atomWithReset } from 'jotai/utils';
import { atom } from 'jotai/vanilla';

import { callChatApi } from '@ai-sdk/ui-utils';

import {
  countTrailingAssistantMessages,
  defaultGenerateId,
  isAssistantMessageWithCompletedToolCalls,
  prepareAttachmentsForRequest,
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

/* internal */
type FnObj<T> = {
  fn: T;
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
  const { messagesAtom } = opts;
  const dataAtom = atomWithReset<JSONValue[] | undefined>(undefined);

  // TODO: convert to atom to allow for configuration in `useChat`
  const api = opts.api ?? '/api/chat';
  const generateId = opts.generateId ?? defaultGenerateId;

  const maxStepsAtom = atomWithReset(opts.maxSteps ?? 1);
  const streamProtocolAtom = atomWithReset(opts.streamProtocol ?? 'data');
  const credentialsAtom = atomWithReset(opts.credentials);
  const headersAtom = atomWithReset(opts.headers);
  const bodyAtom = atomWithReset(opts.body);
  const prepareRequestBodyAtom = atomWithReset<
    FnObj<MakeChatAtomsOptions['experimental_prepareRequestBody']>
  >({ fn: opts.experimental_prepareRequestBody });

  const isLoadingAtom = atomWithReset(false);
  const errorAtom = atomWithReset<Error | undefined>(undefined);
  const abortControllerAtom = atomWithReset<AbortController | null>(null);
  // const readySubmitAtom = atom(true)
  // const isPendingAtom = atom(false)

  const onFinishAtom = atomWithReset<FnObj<Handlers['onFinish']>>({
    fn: opts.onFinish,
  });
  const onResponseAtom = atomWithReset<FnObj<Handlers['onResponse']>>({
    fn: opts.onResponse,
  });
  const onToolCallAtom = atomWithReset<FnObj<Handlers['onToolCall']>>({
    fn: opts.onToolCall,
  });
  const onErrorAtom = atomWithReset<FnObj<Handlers['onError']>>({
    fn: opts.onError,
  });

  const processResponseStream = async (
    get: Getter,
    set: Setter,
    chatRequest: ChatRequest,
  ) => {
    // Do an optimistic update to the chat state to show the updated messages immediately:
    set(messagesAtom, chatRequest.messages);

    const constructedMessagesPayload = opts.sendExtraMessageFields
      ? chatRequest.messages
      : chatRequest.messages.map(
          ({
            role,
            content,
            experimental_attachments,
            data,
            annotations,
            toolInvocations,
          }) => ({
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

    const body = get(bodyAtom);
    const credentials = get(credentialsAtom);
    const headers = get(headersAtom);
    const streamProtocol = get(streamProtocolAtom);

    return await callChatApi({
      api,
      abortController: () => get(abortControllerAtom),
      generateId,
      streamProtocol,
      fetch: opts.fetch,
      body: get(prepareRequestBodyAtom).fn?.({
        messages: chatRequest.messages,
        requestData: chatRequest.data,
        requestBody: chatRequest.body,
      }) ?? {
        messages: constructedMessagesPayload,
        data: chatRequest.data,
        ...body,
        ...chatRequest.body,
      },
      headers: {
        ...headers,
        ...chatRequest.headers,
      },
      credentials: credentials,
      // handler
      restoreMessagesOnFailure: () => undefined,
      onResponse: response => get(onResponseAtom).fn?.(response),
      onFinish: (message, options) => get(onFinishAtom).fn?.(message, options),
      onToolCall: ({ toolCall }) => get(onToolCallAtom).fn?.({ toolCall }),
      onUpdate: (newMessages: Message[], data: JSONValue[] | undefined) => {
        set(messagesAtom, [...chatRequest.messages, ...newMessages]);
        set(dataAtom, data);
      },
    });
  };

  const triggerRequest = async (
    get: Getter,
    set: Setter,
    chatRequest: ChatRequest,
  ) => {
    const messageCount = get(messagesAtom).length;

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
        get(onErrorAtom).fn?.(error);
      }
    } finally {
      set(isLoadingAtom, false);
    }

    // auto-submit when all tool calls in the last assistant message have results:
    const messages = get(messagesAtom);
    const lastMessage = messages[messages.length - 1];
    const maxSteps = get(maxStepsAtom);
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
    {
      headers,
      body,
      data,
      experimental_attachments,
      allowEmptySubmit,
    }: ChatRequestOptions = {},
  ) => {
    const attachmentsForRequest = await prepareAttachmentsForRequest(
      experimental_attachments,
    );

    const { id, createdAt, ...createMsg } = message;
    const newMessage: Message = {
      ...createMsg,
      id: message.id ?? generateId(),
      createdAt: message.createdAt ?? new Date(),
      experimental_attachments:
        attachmentsForRequest.length > 0 ? attachmentsForRequest : undefined,
    };
    const prevMessages = get(messagesAtom);

    const chatRequest = {
      messages:
        !newMessage.content && !experimental_attachments && allowEmptySubmit
          ? prevMessages
          : [...prevMessages, newMessage],
      headers,
      body,
      data,
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
      const lastRemovedMessages = messages.slice(0, -1);
      set(messagesAtom, lastRemovedMessages);
      const chatRequest = {
        messages: lastRemovedMessages,
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
    const onError = get(onErrorAtom).fn;
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

  const addToolResultAtom = atom(
    null,
    (
      get,
      set,
      {
        toolCallId,
        result,
      }: {
        toolCallId: string;
        result: any;
      },
    ) => {
      const messages = get(messagesAtom);
      const updatedMessages = messages.map((message, index, arr) =>
        // update the tool calls in the last assistant message:
        index === arr.length - 1 &&
        message.role === 'assistant' &&
        message.toolInvocations
          ? {
              ...message,
              toolInvocations: message.toolInvocations.map(toolInvocation =>
                toolInvocation.toolCallId === toolCallId
                  ? {
                      ...toolInvocation,
                      result,
                      state: 'result' as const,
                    }
                  : toolInvocation,
              ),
            }
          : message,
      );

      set(messagesAtom, updatedMessages);

      if (updatedMessages.length === 0) return;
      // auto-submit when all tool calls in the last assistant message have results:
      const lastMessage = updatedMessages[updatedMessages.length - 1];
      if (isAssistantMessageWithCompletedToolCalls(lastMessage!)) {
        triggerRequest(get, set, { messages: updatedMessages });
      }
    },
  );

  return {
    // data containers
    dataAtom,
    isLoadingAtom: atom(get => get(isLoadingAtom)),
    errorAtom: atom(get => get(errorAtom)),

    // actions
    stopAtom,
    appendAtom,
    reloadAtom,
    addToolResultAtom,

    // configurable handlers
    onResponseAtom,
    onFinishAtom,
    onToolCallAtom,
    onErrorAtom,

    // configurable options
    streamProtocolAtom,
    bodyAtom,
    headersAtom,
    credentialsAtom,
    maxStepsAtom,
    prepareRequestBodyAtom,
  };
}
