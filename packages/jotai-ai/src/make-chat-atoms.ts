import type { LanguageModelV1FinishReason } from '@ai-sdk/provider';
import type { FetchFunction, ToolCall } from '@ai-sdk/provider-utils';
import type {
  ChatRequest,
  ChatRequestOptions,
  JSONValue,
} from '@ai-sdk/ui-utils';
import type { LanguageModelUsage, CreateMessage, Message, UIMessage } from 'ai';
import type { Getter, Setter, PrimitiveAtom } from 'jotai/vanilla';

import {
  callChatApi,
  fillMessageParts,
  extractMaxToolInvocationStep,
  shouldResubmitMessages,
  isAssistantMessageWithCompletedToolCalls,
  prepareAttachmentsForRequest,
  getMessageParts,
  updateToolCallResult,
} from '@ai-sdk/ui-utils';

import { atom } from 'jotai/vanilla';
import { atomWithDefault, RESET } from 'jotai/utils';

import { defaultGenerateId } from './utils';

type ExtraMetadata = {
  /**
   * Whether to send extra message fields such as `message.id` and `message.createdAt` to the API.
   * Defaults to `false`. When set to `true`, the API endpoint might need to
   * handle the extra fields before forwarding the request to the AI service.
   */
  sendExtraMessageFields?: boolean;

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
  // forced
  chatIdAtom: PrimitiveAtom<string>;
  initialMessagesAtom: PrimitiveAtom<UIMessage[]>;
  initialInputAtom: PrimitiveAtom<string>;

  /**
   * A unique identifier for the chat. If not provided, a random one will be
   * generated. When provided, the `useChat` hook with the same `id` will
   * have shared states across components.
   */
  id?: string;
  /**
   * Optional function to generate a unique ID for each request and chat Id when missing.
   */
  generateId?: () => string;

  /**
   * The API endpoint that accepts a `{ messages: Message[] }` object and returns
   * a stream of tokens of the AI chat response. Defaults to `/api/chat`.
   */
  api?: string;
  /**
   * Custom fetch implementation. You can use it as a middleware to intercept requests,
   * or to provide a custom fetch implementation for e.g. testing.
   */
  fetch?: FetchFunction;

  /**
   * Streaming protocol that is used. Defaults to `data`.
   */
  streamProtocol?: 'data' | 'text';

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
    id: string;
    messages: Message[];
    requestData?: JSONValue;
    requestBody?: object;
  }) => unknown;

  // /**
  //  * Custom throttle wait in ms for the chat messages and data updates.
  //  * Default is undefined, which disables throttling.
  //  */
  // experimental_throttle?: number;

  /**
   * Keeps the last message when an error happens. This will be the default behavior
   * starting with the next major release.
   * The flag was introduced for backwards compatibility and currently defaults to `false`.
   * Please enable it and update your error handling/resubmit behavior.
   */
  keepLastMessageOnError?: boolean;

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

  const { initialMessagesAtom, initialInputAtom, chatIdAtom } = opts;

  const messagesAtom = atomWithDefault<UIMessage[]>(get =>
    get(initialMessagesAtom),
  );
  const inputAtom = atomWithDefault<string>(get => get(initialInputAtom));

  const streamProtocolAtom = atom(opts.streamProtocol ?? 'data');
  const streamDataAtom = atom<JSONValue[] | undefined>(undefined);
  /** dataAtom is deprecated to support streamDataAtom */
  // const dataAtom = atom<JSONValue[] | undefined>(undefined);

  const statusAtom = atom<'submitted' | 'streaming' | 'ready' | 'error'>(
    'ready',
  );
  const isLoadingAtom = atom(false);
  const errorAtom = atom<Error | undefined>(undefined);
  const abortControllerAtom = atom<AbortController | null>(null);

  const sendExtraMessageFieldsAtom = atom(opts.sendExtraMessageFields ?? true);
  const credentialsAtom = atom(opts.credentials);
  const headersAtom = atom(opts.headers);
  const bodyAtom = atom(opts.body);
  const prepareRequestBodyAtom = atom<
    FnObj<MakeChatAtomsOptions['experimental_prepareRequestBody']>
  >({ fn: opts.experimental_prepareRequestBody });

  const maxStepsAtom = atom(opts.maxSteps ?? 1);
  const keepLastMessageonErrorAtom = atom(opts.keepLastMessageOnError ?? false);

  const onFinishAtom = atom<FnObj<Handlers['onFinish']>>({
    fn: opts.onFinish,
  });
  const onResponseAtom = atom<FnObj<Handlers['onResponse']>>({
    fn: opts.onResponse,
  });
  const onToolCallAtom = atom<FnObj<Handlers['onToolCall']>>({
    fn: opts.onToolCall,
  });
  const onErrorAtom = atom<FnObj<Handlers['onError']>>({
    fn: opts.onError,
  });

  const processResponseStream = async (
    get: Getter,
    set: Setter,
    {
      chatRequest,
      prevUIMessages,
      requestType = 'generate',
    }: {
      chatRequest: ChatRequest;
      prevUIMessages: UIMessage[];
      requestType: 'generate' | 'resume';
    },
  ): Promise<void> => {
    const lastMessage = prevUIMessages[prevUIMessages.length - 1];

    const sendExtraMessageFields = get(sendExtraMessageFieldsAtom);
    const constructedMessagesPayload = sendExtraMessageFields
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
            // deprecated fields. Keep for backwards compatibility.
            data,
            toolInvocations,
          }) => ({
            id,
            role,
            content,
            createdAt,
            ...(parts !== undefined && { parts }),
            ...(annotations !== undefined && { annotations }),
            ...(experimental_attachments !== undefined && {
              experimental_attachments,
            }),
            // deprecated fields. Keep for backwards compatibility.
            ...(data !== undefined && { data }),
            ...(toolInvocations !== undefined && { toolInvocations }),
          }),
        );

    const chatId = get(chatIdAtom);
    const body = get(bodyAtom);
    const credentials = get(credentialsAtom);
    const headers = get(headersAtom);
    const streamProtocol = get(streamProtocolAtom);
    const existingData = get(streamDataAtom);

    await callChatApi({
      api,
      abortController: () => get(abortControllerAtom),
      generateId,
      streamProtocol,
      fetch: opts.fetch,
      body: get(prepareRequestBodyAtom).fn?.({
        id: chatId,
        messages: chatRequest.messages,
        requestData: chatRequest.data,
        requestBody: chatRequest.body,
      }) ?? {
        id: chatId,
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
      restoreMessagesOnFailure: () => {
        if (get(keepLastMessageonErrorAtom)) set(messagesAtom, prevUIMessages);
      },
      onResponse: response => get(onResponseAtom).fn?.(response),
      onFinish: (message, options) => {
        const onFinish = get(onFinishAtom);
        if (onFinish) {
          onFinish.fn?.(message, options);
        }
      },
      onToolCall: ({ toolCall }) => get(onToolCallAtom).fn?.({ toolCall }),
      onUpdate: ({
        message,
        data,
        replaceLastMessage,
      }: {
        message: UIMessage;
        data: JSONValue[] | undefined;
        replaceLastMessage?: boolean;
      }) => {
        set(statusAtom, 'streaming');
        set(messagesAtom, [
          ...(replaceLastMessage
            ? prevUIMessages.slice(0, prevUIMessages.length - 1)
            : prevUIMessages),
          message,
        ]);

        if (data && data.length > 0)
          set(streamDataAtom, [...(existingData ?? []), ...data]);
      },
      requestType,
      lastMessage,
    });
  };

  const triggerRequest = async (
    get: Getter,
    set: Setter,
    chatRequest: ChatRequest,
    requestType: 'generate' | 'resume' = 'generate',
  ) => {
    const prevUIMessages = fillMessageParts(chatRequest.messages);
    const messageCount = get(messagesAtom).length;
    const maxStep = extractMaxToolInvocationStep(
      prevUIMessages[messageCount - 1]?.toolInvocations,
    );

    try {
      set(statusAtom, 'submitted');
      set(isLoadingAtom, true);
      set(errorAtom, undefined);

      const abortController = new AbortController();
      set(abortControllerAtom, abortController);

      await processResponseStream(get, set, {
        chatRequest,
        prevUIMessages,
        requestType,
      });

      set(abortControllerAtom, null);
      set(statusAtom, 'ready');
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        set(abortControllerAtom, null);
        set(statusAtom, 'ready');
        return null;
      }

      if (error instanceof Error) {
        set(errorAtom, error);
        set(statusAtom, 'error');
        get(onErrorAtom).fn?.(error);
      }
    } finally {
      set(isLoadingAtom, false);
    }

    // auto-submit when all tool calls in the last assistant message have results:
    const messages = get(messagesAtom);
    const maxSteps = get(maxStepsAtom);
    if (
      shouldResubmitMessages({
        originalMaxToolInvocationStep: maxStep,
        originalMessageCount: messageCount,
        maxSteps,
        messages,
      })
    )
      await triggerRequest(get, set, { messages }, requestType);
  };

  const append = async (
    get: Getter,
    set: Setter,
    message: Message | CreateMessage,
    {
      headers,
      body,
      data,
      experimental_attachments = message.experimental_attachments,
    }: ChatRequestOptions = {},
  ) => {
    const attachmentsForRequest = await prepareAttachmentsForRequest(
      experimental_attachments,
    );

    const { id, createdAt, ...createMsg } = message;
    const newMessage: Message = {
      ...createMsg,
      id: id ?? generateId(),
      createdAt: createdAt ?? new Date(),
      experimental_attachments:
        attachmentsForRequest.length > 0 ? attachmentsForRequest : undefined,
      parts: getMessageParts(message),
    };

    const prevMessages = get(messagesAtom);
    const chatRequest = {
      messages: [...prevMessages, newMessage],
      headers,
      body,
      data,
    };
    return triggerRequest(get, set, chatRequest);
  };

  const reload = (get: Getter, set: Setter, options?: ChatRequestOptions) => {
    if (get(errorAtom)) set(errorAtom, undefined);

    const messages = get(messagesAtom);
    if (messages.length === 0) return;

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
  const reloadAtom = atom(null, (get, set, options?: ChatRequestOptions) => {
    return reload(get, set, options)?.catch((error: Error) =>
      maybeThrowOnError(get, set, error),
    );
  });
  const stopAtom = atom(null, (get, set) => {
    const abortController = get(abortControllerAtom);
    if (abortController) {
      abortController.abort();
      set(abortControllerAtom, null);
    }
  });
  const resumeAtom = atom(null, (get, set) => {
    const messages = get(messagesAtom);

    return triggerRequest(get, set, { messages }, 'resume');
  });
  const resetAtom = atom(null, (get, set) => {
    set(messagesAtom, RESET);
    set(inputAtom, RESET);

    set(streamDataAtom, undefined);
    set(statusAtom, 'ready');
    set(isLoadingAtom, false);
    set(errorAtom, undefined);
    set(abortControllerAtom, null);
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
      const status = get(statusAtom);
      if (messages.length === 0) return;

      updateToolCallResult({
        messages,
        toolCallId,
        toolResult: result,
      });

      const updatedMessages = [
        ...messages.slice(0, messages.length - 1),
        // would be mutated by `updateToolCallResult`?
        { ...messages[messages.length - 1] } as unknown as UIMessage,
      ];

      set(messagesAtom, updatedMessages);

      // when the request is ongoing, the auto-submit will be triggered after the request is finished
      if (status === 'submitted' || status === 'streaming') return;

      // auto-submit when all tool calls in the last assistant message have results:
      const lastMessage = updatedMessages[updatedMessages.length - 1];
      if (isAssistantMessageWithCompletedToolCalls(lastMessage!)) {
        triggerRequest(get, set, { messages: updatedMessages });
      }
    },
  );

  return {
    // basic abstractions
    chatIdAtom,
    initialInputAtom,
    initialMessagesAtom,
    inputAtom,
    messagesAtom,
    streamDataAtom,

    // status flags
    isLoadingAtom: atom(get => get(isLoadingAtom)),
    errorAtom: atom(get => get(errorAtom)),
    statusAtom: atom(get => get(statusAtom)),

    // actions
    stopAtom,
    appendAtom,
    reloadAtom,
    addToolResultAtom,
    resumeAtom,
    resetAtom,

    // configurable handlers
    onResponseAtom,
    onFinishAtom,
    onToolCallAtom,
    onErrorAtom,

    // configurable options
    streamProtocolAtom,
    keepLastMessageonErrorAtom,
    maxStepsAtom,
    sendExtraMessageFieldsAtom,
    bodyAtom,
    headersAtom,
    credentialsAtom,
    prepareRequestBodyAtom,
  };
}
